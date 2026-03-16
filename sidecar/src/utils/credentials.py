from __future__ import annotations

import keyring
import keyring.errors

SERVICE_NAME = "job-command-center"


def get_credential(key: str) -> str | None:
    """Retrieve a credential from the macOS Keychain.

    Returns the stored value, or None if no entry exists.
    """
    return keyring.get_password(SERVICE_NAME, key)


def set_credential(key: str, value: str) -> None:
    """Store a credential in the macOS Keychain."""
    keyring.set_password(SERVICE_NAME, key, value)


def delete_credential(key: str) -> None:
    """Delete a credential from the macOS Keychain.

    Silently ignores the case where no entry exists.
    """
    try:
        keyring.delete_password(SERVICE_NAME, key)
    except keyring.errors.PasswordDeleteError:
        pass
