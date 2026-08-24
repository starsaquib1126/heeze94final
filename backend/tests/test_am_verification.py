"""
Tests for Account Manager email verification on the public offer-request
form — proves whoever is submitting a request actually has access to
the selected Account Manager's own registered email before the request
is accepted.

This is genuinely new test coverage: the public offer-request submission
endpoint itself had zero existing tests before this feature was built.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.public import _verify_am_code

TENANT = uuid4()
AM_ID = uuid4()


def _mock_db_with_code_row(row: dict | None) -> MagicMock:
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .order.return_value.limit.return_value.execute.return_value.data = [row] if row else []
    return db


def _valid_row(code: str = "123456", used_at=None, expires_in_minutes: int = 10) -> dict:
    return {
        "id": str(uuid4()),
        "code": code,
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=expires_in_minutes)).isoformat(),
        "used_at": used_at,
    }


def test_correct_unused_unexpired_code_succeeds() -> None:
    db = _mock_db_with_code_row(_valid_row(code="123456"))
    _verify_am_code(db, TENANT, AM_ID, "123456")  # should not raise
    # And it must mark the code used, so it can't be replayed.
    db.table.return_value.update.assert_called_once()


def test_wrong_code_is_rejected() -> None:
    db = _mock_db_with_code_row(_valid_row(code="123456"))
    with pytest.raises(HTTPException) as exc_info:
        _verify_am_code(db, TENANT, AM_ID, "000000")
    assert exc_info.value.status_code == 400
    assert "Incorrect" in exc_info.value.detail


def test_no_code_ever_sent_is_rejected() -> None:
    db = _mock_db_with_code_row(None)
    with pytest.raises(HTTPException) as exc_info:
        _verify_am_code(db, TENANT, AM_ID, "123456")
    assert exc_info.value.status_code == 400
    assert "No verification code" in exc_info.value.detail


def test_expired_code_is_rejected_even_if_correct() -> None:
    db = _mock_db_with_code_row(_valid_row(code="123456", expires_in_minutes=-5))
    with pytest.raises(HTTPException) as exc_info:
        _verify_am_code(db, TENANT, AM_ID, "123456")
    assert exc_info.value.status_code == 400
    assert "expired" in exc_info.value.detail.lower()


def test_already_used_code_cannot_be_replayed() -> None:
    already_used_at = datetime.now(timezone.utc).isoformat()
    db = _mock_db_with_code_row(_valid_row(code="123456", used_at=already_used_at))
    with pytest.raises(HTTPException) as exc_info:
        _verify_am_code(db, TENANT, AM_ID, "123456")
    assert exc_info.value.status_code == 400
    assert "already been used" in exc_info.value.detail


def test_code_with_surrounding_whitespace_still_matches() -> None:
    """A person copy-pasting from an email might pick up a stray space."""
    db = _mock_db_with_code_row(_valid_row(code="123456"))
    _verify_am_code(db, TENANT, AM_ID, "  123456  ")  # should not raise


def test_only_the_most_recent_code_is_checked() -> None:
    """Requesting a new code should invalidate the relevance of an older
    one — verified here by confirming the query orders by created_at
    descending and takes only the top row."""
    db = _mock_db_with_code_row(_valid_row(code="999999"))
    _verify_am_code(db, TENANT, AM_ID, "999999")
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.order \
        .assert_called_once_with("created_at", desc=True)


# ---------------------------------------------------------------------- #
# demo_mode — real email sending unblocked for testing/demoing while
# Resend isn't fully configured with a verified domain yet
# ---------------------------------------------------------------------- #
class TestDemoModeSkipsRealEmail:
    """
    demo_mode is scoped to exactly one thing: returning the AM
    verification code directly in the API response instead of emailing
    it, so the verification flow can be tested/demoed without real
    email delivery working. Must default to off, and must never call
    the real EmailService when on.
    """

    def test_demo_mode_defaults_to_off(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("DEMO_MODE", raising=False)
        # PLATFORM_OWNER_KEY is set in the test environment for other
        # tests' benefit, but Settings doesn't declare that field and
        # rejects unknown extras on direct construction like this.
        monkeypatch.delenv("PLATFORM_OWNER_KEY", raising=False)
        from app.core.config import Settings
        s = Settings(
            supabase_url="x", supabase_anon_key="x", supabase_service_key="x",
            supabase_jwt_secret="x" * 32, resend_api_key="x",
        )
        assert s.demo_mode is False

    def test_demo_mode_true_returns_code_and_skips_email(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import app.api.v1.endpoints.public as public_module
        from app.core.config import Settings

        monkeypatch.setattr(
            public_module, "get_settings",
            lambda: Settings(
                supabase_url="x", supabase_anon_key="x", supabase_service_key="x",
                supabase_jwt_secret="x" * 32, resend_api_key="x",
                demo_mode=True,
            ),
        )

        mock_email_service = MagicMock()
        monkeypatch.setattr(public_module, "EmailService", lambda: mock_email_service)

        mock_db = MagicMock()
        mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value \
            .maybe_single.return_value.execute.return_value.data = {
                "id": str(AM_ID), "full_name": "Test AM", "email": "am@test.com",
            }
        monkeypatch.setattr(public_module, "get_service_db", lambda: mock_db)
        monkeypatch.setattr(
            public_module, "_resolve_tenant",
            lambda slug: {"id": str(TENANT), "name": "Test", "is_active": True},
        )

        result = public_module.send_am_verification_code(AM_ID, tenant_slug="test")

        assert "demo_code" in result
        assert len(result["demo_code"]) == 6
        mock_email_service.send_am_verification_code.assert_not_called()

    def test_demo_mode_false_sends_real_email_and_omits_code(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import app.api.v1.endpoints.public as public_module
        from app.core.config import Settings

        monkeypatch.setattr(
            public_module, "get_settings",
            lambda: Settings(
                supabase_url="x", supabase_anon_key="x", supabase_service_key="x",
                supabase_jwt_secret="x" * 32, resend_api_key="x",
                demo_mode=False,
            ),
        )

        mock_email_service = MagicMock()
        monkeypatch.setattr(public_module, "EmailService", lambda: mock_email_service)

        mock_db = MagicMock()
        mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value \
            .maybe_single.return_value.execute.return_value.data = {
                "id": str(AM_ID), "full_name": "Test AM", "email": "am@test.com",
            }
        monkeypatch.setattr(public_module, "get_service_db", lambda: mock_db)
        monkeypatch.setattr(
            public_module, "_resolve_tenant",
            lambda slug: {"id": str(TENANT), "name": "Test", "is_active": True},
        )

        result = public_module.send_am_verification_code(AM_ID, tenant_slug="test")

        assert "demo_code" not in result
        mock_email_service.send_am_verification_code.assert_called_once()
