"""
Tests for the candidate document submission flow (Milestone 7's public,
no-login link sent after the Appointment Letter is released).

Includes a regression test for a real bug found during development:
`document_type` was declared with FastAPI's `Path(...)` even though it's
not part of the URL template (`/documents/{token}/upload`) — it's a
form field submitted alongside the file. This would have broken the
endpoint the moment a real multipart request hit it; caught by actually
making one, not by reading the code or checking that the app imports.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _token_row(token: str, expired: bool = False) -> dict:
    delta = timedelta(days=-1) if expired else timedelta(days=10)
    return {
        "id": str(uuid4()), "tenant_id": str(uuid4()), "candidate_id": str(uuid4()),
        "token": token, "expires_at": (datetime.now(timezone.utc) + delta).isoformat(),
        "used_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
    }


def test_document_upload_reads_document_type_from_form_data_not_path() -> None:
    """
    Regression test: document_type must be readable as a multipart form
    field. If it were still declared with Path(...), this request would
    fail — either at app startup (FastAPI validates that Path() params
    exist in the route template) or with a 422 at request time.
    """
    token = "valid-test-token"
    row = _token_row(token)

    with patch("app.api.v1.endpoints.public.get_service_db") as mock_get_db:
        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        mock_db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value \
            .execute.return_value.data = row
        mock_db.table.return_value.insert.return_value.execute.return_value.data = [{}]

        response = client.post(
            f"/api/v1/public/documents/{token}/upload",
            data={"document_type": "aadhaar"},
            files={"file": ("aadhaar.pdf", b"fake content", "application/pdf")},
        )

        assert response.status_code == 200
        assert response.json()["document_type"] == "aadhaar"
        assert response.json()["filename"] == "aadhaar.pdf"


def test_document_upload_rejects_expired_token() -> None:
    token = "expired-token"
    row = _token_row(token, expired=True)

    with patch("app.api.v1.endpoints.public.get_service_db") as mock_get_db:
        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        mock_db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value \
            .execute.return_value.data = row

        response = client.post(
            f"/api/v1/public/documents/{token}/upload",
            data={"document_type": "resume"},
            files={"file": ("resume.pdf", b"content", "application/pdf")},
        )
        assert response.status_code == 404


def test_document_upload_rejects_nonexistent_token() -> None:
    with patch("app.api.v1.endpoints.public.get_service_db") as mock_get_db:
        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        mock_db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value \
            .execute.return_value.data = None

        response = client.post(
            "/api/v1/public/documents/does-not-exist/upload",
            data={"document_type": "resume"},
            files={"file": ("resume.pdf", b"content", "application/pdf")},
        )
        assert response.status_code == 404


def test_document_request_info_returns_candidate_name_for_greeting() -> None:
    token = "info-test-token"
    row = _token_row(token)

    with patch("app.api.v1.endpoints.public.get_service_db") as mock_get_db:
        mock_db = MagicMock()
        mock_get_db.return_value = mock_db

        candidate_row = {"full_name": "Priya Sharma", "client_name": "IBM"}
        tenant_row = {"name": "iBridge Techsoft"}

        def select_side_effect(*args, **kwargs):
            mock_query = MagicMock()
            return mock_query

        mock_db.table.side_effect = lambda name: {
            "document_request_tokens": MagicMock(
                select=lambda *a: MagicMock(eq=lambda *a: MagicMock(
                    maybe_single=lambda: MagicMock(execute=lambda: MagicMock(data=row))
                ))
            ),
            "candidates": MagicMock(
                select=lambda *a: MagicMock(eq=lambda *a: MagicMock(
                    maybe_single=lambda: MagicMock(execute=lambda: MagicMock(data=candidate_row))
                ))
            ),
            "tenants": MagicMock(
                select=lambda *a: MagicMock(eq=lambda *a: MagicMock(
                    maybe_single=lambda: MagicMock(execute=lambda: MagicMock(data=tenant_row))
                ))
            ),
            "candidate_documents": MagicMock(
                select=lambda *a: MagicMock(eq=lambda *a: MagicMock(
                    execute=lambda: MagicMock(data=[])
                ))
            ),
        }[name]

        response = client.get(f"/api/v1/public/documents/{token}")
        assert response.status_code == 200
        body = response.json()
        assert body["candidate_name"] == "Priya Sharma"
        assert body["company_name"] == "iBridge Techsoft"


def test_document_upload_sets_financial_year_for_archival() -> None:
    """
    Regression test: financial_year was never being set at upload time,
    which would have silently broken the yearly archive job forever —
    its query filters on financial_year, so every document would simply
    never match and never get archived, with no error anywhere to
    surface the problem.
    """
    token = "fy-test-token"
    row = _token_row(token)

    with patch("app.api.v1.endpoints.public.get_service_db") as mock_get_db:
        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        mock_db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value \
            .execute.return_value.data = row
        mock_db.table.return_value.insert.return_value.execute.return_value.data = [{}]

        response = client.post(
            f"/api/v1/public/documents/{token}/upload",
            data={"document_type": "pan"},
            files={"file": ("pan.pdf", b"content", "application/pdf")},
        )
        assert response.status_code == 200

        insert_calls = mock_db.table.return_value.insert.call_args_list
        inserted_doc = next(c.args[0] for c in insert_calls if "document_type" in c.args[0])
        assert "financial_year" in inserted_doc
        assert inserted_doc["financial_year"] is not None
        # Format check: "YYYY-YY", e.g. "2026-27" — not asserting the
        # exact value here since that depends on today's date, but the
        # shape must be right.
        assert len(inserted_doc["financial_year"]) == 7
        assert inserted_doc["financial_year"][4] == "-"
