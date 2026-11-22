"""Standard-library controller for Start.sh; never imports runtime packages here."""

import argparse
from contextlib import suppress
import fcntl
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
import termios
import time
import tty
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
from app.core.log_sessions import prepare_log_session


RUNTIME = ROOT / ".runtime"
VENV = RUNTIME / "venv"
VENV_PYTHON = VENV / "bin" / "python"
REQUIREMENTS = BACKEND / "requirements-runtime.txt"
ENVIRONMENT = RUNTIME / "environment.json"
SESSION = RUNTIME / "session.json"
PAGE_URL = "http://localhost:8000"

DEPENDENCY_CHECK = """
import fastapi, httpx, pydantic_settings, uvicorn
from importlib.metadata import version
from pathlib import Path
import sys
pins = [line.split('==') for line in Path(sys.argv[1]).read_text().splitlines()
        if line and not line.startswith('#')]
sys.exit(0 if all(version(name) == required for name, required in pins) else 1)
"""


def save_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(value), encoding="utf-8")
    temporary.replace(path)


class Cancelled(Exception):
    pass


class StartupDisplay:
    frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

    def __init__(self) -> None:
        self.step = ""
        self.frame = 0

    def start(self, step: str) -> None:
        self.step = step
        self.frame = 0
        self.refresh()

    def refresh(self) -> None:
        print(f"\r\033[2K{self.frames[self.frame]} {self.step}", end="", flush=True)
        self.frame = (self.frame + 1) % len(self.frames)

    def finish(self, symbol: str, result: str) -> None:
        self.write(symbol, self.step or "Rename Studio", result)
        self.step = ""

    @staticmethod
    def write(symbol: str, step: str, result: str) -> None:
        line = f"{symbol} {step}  {result}"
        if symbol == "✗":
            line = f"\033[31m{line}\033[0m"
        print(f"\r\033[2K{line}", flush=True)


