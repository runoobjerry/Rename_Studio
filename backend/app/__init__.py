"""Rename_Studio backend package."""

import logging


# Direct ASGI imports leave logging configuration to the caller.
logging.getLogger("rename_studio").addHandler(logging.NullHandler())
