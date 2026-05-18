from __future__ import annotations

from urllib.parse import urlparse


def hostname_matches(url: str, trusted_domain: str) -> bool:
    """Return true when a URL host is the trusted domain or its subdomain."""
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    domain = trusted_domain.lower().rstrip(".")
    return hostname == domain or hostname.endswith(f".{domain}")
