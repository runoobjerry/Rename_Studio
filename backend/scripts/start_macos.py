"""Standard-library controller for Start.sh; never imports runtime packages here."""

import argparse
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
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
RUNTIME = ROOT / ".runtime"
VENV = RUNTIME / "venv"
VENV_PYTHON = VENV / "bin" / "python"
REQUIREMENTS = BACKEND / "requirements-runtime.txt"
ENVIRONMENT = RUNTIME / "environment.json"
SESSION = RUNTIME / "session.json"
PAGE_URL = "http://localhost:8000"

DEPENDENCY_CHECK = """
import fastapi, httpx, pydantic_settings, sqlalchemy, uvicorn
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


class Launcher:
    def __init__(self, no_browser: bool) -> None:
        self.no_browser = no_browser
        self.cancelled = False
        self.log_file: Path | None = None
        self.service: subprocess.Popen | None = None
        self.stop_file: Path | None = None
        self.last_probe_error = ""
        # Local probes must not be sent through a user's HTTP proxy.
        self.http = build_opener(ProxyHandler({}))
        self.run_name = time.strftime("%Y%m%d-%H%M%S") + f"-{os.getpid()}"

    def status(self, message: str) -> None:
        print(message, flush=True)
        if self.log_file:
            with self.log_file.open("a", encoding="utf-8") as log:
                log.write(f"[{time.strftime('%H:%M:%S')}] {message}\n")

    def request_stop(self, _signum: int, _frame: object) -> None:
        # Do not raise inside Popen/metadata writes; finish the step then clean up.
        self.cancelled = True

    def check_cancel(self) -> None:
        if select.select([sys.stdin], [], [], 0)[0]:
            if sys.stdin.readline().strip().lower() == "q":
                self.cancelled = True
        if self.cancelled:
            raise Cancelled

    def open_browser(self) -> None:
        if not self.no_browser:
            result = subprocess.run(["/usr/bin/open", PAGE_URL], capture_output=True)
            if result.returncode:
                self.status(f"无法自动打开浏览器，请手动访问 {PAGE_URL}")

    def healthy(self, instance_id: str) -> bool:
        try:
            for path in ("/api/health", "/"):
                with self.http.open(f"http://127.0.0.1:8000{path}", timeout=2) as response:
                    if response.status != 200 or response.headers.get("x-rename-studio-instance") != instance_id:
                        self.last_probe_error = "响应不属于本次服务或状态异常。"
                        return False
                    if path == "/api/health" and json.load(response) != {"status": "ok"}:
                        self.last_probe_error = "健康检查响应异常。"
                        return False
            return True
        except (URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as exc:
            # Startup retries have a deadline; preserve the final error for diagnosis.
            self.last_probe_error = str(exc)
            return False

    def task(self, executable: Path, arguments: list[str], label: str) -> int:
        log_root = RUNTIME / "logs"
        with (log_root / f"{self.run_name}-{label}.stdout.log").open("w") as stdout, \
             (log_root / f"{self.run_name}-{label}.stderr.log").open("w") as stderr:
            process = subprocess.Popen(
                [str(executable), *arguments], cwd=BACKEND, stdout=stdout,
                stderr=stderr, stdin=subprocess.DEVNULL, start_new_session=True,
            )
            try:
                while process.poll() is None:
                    self.check_cancel()
                    time.sleep(0.25)
            finally:
                if process.poll() is None:
                    # Cancel only our setup process group, including pip build helpers.
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        self.status(f"{label} 进程退出码：{process.returncode}")
        return process.returncode

    def prepare_environment(self) -> None:
        identity = {
            "project_root": str(ROOT), "python_executable": sys.executable,
            "python_version": sys.version.split()[0],
        }
        fingerprint = hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()
        saved = json.loads(ENVIRONMENT.read_text(encoding="utf-8-sig")) if ENVIRONMENT.exists() else None
        if VENV.exists():
            if not saved or any(saved[key] != value for key, value in identity.items()) or not VENV_PYTHON.is_file():
                raise RuntimeError("运行环境不可用、Python 已变化或项目已移动。请退出后移走或删除 .runtime/venv，再启动；不要删除 settings.json。")
            version_check = "import sys; sys.exit(0 if sys.version.split()[0] == sys.argv[1] else 1)"
            if self.task(VENV_PYTHON, ["-c", version_check, identity["python_version"]], "python"):
                raise RuntimeError("虚拟环境 Python 不可用，请退出后重建 .runtime/venv。")
        else:
            self.status("首次启动：创建独立 Python 虚拟环境……")
            if self.task(Path(sys.executable), ["-m", "venv", str(VENV)], "venv"):
                raise RuntimeError("虚拟环境创建失败，请查看 venv 日志；移走 .runtime/venv 后重试。")
            saved = {**identity, "fingerprint": ""}
            save_json(ENVIRONMENT, saved)

        self.check_cancel()
        if saved["fingerprint"] == fingerprint and self.task(
            VENV_PYTHON, ["-c", DEPENDENCY_CHECK, str(REQUIREMENTS)], "dependencies"
        ) == 0:
            self.status("依赖未变化且检查通过，跳过 pip install（无需联网）。")
            return

        saved["fingerprint"] = ""
        save_json(ENVIRONMENT, saved)
        self.status("安装运行依赖，需要联网；详细输出写入 install 日志。")
        if self.task(VENV_PYTHON, ["-m", "pip", "--disable-pip-version-check", "--no-input", "install",
                                  "--force-reinstall", "-r", str(REQUIREMENTS)], "install"):
            raise RuntimeError("依赖安装失败，请查看 install 日志，检查网络或 pip 配置后重试；未记录安装成功。")
        if self.task(VENV_PYTHON, ["-c", DEPENDENCY_CHECK, str(REQUIREMENTS)], "dependencies") or self.task(
            VENV_PYTHON, ["-m", "pip", "--disable-pip-version-check", "check"], "pip-check"
        ):
            raise RuntimeError("运行依赖检查失败，请查看 dependencies / pip-check 日志。")
        self.check_cancel()
        saved["fingerprint"] = fingerprint
        save_json(ENVIRONMENT, saved)

    def start_service(self) -> None:
        instance_id = uuid4().hex
        self.stop_file = RUNTIME / f"{instance_id}.stop"
        log_root = RUNTIME / "logs"
        with (log_root / f"{self.run_name}-service.stdout.log").open("w") as stdout, \
             (log_root / f"{self.run_name}-service.stderr.log").open("w") as stderr:
            self.service = subprocess.Popen(
                [str(VENV_PYTHON), "-u", "-m", "app.launcher", "--stop-file", str(self.stop_file),
                 "--parent-pid", str(os.getpid()), "--instance-id", instance_id],
                cwd=BACKEND, stdout=stdout, stderr=stderr, stdin=subprocess.DEVNULL, start_new_session=True,
            )
        save_json(SESSION, {"instance_id": instance_id})
        self.status("等待页面和 API 就绪（约 30 秒超时）……")
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            self.check_cancel()
            if self.service.poll() is not None:
                raise RuntimeError("服务启动失败，请查看 service 日志。")
            if self.healthy(instance_id):
                break
            time.sleep(0.25)
        else:
            raise RuntimeError(f"服务未在 30 秒内就绪：{self.last_probe_error}；请查看 service 日志。")
        self.status(f"服务已就绪：{PAGE_URL}。保持窗口打开；输入 Q 后按 Enter，或按 Ctrl+C 安全退出。")
        self.open_browser()
        while self.service.poll() is None:
            self.check_cancel()
            time.sleep(0.25)
        raise RuntimeError("服务意外退出，请查看 service 日志。")

    def run_locked(self) -> None:
        log_root = RUNTIME / "logs"
        log_root.mkdir(exist_ok=True)
        for old in sorted(log_root.glob("*.log"), key=lambda path: path.stat().st_mtime, reverse=True)[40:]:
            old.unlink()
        self.log_file = log_root / f"{self.run_name}-launcher.log"
        self.status(f"启动 Rename Studio；日志目录：{log_root}")
        self.status(f"使用 Python {sys.version.split()[0]}：{sys.executable}")
        for path in (REQUIREMENTS, BACKEND / "pyproject.toml", BACKEND / "app" / "launcher.py",
                     BACKEND / "app" / "release.py", ROOT / "frontend" / "dist" / "index.html"):
            if not path.is_file():
                raise RuntimeError(f"发布包缺少文件：{path}；请获取完整发布包，脚本不会构建前端。")
        # Inspect listeners on both IPv4 and IPv6; never kill or change their port.
        listeners = subprocess.run(
            ["/usr/sbin/lsof", "-nP", "-iTCP:8000", "-sTCP:LISTEN"], capture_output=True, text=True,
        )
        if listeners.returncode not in (0, 1):
            raise RuntimeError(f"端口检查失败：{listeners.stderr.strip()}")
        if listeners.stdout.strip():
            raise RuntimeError(f"端口 8000 已被占用，请自行关闭占用程序后重试：\n{listeners.stdout.strip()}")
        # Check bind permission/occupancy too; Uvicorn still reports any later race.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 8000))
        self.check_cancel()
        self.prepare_environment()
        self.check_cancel()
        self.start_service()

    def stop_service(self) -> None:
        if self.service is not None:
            if self.service.poll() is None:
                self.status("正在停止服务：等待当前请求完成，请勿强行关闭窗口……")
                self.stop_file.write_text("stop", encoding="utf-8")
            # No timeout kill: in-flight renames must reconcile before clients close.
            code = self.service.wait()
            if code:
                raise RuntimeError(f"服务退出码：{code}；请查看 service 日志。")
            self.status("服务已停止。")


def main() -> int:
    parser = argparse.ArgumentParser(description="Start.sh 的 macOS 启动控制器")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        parser.error("请通过 Start.sh 在交互式终端中启动。")
    launcher = Launcher(args.no_browser)
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, launcher.request_stop)
    code = 0
    try:
        RUNTIME.mkdir(exist_ok=True)
        # flock is provided by Python/macOS, not an external command. The kernel
        # releases it on owner exit; do not unlink a lock inode another user opened.
        with (RUNTIME / "launcher.lock").open("a+b") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                launcher.status("本项目已经在启动或运行，不会重复创建进程。")
                if SESSION.exists():
                    session = json.loads(SESSION.read_text(encoding="utf-8"))
                    if launcher.healthy(session["instance_id"]):
                        launcher.open_browser()
                return 0
            try:
                launcher.run_locked()
            except Cancelled:
                launcher.status("正在退出。")
            finally:
                try:
                    launcher.stop_service()
                finally:
                    SESSION.unlink(missing_ok=True)
                    if launcher.stop_file:
                        launcher.stop_file.unlink(missing_ok=True)
    except Exception as exc:
        # UI boundary: report the failure, preserve logs, and return a failing code.
        code = 1
        launcher.status(f"错误：{exc}")
    if code:
        try:
            input("按 Enter 关闭；错误日志已保留：.runtime/logs ")
        except EOFError:
            pass
    return code


if __name__ == "__main__":
    sys.exit(main())
