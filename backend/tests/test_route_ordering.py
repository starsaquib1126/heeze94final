"""
Guards against a real routing bug found in Milestone 6: `/candidates/export`
was registered AFTER `/candidates/{candidate_id}` in the source file.
FastAPI/Starlette resolve routes in registration order, so a request to
`/candidates/export` was being captured by the earlier, more general
`{candidate_id}` route, which then failed UUID validation on the literal
string "export" with a 422 — the export endpoint's own logic never ran
at all.

Caught only by making a real authenticated request and checking which
service method actually got called — an unauthenticated request returns
401 for BOTH the correct and the broken routing (since this FastAPI
version runs the auth dependency before path parameter validation),
which made the bug invisible to a shallower test.
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock, patch
from uuid import uuid4

import jwt as pyjwt
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# Verification now goes through Supabase's JWKS endpoint, not a single
# shared secret (see auth.py) — tests sign with this fixed value and
# mock the JWKS client to "serve back" the same one, rather than
# attempting a real network call to a fake Supabase URL.
_TEST_SECRET = "test_signing_key_at_least_32_characters_long_for_hs256"


def _auth_token() -> tuple[str, dict]:
    now = int(time.time())
    user_id = str(uuid4())
    token = pyjwt.encode(
        {"sub": user_id, "aud": "authenticated", "email": "hr@test.com", "iat": now, "exp": now + 3600},
        _TEST_SECRET, algorithm="HS256",
    )
    profile_row = {
        "id": user_id, "tenant_id": str(uuid4()), "location_id": str(uuid4()),
        "full_name": "Test HR", "role": "hr", "is_active": True,
        "created_at": "2026-01-01T00:00:00", "updated_at": "2026-01-01T00:00:00",
    }
    return token, profile_row


def _mock_jwks(patch_target):
    fake_signing_key = MagicMock()
    fake_signing_key.key = _TEST_SECRET
    fake_jwks_client = MagicMock()
    fake_jwks_client.get_signing_key_from_jwt.return_value = fake_signing_key
    return patch_target("app.core.auth._get_jwks_client", lambda: fake_jwks_client)


def test_candidates_export_route_does_not_get_captured_by_candidate_id_route() -> None:
    token, profile_row = _auth_token()

    with patch("app.core.auth.get_service_db") as mock_auth_db, _mock_jwks(patch):
        mock_auth_db.return_value.table.return_value.select.return_value.eq.return_value.eq.return_value \
            .single.return_value.execute.return_value.data = profile_row

        with patch("app.api.v1.endpoints.candidates.CandidateService") as MockCandidateService, \
             patch("app.services.excel_export_service.ExcelExportService.build_export") as mock_build_export:

            MockCandidateService.return_value.list_candidates.return_value = []
            mock_build_export.return_value = b"fake-xlsx-bytes"

            response = client.get("/api/v1/candidates/export", headers={"Authorization": f"Bearer {token}"})

            assert response.status_code == 200, (
                f"Expected the export endpoint to handle this request, got {response.status_code}. "
                f"If this is 422, /candidates/export is being captured by /candidates/{{candidate_id}} again."
            )
            assert response.headers["content-type"] == (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )
            # The definitive check: the LIST method must have been called
            # (export's own logic), and the single-candidate GET method must
            # NOT have been called (which is what happens if "export" gets
            # treated as a candidate_id path parameter instead).
            assert MockCandidateService.return_value.list_candidates.called
            assert not MockCandidateService.return_value.get_candidate.called


def test_candidates_candidate_id_route_still_works_for_real_uuids() -> None:
    """The fix (reordering routes) must not have broken the normal case —
    a real UUID must still correctly reach the single-candidate endpoint."""
    token, profile_row = _auth_token()
    real_candidate_id = str(uuid4())

    with patch("app.core.auth.get_service_db") as mock_auth_db, _mock_jwks(patch):
        mock_auth_db.return_value.table.return_value.select.return_value.eq.return_value.eq.return_value \
            .single.return_value.execute.return_value.data = profile_row

        with patch("app.api.v1.endpoints.candidates.CandidateService") as MockCandidateService:
            MockCandidateService.return_value.get_candidate.return_value = None

            response = client.get(
                f"/api/v1/candidates/{real_candidate_id}", headers={"Authorization": f"Bearer {token}"}
            )

            assert response.status_code == 404  # candidate not found, but the RIGHT endpoint ran
            assert MockCandidateService.return_value.get_candidate.called
