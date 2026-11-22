import logging
import re
import shutil
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from traceback import walk_tb
from unicodedata import east_asian_width

from app.core.log_context import operation_id_context, request_id_context, storage_id_context


terminal_logger = logging.getLogger("rename_studio.terminal")
terminal_logger.propagate = False
terminal_logger.addHandler(logging.NullHandler())


_MODULES = {
    "app": "App",
    "api": "API",
    "auth": "Auth",
    "cache": "Cache",
    "directory": "Directory",
    "google_drive": "GoogleDrive",
    "onedrive": "OneDrive",
    "preview": "Preview",
    "rename": "Rename",
    "storage": "Storage",
}
_STORAGE_ID = re.compile(r"(?:default-local|[0-9a-f]{32})")


class SessionFormatter(logging.Formatter):
    default_msec_format = "%s.%03d"

    def __init__(self, *, debug: bool) -> None:
        super().__init__()
        self.debug = debug

    def format(self, record: logging.LogRecord) -> str:
        timestamp = self.formatTime(record)
        module = _MODULES.get(record.name.rsplit(".", 1)[-1], "App")
        line = f"[{timestamp}] {record.levelname} [{module}] {record.getMessage()}"
        if self.debug and (request_id := request_id_context.get()) is not None:
            line += f" request_id={request_id}"
        operation_id = getattr(record, "operation_id", None) or operation_id_context.get()
        if operation_id is not None:
            line += f" operation_id={operation_id}"
        storage_id = getattr(record, "storage_id", None) or storage_id_context.get()
        if storage_id and _STORAGE_ID.fullmatch(storage_id):
            line += f" storage_id={storage_id}"
        if record.exc_info:
            error_type, _, traceback = record.exc_info
            line += f" exception_type={error_type.__name__}"
            # Exception messages, cause chains, source lines and paths can contain credentials.
            if record.levelno >= logging.ERROR and self.debug:
                locations = [
                    f"{frame.f_globals['__name__']}:{line_number}"
                    for frame, line_number in walk_tb(traceback)
                    if frame.f_globals.get("__name__", "").startswith("app.")
                ]
                if locations:
                    line += f" error_stack={','.join(locations)}"
        return line


class SessionFileHandler(logging.FileHandler):
    def handleError(self, record: logging.LogRecord) -> None:
        # The standard fallback prints the record and arguments to stderr on disk errors.
        pass


class TaskTerminalHandler(logging.StreamHandler):
    def __init__(self, relay: bool) -> None:
        super().__init__(sys.stdout)
        self.relay = relay
        self.interactive = self.stream.isatty()

    def emit(self, record: logging.LogRecord) -> None:
        body = record.getMessage()
        progress = getattr(record, "terminal_progress", False)
        if progress and not (self.interactive or self.relay):
            return

        error = record.levelno >= logging.ERROR
        prefix = "[ERROR]" if error else "[INFO]"
        line = f"{prefix} {body}\n"
        if self.relay and progress:
            line = f"[PROGRESS] {body}\n"
        if self.interactive and not self.relay:
            color = 31 if error else 32
            line = f"\033[{color}m{prefix}\033[0m {body}"
            if progress:
                width = len(prefix) + 1 + sum(2 if east_asian_width(char) in "WF" else 1 for char in body)
                if width >= shutil.get_terminal_size().columns:
                    line = ""
            else:
                line += "\n"
            line = f"\r\033[2K{line}"
        try:
            self.stream.write(line)
            self.flush()
        except OSError:
            self.handleError(record)


@contextmanager
def file_logging(path: Path | None, *, debug: bool) -> Iterator[None]:
    """Own the file handler for the lifetime of the server process."""
    logger = logging.getLogger("rename_studio")
    handler = None
    try:
        if path is not None:
            handler = SessionFileHandler(path, encoding="utf-8")
    except OSError:
        # An unavailable log file must not prevent use of the application.
        pass
    level, propagate = logger.level, logger.propagate
    logger.setLevel(logging.DEBUG if debug else logging.INFO)
    logger.propagate = False
    if handler is not None:
        handler.setFormatter(SessionFormatter(debug=debug))
        logger.addHandler(handler)
    try:
        yield
    finally:
        if handler is not None:
            logger.removeHandler(handler)
            try:
                handler.close()
            except OSError:
                pass
        logger.setLevel(level)
        logger.propagate = propagate


@contextmanager
def terminal_logging(*, relay: bool) -> Iterator[None]:
    """Show selected status messages in the release terminal."""
    handler = TaskTerminalHandler(relay)
    terminal_logger.addHandler(handler)
    try:
        yield
    finally:
        terminal_logger.removeHandler(handler)
        handler.close()