class Launcher:
    def __init__(self, no_browser: bool, debug: bool) -> None:
        self.no_browser = no_browser
        self.debug = debug
        self.cancelled = False
        self.display = StartupDisplay()
        self.version = ""
        self.log_session: Path | None = None
        self.service: subprocess.Popen | None = None
        self.stop_file: Path | None = None
        self.last_probe_error = ""
        # Local probes must not be sent through a user's HTTP proxy.
        self.http = build_opener(ProxyHandler({}))

    def status(self, message: str) -> None:
        print(f"\r\033[2K{message}", flush=True)

    def request_stop(self, _signum: int, _frame: object) -> None:
        # Do not raise inside Popen/metadata writes; finish the step then clean up.
        self.cancelled = True

    def check_cancel(self) -> None:
        if select.select([sys.stdin], [], [], 0)[0]:
            if os.read(sys.stdin.fileno(), 1).lower() == b"q":
                self.cancelled = True
        if self.cancelled:
            raise Cancelled

    def open_browser(self) -> None:
        if not self.no_browser:
            result = subprocess.run(["/usr/bin/open", PAGE_URL], capture_output=True)
            if result.returncode:
                self.display.write("!", "打开浏览器", f"无法自动打开，请手动访问 {PAGE_URL}")

    def healthy(self, instance_id: str) -> bool:
        try:
            for path in ("/api/health", "/"):
                with self.http.open(f"http://127.0.0.1:8000{path}", timeout=2) as response:
                    if response.status != 200 or response.headers.get("x-rename-studio-instance") != instance_id:
                        self.last_probe_error = "响应不属于本次服务或状态异常。"
                        return False
                    if path == "/api/health":
                        if json.load(response) != {"status": "ok"}:
                            self.last_probe_error = "健康检查响应异常。"
                            return False
                        self.version = response.headers.get("x-rename-studio-version", "")
            return True
        except (URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as exc:
            # Startup retries have a deadline; preserve the final error for diagnosis.
            self.last_probe_error = str(exc)
            return False

    def task(self, executable: Path, arguments: list[str]) -> int:
        process = subprocess.Popen(
            [str(executable), *arguments], cwd=BACKEND, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, start_new_session=True,
        )
        try:
            while process.poll() is None:
                self.check_cancel()
                time.sleep(0.1)
                self.display.refresh()
        finally:
            if process.poll() is None:
                # Cancel only our setup process group, including pip build helpers.
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        return process.returncode

    def prepare_environment(self) -> None:
        display = self.display
        display.start("准备虚拟环境")
        identity = {
            "project_root": str(ROOT), "python_executable": sys.executable,
            "python_version": sys.version.split()[0],
        }
        fingerprint = hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()
        saved = json.loads(ENVIRONMENT.read_text(encoding="utf-8-sig")) if ENVIRONMENT.exists() else None
        if VENV.exists():
            if not saved or any(saved[key] != value for key, value in identity.items()) or not VENV_PYTHON.is_file():
                raise RuntimeError("运行环境不可用、Python 已变化或项目已移动。请退出后移走或删除 .runtime/venv，再重新启动。")
            version_check = "import sys; sys.exit(0 if sys.version.split()[0] == sys.argv[1] else 1)"
            code = self.task(VENV_PYTHON, ["-c", version_check, identity["python_version"]])
            if code:
                raise RuntimeError(f"虚拟环境 Python 不可用（exit_code={code}）。请退出后重建 .runtime/venv。")
            display.finish("−", "环境已存在")
        else:
            code = self.task(Path(sys.executable), ["-m", "venv", str(VENV)])
            if code:
                raise RuntimeError(f"创建失败（exit_code={code}）。请移走 .runtime/venv 后重试。")
            saved = {**identity, "fingerprint": ""}
            save_json(ENVIRONMENT, saved)
            display.finish("✓", "已创建")

        self.check_cancel()
        check_args = ["-c", DEPENDENCY_CHECK, str(REQUIREMENTS)]
        if saved["fingerprint"] == fingerprint:
            display.start("检查运行依赖")
            code = self.task(VENV_PYTHON, check_args)
            if code == 0:
                display.finish("✓", "通过")
                display.write("−", "安装运行依赖", "无需安装")
                return
            display.finish("!", f"检查未通过（exit_code={code}），将重新安装")

        display.start("安装运行依赖")
        if saved["fingerprint"] != "":
            saved["fingerprint"] = ""
            save_json(ENVIRONMENT, saved)
        install_exit_code = self.task(
            VENV_PYTHON, ["-m", "pip", "--disable-pip-version-check", "--no-input", "install",
                          "--force-reinstall", "-r", str(REQUIREMENTS)],
        )
        if install_exit_code:
            raise RuntimeError(f"安装失败（exit_code={install_exit_code}）。请检查网络或 pip 配置后重试。")
        display.finish("✓", "安装完成")
        display.start("检查运行依赖")
        code = self.task(VENV_PYTHON, check_args) or self.task(
            VENV_PYTHON, ["-m", "pip", "--disable-pip-version-check", "check"],
        )
        if code:
            raise RuntimeError(f"检查未通过（exit_code={code}）。")
        self.check_cancel()
        saved["fingerprint"] = fingerprint
        save_json(ENVIRONMENT, saved)
        display.finish("✓", "通过")

    def start_service(self) -> None:
        display = self.display
        try:
            self.log_session = prepare_log_session(RUNTIME)
        except OSError as exc:
            display.write("!", "准备日志", f"无法创建日志目录，继续启动服务（{exc}）")
        log_path = self.log_session / "app.log" if self.log_session is not None else "不可用"
        display.start("启动服务")
        instance_id = uuid4().hex
        self.stop_file = RUNTIME / f"{instance_id}.stop"
        arguments = [str(VENV_PYTHON), "-u", "-m", "app.launcher", "--stop-file", str(self.stop_file),
                     "--parent-pid", str(os.getpid()), "--instance-id", instance_id]
        if self.log_session is not None:
            arguments.extend(("--log-dir", str(self.log_session)))
        if self.debug:
            arguments.append("--debug")
        self.service = subprocess.Popen(
            arguments, cwd=BACKEND, stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL, start_new_session=True,
        )
        save_json(SESSION, {"instance_id": instance_id})
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            self.check_cancel()
            code = self.service.poll()
            if code is not None:
                raise RuntimeError(f"进程已退出（exit_code={code}）。日志地址：{log_path}")
            if self.healthy(instance_id):
                break
            time.sleep(0.1)
            display.refresh()
        else:
            raise RuntimeError(f"服务在 30 秒内未就绪。{self.last_probe_error} 日志地址：{log_path}")
        display.finish("✓", "已就绪")
        self.open_browser()
        self.status(
            f"\nRename Studio {self.version} 已启动\n\n浏览器打开：{PAGE_URL}\n\n"
            f"日志地址：{log_path}\n\n按 Q 或 Ctrl+C 安全退出。\n"
        )
        while self.service.poll() is None:
            self.check_cancel()
            time.sleep(0.25)
        raise RuntimeError(f"服务意外退出（exit_code={self.service.returncode}）。日志地址：{log_path}")

    def run_locked(self) -> None:
        display = self.display
        display.write("✓", "检查 Python", f"Python {sys.version.split()[0]}")
        display.start("检查发布包")
        for path in (REQUIREMENTS, BACKEND / "app" / "launcher.py",
                     BACKEND / "app" / "release.py", ROOT / "frontend" / "dist" / "index.html"):
            if not path.is_file():
                raise RuntimeError(f"发布包缺少文件：{path}。请获取完整发布包。")
        display.finish("✓", "文件完整")
        display.start("检查端口")
        # Inspect listeners on both IPv4 and IPv6; never kill or change their port.
        listeners = subprocess.run(
            ["/usr/sbin/lsof", "-nP", "-iTCP:8000", "-sTCP:LISTEN"], capture_output=True, text=True,
        )
        if listeners.returncode not in (0, 1):
            raise RuntimeError(f"端口检查失败：{listeners.stderr.strip()}")
        if listeners.stdout.strip():
            raise RuntimeError(f"端口 8000 已被占用。请关闭占用端口的程序后重试。\n{listeners.stdout.strip()}")
        # Check bind permission/occupancy too; Uvicorn still reports any later race.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 8000))
        display.finish("✓", "8000 未占用")
        self.check_cancel()
        self.prepare_environment()
        self.check_cancel()
        self.start_service()

    def stop_service(self) -> None:
        if self.service is not None and self.service.poll() is None:
            self.status("正在等待当前请求完成。请在服务停止后关闭窗口。")
            self.stop_file.write_text("stop", encoding="utf-8")
            # No timeout kill: in-flight renames must reconcile before clients close.
            code = self.service.wait()
            if code:
                raise RuntimeError(f"服务停止失败（exit_code={code}）。请查看 app.log。")
            self.status("服务已停止。")


def main() -> int:
    parser = argparse.ArgumentParser(description="Start.sh 的 macOS 启动控制器")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        parser.error("请通过 Start.sh 在交互式终端中启动。")
    launcher = Launcher(args.no_browser, args.debug)
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, launcher.request_stop)
    input_fd = sys.stdin.fileno()
    input_mode = termios.tcgetattr(input_fd)
    code = 0
    try:
        # Read Q immediately while leaving Ctrl+C as a signal to the launcher.
        tty.setcbreak(input_fd)
        RUNTIME.mkdir(exist_ok=True)
        # flock is provided by Python/macOS, not an external command. The kernel
        # releases it on owner exit; do not unlink a lock inode another user opened.
        with (RUNTIME / "launcher.lock").open("a+b") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                launcher.display.write("−", "启动服务", "启动中或运行中")
                if SESSION.exists():
                    session = json.loads(SESSION.read_text(encoding="utf-8"))
                    if launcher.healthy(session["instance_id"]):
                        launcher.open_browser()
                return 0
            try:
                launcher.run_locked()
            except Cancelled:
                if launcher.display.step:
                    launcher.display.finish("−", "已取消")
                else:
                    launcher.status("正在退出。")
            except Exception as exc:
                code = 1
                launcher.display.finish("✗", str(exc))
            finally:
                try:
                    launcher.stop_service()
                finally:
                    if launcher.log_session and (launcher.service is None or launcher.service.poll() is not None):
                        with suppress(OSError):
                            (launcher.log_session / ".closed").touch()
                    SESSION.unlink(missing_ok=True)
                    if launcher.stop_file:
                        launcher.stop_file.unlink(missing_ok=True)
    except Exception as exc:
        # UI boundary: report the failure and return a failing code.
        code = 1
        launcher.display.finish("✗", str(exc))
    finally:
        termios.tcsetattr(input_fd, termios.TCSADRAIN, input_mode)
    if code:
        try:
            input("按 Enter 关闭")
        except EOFError:
            pass
    return code


if __name__ == "__main__":
    sys.exit(main())
