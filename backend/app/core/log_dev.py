import logging
import os
import sys
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager, suppress
from pathlib import Path

from app.core.log_config import file_logging
from app.core.log_sessions import create_log_session, prune_log_sessions, server_log_guard


logger = logging.getLogger("rename_studio.app")
_RUNTIME = Path(__file__).resolve().parents[3] / ".runtime"
DEV_LOG_LEVEL_ENV = "RENAME_STUDIO_DEV_LOG_LEVEL"


@contextmanager
def development_log_session(version: str) -> Iterator[None]:
    level = os.environ.get(DEV_LOG_LEVEL_ENV, "INFO")
    if level == "OFF":
        with file_logging(None, debug=False):
            yield
        return

    with ExitStack() as stack:
        try:
            _RUNTIME.mkdir(exist_ok=True)
            stack.enter_context(server_log_guard(_RUNTIME))
            session = create_log_session(_RUNTIME / "logs")
        except OSError:
            session = None
            print("Development log directory is unavailable.", file=sys.stderr, flush=True)

        path = session / "app.log" if session is not None else None
        if session is not None:
            with suppress(OSError):
                prune_log_sessions(session, closed_only=True)
            print(f"Development log: {path}", flush=True)

        try:
            with file_logging(path, debug=level == "DEBUG"):
                logger.info("Development server process started version=%s", version)
                try:
                    yield
                finally:
                    logger.info("Development server process stopped")
        finally:
            if session is not None:
                with suppress(OSError):
                    (session / ".closed").touch()
