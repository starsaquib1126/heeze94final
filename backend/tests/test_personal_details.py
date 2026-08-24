"""
Tests for the candidate personal/bank/statutory details submission —
replaces the real manual "fill in this Excel and email it back" process
(the actual email and PF filing spreadsheet this replaces were used to
design the exact field set here).

Covers: upsert behavior (resubmitting updates rather than duplicating),
the submitted_at / mark_submitted distinction (partial save vs. final
submission), and that date fields serialize correctly — the same class
of bug (UUID serialization) that caused a real production crash earlier
in this project, checked here for dates specifically since this is the
first place multiple date fields go through model_dump(mode="json")
together in one payload.
"""

from __future__ import annotations

import json
from datetime import date
from unittest.mock import MagicMock
from uuid import uuid4

from app.api.v1.endpoints.public import get_personal_details, submit_personal_details
from app.models.user import PersonalDetailsSubmit

TENANT = str(uuid4())
CANDIDATE = str(uuid4())


def _token_row() -> dict:
    return {
        "id": str(uuid4()), "tenant_id": TENANT, "candidate_id": CANDIDATE,
        "token": "faketoken", "expires_at": "2099-01-01T00:00:00+00:00", "used_at": None,
    }


def test_all_submitted_fields_are_genuinely_json_serializable() -> None:
    """The exact class of bug that caused a real production crash before
    (UUID serialization) — checked here for the multiple date fields
    this model has, which is new territory for this codebase."""
    data = PersonalDetailsSubmit(
        name_as_per_pan="Manasa Kodi", date_of_birth=date(1995, 3, 12),
        spouse_dob=date(1996, 7, 4), child_1_dob=date(2020, 1, 1),
        passport_valid_from=date(2020, 1, 1), passport_valid_to=date(2030, 1, 1),
    )
    payload = data.model_dump(mode="json", exclude_unset=True)
    json.dumps(payload)  # raises if anything isn't serializable
    assert payload["date_of_birth"] == "1995-03-12"


def test_get_returns_empty_object_when_nothing_saved_yet(monkeypatch) -> None:
    """A fresh form is a normal, expected state — not an error."""
    import app.api.v1.endpoints.public as public_module

    monkeypatch.setattr(public_module, "_resolve_document_token", lambda token: _token_row())
    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value \
        .execute.return_value = None  # zero rows matched
    monkeypatch.setattr(public_module, "get_service_db", lambda: mock_db)

    result = get_personal_details("faketoken")
    assert result == {}


def test_get_returns_saved_data_when_present(monkeypatch) -> None:
    import app.api.v1.endpoints.public as public_module

    monkeypatch.setattr(public_module, "_resolve_document_token", lambda token: _token_row())
    mock_db = MagicMock()
    saved_row = {"name_as_per_pan": "Manasa Kodi", "bank_name": "SBI"}
    mock_db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value \
        .execute.return_value.data = saved_row
    monkeypatch.setattr(public_module, "get_service_db", lambda: mock_db)

    result = get_personal_details("faketoken")
    assert result == saved_row


def test_first_submission_inserts_not_updates(monkeypatch) -> None:
    """No existing row yet -> insert, not update."""
    import app.api.v1.endpoints.public as public_module

    monkeypatch.setattr(public_module, "_resolve_document_token", lambda token: _token_row())
    mock_db = MagicMock()
    # No existing row
    mock_db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value \
        .execute.return_value = None
    monkeypatch.setattr(public_module, "get_service_db", lambda: mock_db)

    submit_personal_details("faketoken", PersonalDetailsSubmit(name_as_per_pan="Manasa Kodi"), mark_submitted=False)

    mock_db.table.return_value.insert.assert_called_once()
    mock_db.table.return_value.update.assert_not_called()


def test_resubmission_updates_not_duplicates(monkeypatch) -> None:
    """An existing row (candidate_id is UNIQUE) -> update, not a second insert."""
    import app.api.v1.endpoints.public as public_module

    monkeypatch.setattr(public_module, "_resolve_document_token", lambda token: _token_row())
    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value \
        .execute.return_value.data = {"id": str(uuid4())}
    monkeypatch.setattr(public_module, "get_service_db", lambda: mock_db)

    submit_personal_details("faketoken", PersonalDetailsSubmit(name_as_per_pan="Manasa Kodi"), mark_submitted=False)

    mock_db.table.return_value.update.assert_called_once()
    mock_db.table.return_value.insert.assert_not_called()


def test_partial_save_does_not_set_submitted_at(monkeypatch) -> None:
    """Autosave (mark_submitted=False) must not mark the record as
    genuinely complete — that's reserved for the explicit final Submit."""
    import app.api.v1.endpoints.public as public_module

    monkeypatch.setattr(public_module, "_resolve_document_token", lambda token: _token_row())
    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value \
        .execute.return_value = None
    monkeypatch.setattr(public_module, "get_service_db", lambda: mock_db)

    submit_personal_details("faketoken", PersonalDetailsSubmit(name_as_per_pan="Test"), mark_submitted=False)

    insert_payload = mock_db.table.return_value.insert.call_args.args[0]
    assert "submitted_at" not in insert_payload


def test_final_submit_sets_submitted_at_and_logs_event(monkeypatch) -> None:
    import app.api.v1.endpoints.public as public_module

    monkeypatch.setattr(public_module, "_resolve_document_token", lambda token: _token_row())
    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value \
        .execute.return_value = None
    monkeypatch.setattr(public_module, "get_service_db", lambda: mock_db)

    submit_personal_details("faketoken", PersonalDetailsSubmit(name_as_per_pan="Test"), mark_submitted=True)

    insert_payload = mock_db.table.return_value.insert.call_args_list[0].args[0]
    assert "submitted_at" in insert_payload and insert_payload["submitted_at"]

    event_calls = mock_db.table.return_value.insert.call_args_list
    event_payload = next(c.args[0] for c in event_calls if c.args[0].get("event_type") == "documents_submitted")
    assert event_payload["details"]["personal_details_submitted"] is True
