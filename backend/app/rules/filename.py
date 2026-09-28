def split_extension(filename: str) -> tuple[str, str]:
    """Split the final extension while treating dotfiles as extensionless names."""
    dot_index = filename.rfind(".")
    if dot_index <= 0:
        return filename, ""
    return filename[:dot_index], filename[dot_index:]
