from app.providers.shared.name_validation import NameValidationIssue, validate_portable_name
from app.schemas.files import FileItem


def validate_onedrive_name(name: str) -> NameValidationIssue | None:
    # OneDrive uses the portable rules because files also sync to Windows.
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


def validate_onedrive_name_in_context(item: FileItem, name: str) -> NameValidationIssue | None:
    reserved_root_name = "forms"
    if item.parent_path == "" and name.casefold() == reserved_root_name:
        return NameValidationIssue("NAME_RESERVED_IN_ROOT", "'forms' is reserved at the OneDrive root", {"name": reserved_root_name})
    invalid_folder_prefixes = ("゛", "ဧ")
    if item.is_directory and name.startswith(invalid_folder_prefixes):
        return NameValidationIssue("ONEDRIVE_FOLDER_INVALID_PREFIX", "OneDrive folder name starts with a restricted character", {"prefixes": list(invalid_folder_prefixes)})
    decoded_path = f"{item.parent_path}/{name}".strip("/")
    max_path_length = 400
    if len(decoded_path) > max_path_length:
        return NameValidationIssue("ONEDRIVE_PATH_TOO_LONG", f"OneDrive path is longer than {max_path_length} characters", {"max_length": max_path_length})
    return None
