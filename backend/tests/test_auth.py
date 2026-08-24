"""
Tests for JWT-based authentication.

Covers the auth dependency chain that every HR/Super User route relies
on: token signature validation, expiry, and role enforcement. These
don't hit a real Supabase instance — they test the pure token-validation
logic, which is what actually protects every non-public route.

Verification goes through Supabase's JWKS endpoint (not a single shared
secret) — see auth.py's module docstring for why. Tests mock
`_get_jwks_client()` to return a fake signing key matching what the test
tokens are actually signed with, rather than attempting a real network
call to a fake Supabase URL.
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# A fixed, known secret the mocked JWKS client "serves back" for test
# tokens signed with it — the actual value doesn't matter, only that
# tokens are consistently signed and verified against the same one.
_TEST_SECRET = "test_signing_key_at_least_32_characters_long_for_hs256"


def _make_token(sub: str = "11111111-1111-1111-1111-111111111111", expired: bool = False) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "aud": "authenticated",
        "email": "test@example.com",
        "iat": now,
        "exp": now - 3600 if expired else now + 3600,
    }
    return jwt.encode(payload, _TEST_SECRET, algorithm="HS256")


@pytest.fixture
def mock_jwks_client(monkeypatch: pytest.MonkeyPatch):
    """
    Every test in this file gets a mocked JWKS client whose signing key
    matches `_TEST_SECRET` — this exercises the real `_decode_jwt()` →
    `_get_jwks_client()` → `jwt.decode()` code path exactly as
    production does, just without a real network call to Supabase.
    """
    import app.core.auth as auth_module

    fake_signing_key = MagicMock()
    fake_signing_key.key = _TEST_SECRET

    fake_jwks_client = MagicMock()
    fake_jwks_client.get_signing_key_from_jwt.return_value = fake_signing_key

    monkeypatch.setattr(auth_module, "_get_jwks_client", lambda: fake_jwks_client)
    yield fake_jwks_client


def test_me_requires_a_token_at_all() -> None:
    response = client.get("/api/v1/me")
    assert response.status_code in (401, 403)  # HTTPBearer raises 403 by default when missing


def test_me_rejects_malformed_bearer_token() -> None:
    response = client.get("/api/v1/me", headers={"Authorization": "Bearer not-a-real-jwt"})
    assert response.status_code == 401


def test_me_rejects_expired_token(mock_jwks_client) -> None:
    token = _make_token(expired=True)
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert "expired" in response.json()["detail"].lower()


def test_me_rejects_token_signed_with_wrong_secret(mock_jwks_client) -> None:
    """A token signed with any secret other than the one the (mocked)
    JWKS client actually serves must never be accepted — this is what
    actually stops someone from forging a session."""
    now = int(time.time())
    forged = jwt.encode(
        {"sub": "attacker", "aud": "authenticated", "iat": now, "exp": now + 3600},
        "wrong-secret-entirely",
        algorithm="HS256",
    )
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {forged}"})
    assert response.status_code == 401


def test_me_rejects_valid_token_with_no_matching_profile(monkeypatch: pytest.MonkeyPatch, mock_jwks_client) -> None:
    """
    A structurally valid, correctly-signed token for a user_id that has
    no row in user_profiles must still be rejected — being a real
    Supabase auth.users entry isn't enough; you also need to be a
    provisioned HR/Super User in this app's own tables.
    """
    import app.core.auth as auth_module

    empty_result = MagicMock()
    empty_result.data = []

    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value = empty_result

    monkeypatch.setattr(auth_module, "get_service_db", lambda: mock_db)

    token = _make_token()
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert "not found" in response.json()["detail"].lower() or "inactive" in response.json()["detail"].lower()


def test_jwks_client_is_reused_across_calls_not_rebuilt_every_time() -> None:
    """
    Sanity check on the caching design: _get_jwks_client() should return
    the same PyJWKClient instance on repeated calls within the process,
    not construct a fresh one (and therefore refetch the JWKS) on every
    single request — that would be needlessly slow and hit Supabase's
    JWKS endpoint far more than necessary.
    """
    import app.core.auth as auth_module

    # Reset the module-level singleton for a clean test
    auth_module._jwks_client = None
    first = auth_module._get_jwks_client()
    second = auth_module._get_jwks_client()
    assert first is second
    auth_module._jwks_client = None  # leave clean for other tests
