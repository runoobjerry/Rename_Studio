from app.core.errors import ValidationError


def normalize_storage_path(path: str) -> str:
    parts = [part for part in path.replace("\\", "/").split("/") if part]
    # 所有 Provider 都只能从自身根目录向下解析路径。
    if any(part in {".", ".."} for part in parts):
        raise ValidationError("Directory path cannot contain '.' or '..'")
    return "/".join(parts)
