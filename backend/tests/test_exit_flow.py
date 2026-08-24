"""
Tests for the exit flow (Milestone 8): log_resignation,
mark_clearance_received, release_relieving, and the pending-reminders
query the scheduled job uses.

The property that matters most here: release_relieving must be gated
on clearance_received, and that check must live in the service layer
itself — not only enforced by the UI hiding the button — so no future
caller (a different endpoint, a script, a bug) can bypass it.
"""

from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.candidate_service import CandidateService

TENANT_A = uuid4()
LOCATION_A1 = uuid4()
PERFORMER = uuid4()


def _candidate_row(candidate_id, stage="active", clearance_received=False, **overrides) -> dict:
    row = {
        "id": str(candidate_id), "tenant_id": str(TENANT_A), "location_id": str(LOCATION_A1),
        "request_date": "2026-01-01T00:00:00", "account_manager_id": str(uuid4()), "recruiter_id": None,
        "client_name": "Deloitte USI", "full_name": "Test Employee", "email": "employee@example.com",
        "phone": None, "designation": "Engineer", "department": None, "work_location": None,
        "proposed_ctc": 1200000.0, "expected_doj": "2026-01-01", "stage": stage,
        "offer_released_at": "2026-01-01T00:00:00", "offer_letter_path": "offer.docx",
        "is_revised": False, "confirmed_doj": "2026-01-15",
        "employee_id": "IB-NOI-1042", "employee_id_auto": True,
        "appointment_released_at": "2026-01-15T00:00:00", "appointment_letter_path": "appointment.docx",
        "documents_submitted_at": "2026-01-16T00:00:00",
        "resignation_date": None, "last_working_day": None,
        "clearance_received": clearance_received, "clearance_date": None,
        "relieving_released_at": None, "relieving_letter_path": None,
        "hr_owner_id": None, "notes": None,
        "created_at": "2026-01-01T00:00:00", "updated_at": "2026-01-01T00:00:00",
    }
    row.update(overrides)
    return row


def _service_with_candidate(row: dict) -> tuple[CandidateService, MagicMock]:
    svc = CandidateService.__new__(CandidateService)
    mock_db = MagicMock()
    svc._db = mock_db

    select_chain = mock_db.table.return_value.select.return_value
    select_chain.eq.return_value.eq.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value.data = row

    updated_row = dict(row)
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [updated_row]

    return svc, mock_db


# ---------------------------------------------------------------------- #
# log_resignation
# ---------------------------------------------------------------------- #
def test_log_resignation_succeeds_from_active() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="active"))
    updated_row = dict(_candidate_row(candidate_id, stage="resigned"))
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [updated_row]

    result = svc.log_resignation(
        candidate_id, "2026-08-01", "2026-08-31", TENANT_A, "hr", LOCATION_A1, PERFORMER
    )
    assert result.stage == "resigned"


@pytest.mark.parametrize("stage", ["requested", "offered", "joined", "id_assigned", "resigned", "exited"])
def test_log_resignation_rejects_wrong_stage(stage: str) -> None:
    candidate_id = uuid4()
    svc, _ = _service_with_candidate(_candidate_row(candidate_id, stage=stage))
    with pytest.raises(ValueError, match="Cannot log a resignation"):
        svc.log_resignation(candidate_id, "2026-08-01", "2026-08-31", TENANT_A, "hr", LOCATION_A1, PERFORMER)


def test_log_resignation_logs_both_resignation_and_lwd_events() -> None:
    """Two distinct events, not one — resignation_logged and lwd_set are
    separately meaningful in the tracker's event history."""
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="active"))

    svc.log_resignation(candidate_id, "2026-08-01", "2026-08-31", TENANT_A, "hr", LOCATION_A1, PERFORMER)

    insert_calls = mock_db.table.return_value.insert.call_args_list
    event_types = [c.args[0]["event_type"] for c in insert_calls if "event_type" in c.args[0]]
    assert "resignation_logged" in event_types
    assert "lwd_set" in event_types


