from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.services.gmail import GmailService


class TestGmailService:
    async def test_check_status_no_token(self, tmp_path: Path) -> None:
        service = GmailService()
        with patch.object(GmailService, "_TOKEN_PATH", tmp_path / "nonexistent.json"):
            result = await service.check_status()
            assert result["authorized"] is False
            assert result["email"] is None

    async def test_check_status_with_token(self, tmp_path: Path) -> None:
        service = GmailService()
        token_path = tmp_path / "token.json"
        token_path.write_text('{"token": "fake", "refresh_token": "fake", "client_id": "fake", "client_secret": "fake"}')

        mock_creds = MagicMock()
        mock_creds.valid = True
        mock_creds.expired = False

        mock_service = MagicMock()
        mock_service.users.return_value.getProfile.return_value.execute.return_value = {
            "emailAddress": "test@gmail.com"
        }

        with patch.object(GmailService, "_TOKEN_PATH", token_path), \
             patch("src.services.gmail.GmailService._get_credentials", return_value=mock_creds), \
             patch("googleapiclient.discovery.build", return_value=mock_service):
            result = await service.check_status()
            assert result["authorized"] is True
            assert result["email"] == "test@gmail.com"

    async def test_disconnect_deletes_token(self, tmp_path: Path) -> None:
        service = GmailService()
        token_path = tmp_path / "token.json"
        token_path.write_text("{}")

        with patch.object(GmailService, "_TOKEN_PATH", token_path):
            result = await service.disconnect()
            assert result["disconnected"] is True
            assert not token_path.exists()

    async def test_send_email_not_authorized(self, tmp_path: Path) -> None:
        service = GmailService()

        with patch.object(GmailService, "_TOKEN_PATH", tmp_path / "nonexistent.json"):
            with pytest.raises(RuntimeError, match="Gmail not authorized"):
                await service.send_email(
                    to="test@example.com",
                    subject="Test",
                    body_html="<p>Hello</p>",
                )

    async def test_authorize_no_client_secrets(self, tmp_path: Path) -> None:
        service = GmailService()

        with patch.object(GmailService, "_CLIENT_SECRETS_PATH", tmp_path / "nonexistent.json"), \
             patch.object(GmailService, "_TOKEN_DIR", tmp_path):
            with pytest.raises(FileNotFoundError, match="client_secrets.json"):
                await service.authorize()
