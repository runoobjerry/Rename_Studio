import re


_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(10)),
    *(f"LPT{index}" for index in range(10)),
}
_INVALID_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def validate_portable_name(name: str) -> str | None:
    if not name or not name.strip():
        return "Filename cannot be empty"
    if name in {".", ".."}:
        return "Filename cannot be '.' or '..'"
    if _INVALID_NAME.search(name):
        return "Filename contains invalid characters"
    if name.endswith((" ", ".")):
        return "Filename cannot end with a space or period"
    stem = name.split(".", maxsplit=1)[0].upper()
    if stem in _WINDOWS_RESERVED_NAMES:
        return "Filename uses a reserved Windows name"
    if len(name) > 255:
        return "Filename is longer than 255 characters"
    return None


def validate_onedrive_name(name: str) -> str | None:
    portable_error = validate_portable_name(name)
    if portable_error is not None:
        return portable_error
    lowered = name.casefold()
    if name.startswith((" ", "~$")):
        return "OneDrive filename cannot start with a space or '~$'"
    if lowered in {".lock", "desktop.ini"} or "_vti_" in lowered:
        return "Filename is reserved by OneDrive"
    return None
