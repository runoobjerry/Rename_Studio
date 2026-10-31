import re
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class NameValidationIssue:
    reason: str
    message: str
    params: dict[str, str | int | list[str]] = field(default_factory=dict)

    @property
    def details(self) -> dict[str, object]:
        return {"reason": self.reason, "params": self.params}


_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(10)),
    *(f"LPT{index}" for index in range(10)),
}
_INVALID_CHARACTERS = '<>:"/\\|?*'
_CONTROL_CHARACTER_MAX = 0x1F
_INVALID_NAME = re.compile(rf'[{re.escape(_INVALID_CHARACTERS)}\x00-\x{_CONTROL_CHARACTER_MAX:02x}]')
_MAX_NAME_LENGTH = 255


def validate_portable_name(name: str) -> NameValidationIssue | None:
    if not name or not name.strip():
        return NameValidationIssue("NAME_EMPTY", "Filename cannot be empty")
    if name in {".", ".."}:
        return NameValidationIssue("NAME_DOT_SEGMENT", "Filename cannot be '.' or '..'")
    if _INVALID_NAME.search(name):
        return NameValidationIssue("NAME_INVALID_CHARACTERS", "Filename contains invalid characters", {
            "characters": list(_INVALID_CHARACTERS),
            "control_characters": f"U+0000–U+{_CONTROL_CHARACTER_MAX:04X}",
        })
    if name.endswith((" ", ".")):
        return NameValidationIssue("NAME_INVALID_ENDING", "Filename cannot end with a space or period")
    stem = name.split(".", maxsplit=1)[0].upper()
    if stem in _WINDOWS_RESERVED_NAMES:
        return NameValidationIssue("NAME_RESERVED_WINDOWS", "Filename uses a reserved Windows name")
    if len(name) > _MAX_NAME_LENGTH:
        return NameValidationIssue("NAME_TOO_LONG", f"Filename is longer than {_MAX_NAME_LENGTH} characters", {"max_length": _MAX_NAME_LENGTH})
    return None


def validate_onedrive_name(name: str) -> NameValidationIssue | None:
    portable_error = validate_portable_name(name)
    if portable_error is not None:
        return portable_error
    lowered = name.casefold()
    invalid_prefixes = (" ", "~$")
    if name.startswith(invalid_prefixes):
        return NameValidationIssue("ONEDRIVE_NAME_INVALID_PREFIX", "OneDrive filename cannot start with a space or '~$'", {"prefixes": list(invalid_prefixes)})
    if lowered in {".lock", "desktop.ini"} or "_vti_" in lowered:
        return NameValidationIssue("NAME_RESERVED_ONEDRIVE", "Filename is reserved by OneDrive")
    return None