# ---------------------------------------------------------------------- #
# mark_clearance_received
# ---------------------------------------------------------------------- #
def test_mark_clearance_received_succeeds_from_resigned() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="resigned"))
    updated_row = dict(_candidate_row(candidate_id, stage="resigned", clearance_received=True))
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [updated_row]

    result = svc.mark_clearance_received(candidate_id, "2026-09-05", TENANT_A, "hr", LOCATION_A1, PERFORMER)
    assert result.clearance_received is True


@pytest.mark.parametrize("stage", ["active", "exited", "requested"])
def test_mark_clearance_received_rejects_wrong_stage(stage: str) -> None:
    candidate_id = uuid4()
    svc, _ = _service_with_candidate(_candidate_row(candidate_id, stage=stage))
    with pytest.raises(ValueError, match="Cannot mark clearance"):
        svc.mark_clearance_received(candidate_id, "2026-09-05", TENANT_A, "hr", LOCATION_A1, PERFORMER)


# ---------------------------------------------------------------------- #
# release_relieving — the clearance gate is the property that matters most
# ---------------------------------------------------------------------- #
def test_release_relieving_blocked_without_clearance() -> None:
    """The critical business rule: no relieving letter without clearance,
    enforced in the service layer itself — not just hidden in the UI."""
    candidate_id = uuid4()
    svc, _ = _service_with_candidate(
        _candidate_row(candidate_id, stage="resigned", clearance_received=False)
    )
    with pytest.raises(ValueError, match="clearance has not been received"):
        svc.release_relieving(
            candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER,
            relieving_letter_path="relieving.docx",
        )


def test_release_relieving_succeeds_with_clearance() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(
        _candidate_row(candidate_id, stage="resigned", clearance_received=True)
    )
    updated_row = dict(_candidate_row(candidate_id, stage="exited", clearance_received=True))
    updated_row["relieving_letter_path"] = "relieving.docx"
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [updated_row]

    result = svc.release_relieving(
        candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER,
        relieving_letter_path="relieving.docx",
    )
    assert result.stage == "exited"
    assert result.relieving_letter_path == "relieving.docx"


def test_release_relieving_rejects_wrong_stage_even_with_clearance() -> None:
    """Clearance alone isn't sufficient — the candidate must actually be
    in 'resigned' stage. (clearance_received=True on a non-resigned
    candidate shouldn't happen via normal use, but the check order
    matters: stage is checked before clearance either way.)"""
    candidate_id = uuid4()
    svc, _ = _service_with_candidate(
        _candidate_row(candidate_id, stage="active", clearance_received=True)
    )
    with pytest.raises(ValueError, match="Cannot release the relieving letter"):
        svc.release_relieving(
            candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER,
            relieving_letter_path="relieving.docx",
        )


# ---------------------------------------------------------------------- #
# get_pending_relieving_reminders
# ---------------------------------------------------------------------- #
def test_pending_reminders_queries_resigned_stage_and_cutoff_date() -> None:
    svc = CandidateService.__new__(CandidateService)
    mock_db = MagicMock()
    svc._db = mock_db
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.lte.return_value.execute.return_value.data = []

    svc.get_pending_relieving_reminders(TENANT_A, reminder_days=20)

    select_chain = mock_db.table.return_value.select.return_value
    first_eq_calls = [c.args for c in select_chain.eq.call_args_list]
    second_eq_calls = [c.args for c in select_chain.eq.return_value.eq.call_args_list]
    assert ("tenant_id", str(TENANT_A)) in first_eq_calls
    assert ("stage", "resigned") in second_eq_calls

    lte_call = select_chain.eq.return_value.eq.return_value.lte.call_args
    assert lte_call.args[0] == "last_working_day"
    expected_cutoff = (date.today() - timedelta(days=20)).isoformat()
    assert lte_call.args[1] == expected_cutoff
