import logging
import re
from pathlib import Path
from uuid import uuid4

import pytest

from app.core.log_config import file_logging
from app.core.log_context import log_operation


@pytest.mark.parametrize("debug", [False, True])
def test_file_logging_level_format_and_exception_redaction(tmp_path: Path, debug: bool) -> None:
    path = tmp_path / "app.log"
    logger = logging.getLogger("rename_studio.rename")
    operation_id = str(uuid4())
    with file_logging(path, debug=debug), log_operation(operation_id, "default-local"):
        logger.debug("Checking metadata after an uncertain write")
        try:
            raise ValueError("token=mock-token file=C:/private/mock-file.txt")
        except ValueError:
            logger.exception("Rename diagnostic failed error_code=INTERNAL_ERROR")

    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == (2 if debug else 1)
    assert re.fullmatch(
        r"\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] ERROR \[Rename\] "
        rf"Rename diagnostic failed error_code=INTERNAL_ERROR operation_id={operation_id} "
        r"storage_id=default-local exception_type=ValueError",
        lines[-1],
    )
    if debug:
        assert "DEBUG [Rename] Checking metadata after an uncertain write" in lines[0]
