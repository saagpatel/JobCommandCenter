from __future__ import annotations

import asyncio
import base64
from email.mime.text import MIMEText
from pathlib import Path

import structlog

logger = structlog.get_logger(__name__)


class GmailService:
    _SCOPES = ["https://www.googleapis.com/auth/gmail.send"]
    _TOKEN_DIR = Path.home() / ".jcc" / "gmail"
    _TOKEN_PATH = _TOKEN_DIR / "token.json"
    _CLIENT_SECRETS_PATH = _TOKEN_DIR / "client_secrets.json"

    def __init__(self) -> None:
        self._service = None

    def _get_credentials(self):
        """Load credentials from token file, refreshing if needed."""
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        if not self._TOKEN_PATH.exists():
            return None

        creds = Credentials.from_authorized_user_file(str(self._TOKEN_PATH), self._SCOPES)
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                self._TOKEN_PATH.write_text(creds.to_json())
            except Exception:
                logger.warning("Gmail token refresh failed, removing stale token")
                self._TOKEN_PATH.unlink(missing_ok=True)
                return None
        return creds if creds and creds.valid else None

    def _build_service(self):
        """Build Gmail API service from credentials."""
        from googleapiclient.discovery import build

        creds = self._get_credentials()
        if not creds:
            return None
        return build("gmail", "v1", credentials=creds)

    async def authorize(self) -> dict:
        """Run OAuth2 flow — opens browser for user consent."""
        def _do_auth():
            from google_auth_oauthlib.flow import InstalledAppFlow

            if not self._CLIENT_SECRETS_PATH.exists():
                raise FileNotFoundError(
                    f"Place your Google OAuth client_secrets.json at {self._CLIENT_SECRETS_PATH}"
                )

            self._TOKEN_DIR.mkdir(parents=True, exist_ok=True)
            flow = InstalledAppFlow.from_client_secrets_file(
                str(self._CLIENT_SECRETS_PATH), self._SCOPES
            )
            creds = flow.run_local_server(port=0)
            self._TOKEN_PATH.write_text(creds.to_json())

            from googleapiclient.discovery import build
            service = build("gmail", "v1", credentials=creds)
            profile = service.users().getProfile(userId="me").execute()
            return profile.get("emailAddress", "")

        loop = asyncio.get_running_loop()
        email = await loop.run_in_executor(None, _do_auth)
        self._service = None  # Reset cached service
        return {"authorized": True, "email": email}

    async def check_status(self) -> dict:
        """Check if Gmail is authorized."""
        def _check():
            creds = self._get_credentials()
            if not creds:
                return {"authorized": False, "email": None}

            try:
                from googleapiclient.discovery import build
                service = build("gmail", "v1", credentials=creds)
                profile = service.users().getProfile(userId="me").execute()
                return {"authorized": True, "email": profile.get("emailAddress")}
            except Exception:
                return {"authorized": False, "email": None}

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _check)

    async def send_email(
        self,
        to: str,
        subject: str,
        body_html: str,
        reply_to: str | None = None,
    ) -> dict:
        """Send an email via Gmail API."""
        def _send():
            service = self._build_service()
            if not service:
                raise RuntimeError("Gmail not authorized. Please connect Gmail first.")

            message = MIMEText(body_html, "html")
            message["to"] = to
            message["subject"] = subject
            if reply_to:
                message["reply-to"] = reply_to

            raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
            result = service.users().messages().send(
                userId="me", body={"raw": raw}
            ).execute()
            return {
                "message_id": result.get("id", ""),
                "thread_id": result.get("threadId", ""),
            }

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _send)

    async def disconnect(self) -> dict:
        """Remove stored token."""
        if self._TOKEN_PATH.exists():
            self._TOKEN_PATH.unlink()
        self._service = None
        logger.info("Gmail disconnected")
        return {"disconnected": True}
