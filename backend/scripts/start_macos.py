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
        print(f"\r\033[2K{self.frames[self.frame]} \033[90m{self.step}\033[0m", end="", flush=True)
        self.frame = (self.frame + 1) % len(self.frames)

    def finish(self, symbol: str, result: str) -> None:
        self.write(symbol, self.step or "Rename Studio", result)
        self.step = ""

    @staticmethod
    def write(symbol: str, step: str, result: str) -> None:
        if symbol == "✗":
            line = f"\033[31m{symbol} {step}  {result}\033[0m"
        elif symbol == "!":
            line = f"\033[33m{symbol} {step}  {result}\033[0m"
        else:
            if symbol == "✓":
                symbol = f"\033[32m{symbol}\033[0m"
            line = f"{symbol} \033[90m{step}\033[0m  {result}"
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
                self.display.write("!", "Open browser", f"Could not open the browser. Open {PAGE_URL} manually.")

    def healthy(self, instance_id: str) -> bool:
        try:
            for path in ("/api/health", "/"):
                with self.http.open(f"http://127.0.0.1:8000{path}", timeout=2) as response:
                    if response.status != 200 or response.headers.get("x-rename-studio-instance") != instance_id:
                        self.last_probe_error = "Unexpected response status or service instance."
                        return False
                    if path == "/api/health":
                        if json.load(response) != {"status": "ok"}:
                            self.last_probe_error = "Unexpected health check response."
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
        display.start("Prepare virtual environment")
        identity = {
            "project_root": str(ROOT), "python_executable": sys.executable,
            "python_version": sys.version.split()[0],
        }
        fingerprint = hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()
        saved = json.loads(ENVIRONMENT.read_text(encoding="utf-8-sig")) if ENVIRONMENT.exists() else None
        if VENV.exists():
            if not saved or any(saved[key] != value for key, value in identity.items()) or not VENV_PYTHON.is_file():
                raise RuntimeError(
                    "The virtual environment is unavailable, Python has changed, or the project has moved. "
                    "Exit, move or delete .runtime/venv, then restart."
                )
            version_check = "import sys; sys.exit(0 if sys.version.split()[0] == sys.argv[1] else 1)"
            code = self.task(VENV_PYTHON, ["-c", version_check, identity["python_version"]])
            if code:
                raise RuntimeError(
                    f"Could not verify the virtual environment's Python (exit_code={code}). Recreate .runtime/venv."
                )
            display.finish("−", "Reusing existing environment")
        else:
            code = self.task(Path(sys.executable), ["-m", "venv", str(VENV)])
            if code:
                raise RuntimeError(f"Could not create the environment (exit_code={code}). Move .runtime/venv aside and try again.")
            saved = {**identity, "fingerprint": ""}
            save_json(ENVIRONMENT, saved)
            display.finish("✓", "Created")

        self.check_cancel()
        check_args = ["-c", DEPENDENCY_CHECK, str(REQUIREMENTS)]
        if saved["fingerprint"] == fingerprint:
            display.start("Check runtime dependencies")
            code = self.task(VENV_PYTHON, check_args)
            if code == 0:
                display.finish("✓", "Passed")
                display.write("−", "Install runtime dependencies", "Already installed")
                return
            display.finish("!", f"Check failed (exit_code={code}). Reinstalling dependencies.")

        display.start("Install runtime dependencies")
        if saved["fingerprint"] != "":
            saved["fingerprint"] = ""
            save_json(ENVIRONMENT, saved)
        install_exit_code = self.task(
            VENV_PYTHON, ["-m", "pip", "--disable-pip-version-check", "--no-input", "install",
                          "--force-reinstall", "-r", str(REQUIREMENTS)],
        )
        if install_exit_code:
            raise RuntimeError(
                f"Installation failed (exit_code={install_exit_code}). Check your network or pip settings and try again."
            )
        display.finish("✓", "Installed")
        display.start("Check runtime dependencies")
        code = self.task(VENV_PYTHON, check_args) or self.task(
            VENV_PYTHON, ["-m", "pip", "--disable-pip-version-check", "check"],
        )
        if code:
            raise RuntimeError(f"Check failed (exit_code={code}).")
        self.check_cancel()
        saved["fingerprint"] = fingerprint
        save_json(ENVIRONMENT, saved)
        display.finish("✓", "Passed")

    def start_service(self) -> None:
        display = self.display
        try:
            self.log_session = prepare_log_session(RUNTIME)
        except OSError as exc:
            display.write("!", "Prepare log", f"Could not create the log directory ({exc}). Continuing startup.")
        log_path = self.log_session.relative_to(ROOT) / "app.log" if self.log_session is not None else "Unavailable"
        display.start("Start service")
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
                raise RuntimeError(f"Process exited (exit_code={code}). Log file: {log_path}")
            if self.healthy(instance_id):
                break
            time.sleep(0.1)
            display.refresh()
        else:
            raise RuntimeError(f"Service was not ready within 30 seconds. {self.last_probe_error} Log file: {log_path}")
        display.finish("✓", "Ready")
        self.open_browser()
        separator = "-" * 40
        self.status(
            f"\n{separator}\n\033[32mRename Studio {self.version}\033[0m is running\n\n"
            f"\033[90mOpen in browser:\033[0m {PAGE_URL}\n\n"
            f"\033[90mLog file:\033[0m {log_path}\n\nPress Q or Ctrl+C to exit safely.\n{separator}\n"
        )
        while self.service.poll() is None:
            self.check_cancel()
            time.sleep(0.25)
        raise RuntimeError(f"Service exited unexpectedly (exit_code={self.service.returncode}). Log file: {log_path}")

    def run_locked(self) -> None:
        display = self.display
        display.write("✓", "Check Python", f"Python {sys.version.split()[0]}")
        display.start("Check release package")
        for path in (REQUIREMENTS, BACKEND / "app" / "launcher.py",
                     BACKEND / "app" / "release.py", ROOT / "frontend" / "dist" / "index.html"):
            if not path.is_file():
                raise RuntimeError(f"Missing file: {path}. Download and extract the complete release package.")
        display.finish("✓", "All required files present")
        display.start("Check port")
        # Inspect listeners on both IPv4 and IPv6; never kill or change their port.
        listeners = subprocess.run(
            ["/usr/sbin/lsof", "-nP", "-iTCP:8000", "-sTCP:LISTEN"], capture_output=True, text=True,
        )
        if listeners.returncode not in (0, 1):
            raise RuntimeError(f"Port check failed: {listeners.stderr.strip()}")
        if listeners.stdout.strip():
            raise RuntimeError(f"Port 8000 is in use. Close the program using it and try again.\n{listeners.stdout.strip()}")
        # Check bind permission/occupancy too; Uvicorn still reports any later race.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 8000))
        display.finish("✓", "Port 8000 available")
        self.check_cancel()
        self.prepare_environment()
        self.check_cancel()
        self.start_service()

    def stop_service(self) -> None:
        if self.service is not None and self.service.poll() is None:
            self.status("Waiting for active requests to finish. Close the window after the service stops.")
            self.stop_file.write_text("stop", encoding="utf-8")
            # No timeout kill: in-flight renames must reconcile before clients close.
            code = self.service.wait()
            if code:
                raise RuntimeError(f"Service failed to stop cleanly (exit_code={code}). See app.log.")
            self.status("Service stopped.")


def main() -> int:
    parser = argparse.ArgumentParser(description="macOS launcher for Rename Studio")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        parser.error("Run Start.sh in an interactive terminal.")
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
                launcher.display.write("−", "Start service", "Already starting or running")
                if SESSION.exists():
                    session = json.loads(SESSION.read_text(encoding="utf-8"))
                    if launcher.healthy(session["instance_id"]):
                        launcher.open_browser()
                return 0
            try:
                launcher.run_locked()
            except Cancelled:
                if launcher.display.step:
                    launcher.display.finish("−", "Canceled")
                else:
                    launcher.status("Exiting.")
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
            input("Press Enter to close")
        except EOFError:
            pass
    return code


if __name__ == "__main__":
    sys.exit(main())
