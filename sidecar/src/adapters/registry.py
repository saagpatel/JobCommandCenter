from __future__ import annotations

from src.adapters.base import BaseAdapter


class AdapterRegistry:
    def __init__(self) -> None:
        self._adapters: dict[str, BaseAdapter] = {}

    def register(self, name: str, adapter: BaseAdapter) -> None:
        """Register an adapter under the given name."""
        self._adapters[name] = adapter

    def get(self, name: str) -> BaseAdapter | None:
        """Return the adapter registered under name, or None if not found."""
        return self._adapters.get(name)

    def list(self) -> list[str]:
        """Return a list of all registered adapter names."""
        return list(self._adapters.keys())
