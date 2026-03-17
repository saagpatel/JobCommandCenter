from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.api.models import ApplicantProfile, JobListing
from src.services.claude_ai import ClaudeAIService


def _make_profile() -> ApplicantProfile:
    return ApplicantProfile(
        first_name="Jane",
        last_name="Doe",
        email="jane@example.com",
        phone="555-0100",
        linkedin_url="https://linkedin.com/in/janedoe",
        location="San Francisco, CA",
        authorized_to_work=True,
        requires_sponsorship=False,
    )


def _make_job() -> JobListing:
    return JobListing(
        company="Acme Corp",
        role="Software Engineer",
        ats="linkedin",
        apply_url="https://www.linkedin.com/jobs/view/12345",
        resume_path="/tmp/resume.pdf",
    )


class TestClaudeAIService:
    async def test_map_fields_returns_dict(self) -> None:
        service = ClaudeAIService()

        mock_response = MagicMock()
        mock_block = MagicMock()
        mock_block.type = "text"
        mock_block.text = json.dumps({"Years of experience": "5", "Willing to relocate": "Yes"})
        mock_response.content = [mock_block]

        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_response)
        service._client = mock_client

        questions = [
            {"label": "Years of experience", "type": "text", "required": True},
            {"label": "Willing to relocate", "type": "text", "required": True},
        ]

        result = await service.map_fields(questions, _make_profile(), _make_job())
        assert result == {"Years of experience": "5", "Willing to relocate": "Yes"}

    async def test_map_fields_missing_api_key(self) -> None:
        service = ClaudeAIService()

        with patch("src.services.claude_ai.get_credential", return_value=None):
            with pytest.raises(RuntimeError, match="Anthropic API key not found"):
                await service.map_fields([], _make_profile(), _make_job())

    async def test_map_fields_handles_invalid_json(self) -> None:
        service = ClaudeAIService()

        mock_response = MagicMock()
        mock_block = MagicMock()
        mock_block.type = "text"
        mock_block.text = "I cannot answer these questions as written."
        mock_response.content = [mock_block]

        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_response)
        service._client = mock_client

        result = await service.map_fields(
            [{"label": "Q1", "type": "text", "required": True}],
            _make_profile(),
            _make_job(),
        )
        assert result == {}

    async def test_map_fields_handles_markdown_json(self) -> None:
        service = ClaudeAIService()

        mock_response = MagicMock()
        mock_block = MagicMock()
        mock_block.type = "text"
        mock_block.text = '```json\n{"Q1": "answer1"}\n```'
        mock_response.content = [mock_block]

        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_response)
        service._client = mock_client

        result = await service.map_fields(
            [{"label": "Q1", "type": "text", "required": True}],
            _make_profile(),
            _make_job(),
        )
        assert result == {"Q1": "answer1"}

    async def test_draft_followup_returns_subject_body(self) -> None:
        service = ClaudeAIService()

        mock_response = MagicMock()
        mock_block = MagicMock()
        mock_block.type = "text"
        mock_block.text = json.dumps({
            "subject": "Following up on Software Engineer application",
            "body": "I hope this message finds you well. I wanted to follow up on my application."
        })
        mock_response.content = [mock_block]

        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_response)
        service._client = mock_client

        result = await service.draft_followup(
            company="Acme Corp",
            role="Software Engineer",
            applied_date="2026-03-10",
        )
        assert "subject" in result
        assert "body" in result
        assert "Software Engineer" in result["subject"]

    async def test_draft_followup_missing_api_key(self) -> None:
        service = ClaudeAIService()

        with patch("src.services.claude_ai.get_credential", return_value=None):
            with pytest.raises(RuntimeError, match="Anthropic API key not found"):
                await service.draft_followup(
                    company="Acme Corp",
                    role="Software Engineer",
                    applied_date="2026-03-10",
                )

    async def test_draft_followup_handles_invalid_json(self) -> None:
        service = ClaudeAIService()

        mock_response = MagicMock()
        mock_block = MagicMock()
        mock_block.type = "text"
        mock_block.text = "Here is a nice follow-up email for you."
        mock_response.content = [mock_block]

        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_response)
        service._client = mock_client

        result = await service.draft_followup(
            company="Acme Corp",
            role="Software Engineer",
            applied_date="2026-03-10",
        )
        assert "subject" in result
        assert "body" in result
        # Should use fallback subject
        assert "Software Engineer" in result["subject"]

    async def test_interview_prep_returns_markdown(self) -> None:
        service = ClaudeAIService()

        mock_response = MagicMock()
        mock_block = MagicMock()
        mock_block.type = "text"
        mock_block.text = "## Company Overview\nAcme Corp is a tech company.\n## Recent News"
        mock_response.content = [mock_block]

        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_response)
        service._client = mock_client

        result = await service.interview_prep(
            company="Acme Corp",
            role="Software Engineer",
        )
        assert "Company Overview" in result
        assert isinstance(result, str)

    async def test_interview_prep_missing_api_key(self) -> None:
        service = ClaudeAIService()

        with patch("src.services.claude_ai.get_credential", return_value=None):
            with pytest.raises(RuntimeError, match="Anthropic API key not found"):
                await service.interview_prep(
                    company="Acme Corp",
                    role="Software Engineer",
                )
