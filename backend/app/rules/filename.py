def split_extension(filename: str) -> tuple[str, str]:
    """Split the final extension while treating dotfiles as extensionless names."""
    dot_index = filename.rfind(".")
    if dot_index <= 0:
        return filename, ""
    return filename[:dot_index], filename[dot_index:]


def character_gap(name: str, index: int, from_right: bool) -> int:
    """Resolve an insertion gap, clamping it to the name's ends."""
    if from_right:
        return max(len(name) - index, 0)
    return min(index, len(name))
