from __future__ import annotations

from pathlib import Path

_MAX_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
_PDF_MAGIC = b"%PDF"


def validate_file(path: str) -> tuple[bool, str]:
    """Validate that a file exists, is a PDF, and is under 5 MB.

    Returns (True, "ok") on success or (False, reason) on failure.
    """
    p = Path(path)

    if not p.exists():
        return False, f"file does not exist: {path}"

    if not p.is_file():
        return False, f"path is not a regular file: {path}"

    try:
        with p.open("rb") as fh:
            magic = fh.read(4)
    except OSError as exc:
        return False, f"could not read file: {exc}"

    if magic != _PDF_MAGIC:
        return False, f"file does not appear to be a PDF (bad magic bytes): {path}"

    size = p.stat().st_size
    if size > _MAX_SIZE_BYTES:
        return False, f"file exceeds 5 MB limit ({size} bytes): {path}"

    return True, "ok"


def expand_path(path: str) -> str:
    """Expand ~ to the user's home directory."""
    return str(Path(path).expanduser())
