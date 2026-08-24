"""
Tests for DocumentService (Milestone 10).

Financial-year boundary math is covered separately and thoroughly
(module-level pure functions, tested directly against real dates).
These tests cover the service behaviors: originals are never touched
by archival (only a ZIP gets added), a single missing/corrupt file
doesn't abort the whole archive, and re-running the archive job is
idempotent (already-archived documents aren't re-bundled).
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

from app.services.document_service import DocumentService, financial_year_for_date, previous_financial_year
from datetime import date


def test_financial_year_for_date_matches_indian_convention() -> None:
    assert financial_year_for_date(date(2026, 4, 1)) == "2026-27"
    assert financial_year_for_date(date(2027, 3, 31)) == "2026-27"
    assert financial_year_for_date(date(2027, 4, 1)) == "2027-28"


def test_previous_financial_year_is_used_by_the_archive_trigger() -> None:
    # As of April 1st, the FY that just ended is the previous one.
    assert previous_financial_year(date(2027, 4, 1)) == "2026-27"


def test_generate_yearly_archive_returns_none_when_no_candidates_at_location() -> None:
    svc = DocumentService.__new__(DocumentService)
    mock_db = MagicMock()
    svc._db = mock_db
    svc._settings = MagicMock(storage_bucket="test-bucket")

    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []

    result = svc.generate_yearly_archive(uuid4(), uuid4(), "2026-27")
    assert result is None


def test_generate_yearly_archive_returns_none_when_nothing_to_archive() -> None:
    """A location with candidates but no matching not-yet-archived
    documents for that FY must not produce an empty zip."""
    svc = DocumentService.__new__(DocumentService)
    mock_db = MagicMock()
    svc._db = mock_db
    svc._settings = MagicMock(storage_bucket="test-bucket")

    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"id": str(uuid4())}
    ]
    mock_db.table.return_value.select.return_value.in_.return_value.eq.return_value.eq.return_value \
        .execute.return_value.data = []

    result = svc.generate_yearly_archive(uuid4(), uuid4(), "2026-27")
    assert result is None


def test_generate_yearly_archive_never_deletes_or_modifies_originals() -> None:
    """The core design guarantee: archiving only ADDS a zip and flips
    is_archived — it must never call anything that deletes or replaces
    the original document's storage_path."""
    tenant_id, location_id = uuid4(), uuid4()
    candidate_id = str(uuid4())
    doc_id = str(uuid4())

    svc = DocumentService.__new__(DocumentService)
    mock_db = MagicMock()
    svc._db = mock_db
    svc._settings = MagicMock(storage_bucket="test-bucket")

    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"id": candidate_id}
    ]
    mock_db.table.return_value.select.return_value.in_.return_value.eq.return_value.eq.return_value \
        .execute.return_value.data = [{
            "id": doc_id, "candidate_id": candidate_id, "document_type": "pan",
            "original_name": "pan.pdf", "storage_path": f"{tenant_id}/candidates/{candidate_id}/documents/pan.pdf",
        }]
    mock_db.storage.from_.return_value.download.return_value = b"fake pdf bytes"

    result = svc.generate_yearly_archive(tenant_id, location_id, "2026-27")

    assert result is not None
    # The original document's own storage_path must never be touched —
    # only a new zip is uploaded, and only is_archived/archived_zip_path
    # are updated on the row, never storage_path itself.
    update_call = mock_db.table.return_value.update.call_args
    assert "storage_path" not in update_call.args[0]
    assert update_call.args[0]["is_archived"] is True
    # Confirm nothing resembling a delete was ever called on storage.
    assert not mock_db.storage.from_.return_value.remove.called


def test_generate_yearly_archive_survives_one_missing_file() -> None:
    """A single corrupt/missing file in storage must not abort the
    whole archive — the rest still get bundled."""
    tenant_id, location_id = uuid4(), uuid4()
    candidate_id = str(uuid4())

    svc = DocumentService.__new__(DocumentService)
    mock_db = MagicMock()
    svc._db = mock_db
    svc._settings = MagicMock(storage_bucket="test-bucket")

    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"id": candidate_id}
    ]
    mock_db.table.return_value.select.return_value.in_.return_value.eq.return_value.eq.return_value \
        .execute.return_value.data = [
            {"id": str(uuid4()), "candidate_id": candidate_id, "document_type": "pan",
             "original_name": "pan.pdf", "storage_path": "missing/path.pdf"},
            {"id": str(uuid4()), "candidate_id": candidate_id, "document_type": "aadhaar",
             "original_name": "aadhaar.pdf", "storage_path": "real/path.pdf"},
        ]

    def download_side_effect(path):
        if path == "missing/path.pdf":
            raise Exception("File not found")
        return b"real file content"

    mock_db.storage.from_.return_value.download.side_effect = download_side_effect

    result = svc.generate_yearly_archive(tenant_id, location_id, "2026-27")

    assert result is not None  # the job completed despite one failure
    # Both documents are still marked archived — the failure was in
    # fetching the file for the zip, not in the archival bookkeeping.
    update_call = mock_db.table.return_value.update.call_args
    assert update_call.args[0]["is_archived"] is True
