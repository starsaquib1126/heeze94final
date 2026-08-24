"""
Tests for direct HR actions on candidates: update_candidate,
delete_candidate, create_candidate_direct, reject_offer.

The state-machine constraints matter most here — each action is only
valid from specific stages, mirroring the same pattern established for
every other action in this project (release_offer, confirm_joining,
etc.): explicit rejection rather than silently doing something
unintended.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.candidate_service import CandidateService

TENANT_A = uuid4()
LOCATION_A1 = uuid4()
PERFORMER = uuid4()


def _candidate_row(candidate_id, stage="requested", **overrides) -> dict:
    row = {
        "id": str(candidate_id), "tenant_id": str(TENANT_A), "location_id": str(LOCATION_A1),
        "request_date": "2026-01-01T00:00:00", "account_manager_id": str(uuid4()), "recruiter_id": None,
        "client_name": "Deloitte USI", "full_name": "Test Candidate", "email": "test@example.com",
        "phone": None, "designation": "Engineer", "department": None, "work_location": None,
        "proposed_ctc": 1200000.0, "expected_doj": "2026-06-01", "stage": stage,
        "offer_released_at": None, "offer_letter_path": None, "is_revised": False,
        "confirmed_doj": None, "employee_id": None, "employee_id_auto": None,
        "appointment_released_at": None, "appointment_letter_path": None, "documents_submitted_at": None,
        "resignation_date": None, "last_working_day": None, "clearance_received": False,
        "clearance_date": None, "relieving_released_at": None, "relieving_letter_path": None,
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
# update_candidate
# ---------------------------------------------------------------------- #
def test_update_candidate_succeeds_from_requested() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="requested"))
    updated_row = dict(_candidate_row(candidate_id, stage="requested", full_name="Corrected Name"))
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [updated_row]

    result = svc.update_candidate(
        candidate_id, TENANT_A, "hr", LOCATION_A1, updates={"full_name": "Corrected Name"}
    )
    assert result.full_name == "Corrected Name"


@pytest.mark.parametrize("stage", ["offered", "revised", "joined", "active", "rejected", "exited"])
def test_update_candidate_rejects_wrong_stage(stage: str) -> None:
    candidate_id = uuid4()
    svc, _ = _service_with_candidate(_candidate_row(candidate_id, stage=stage))
    with pytest.raises(ValueError, match="Cannot edit"):
        svc.update_candidate(candidate_id, TENANT_A, "hr", LOCATION_A1, updates={"full_name": "X"})


def test_update_candidate_with_no_updates_is_a_noop() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="requested"))
    result = svc.update_candidate(candidate_id, TENANT_A, "hr", LOCATION_A1, updates={})
    assert result.id == candidate_id
    mock_db.table.return_value.update.assert_not_called()


# ---------------------------------------------------------------------- #
# delete_candidate
# ---------------------------------------------------------------------- #
def test_delete_candidate_succeeds_from_requested() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="requested"))
    svc.delete_candidate(candidate_id, TENANT_A, "hr", LOCATION_A1)
    mock_db.table.return_value.delete.assert_called_once()


@pytest.mark.parametrize("stage", ["offered", "revised", "joined", "active", "exited"])
def test_delete_candidate_rejects_wrong_stage(stage: str) -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage=stage))
    with pytest.raises(ValueError, match="Cannot delete"):
        svc.delete_candidate(candidate_id, TENANT_A, "hr", LOCATION_A1)
    mock_db.table.return_value.delete.assert_not_called()


# ---------------------------------------------------------------------- #
# create_candidate_direct
# ---------------------------------------------------------------------- #
def test_create_candidate_direct_works_without_an_account_manager() -> None:
    """The whole point of this action: an AM isn't required, unlike the
    public form's OfferRequestCreate."""
    from app.models.user import HRCandidateCreate

    svc = CandidateService.__new__(CandidateService)
    mock_db = MagicMock()
    svc._db = mock_db

    candidate_id = uuid4()
    inserted_row = _candidate_row(candidate_id, account_manager_id=None)
    mock_db.table.return_value.insert.return_value.execute.return_value.data = [inserted_row]

    data = HRCandidateCreate(client_name="Internal Hire", full_name="Jane Doe", email="jane@example.com")
    result = svc.create_candidate_direct(data, TENANT_A, LOCATION_A1, created_by=PERFORMER)

    assert result.account_manager_id is None
    insert_call_args = mock_db.table.return_value.insert.call_args_list[0].args[0]
    assert insert_call_args["account_manager_id"] is None
    assert insert_call_args["hr_owner_id"] == str(PERFORMER)


def test_create_candidate_direct_logs_request_raised_event() -> None:
    from app.models.user import HRCandidateCreate

    svc = CandidateService.__new__(CandidateService)
    mock_db = MagicMock()
    svc._db = mock_db
    mock_db.table.return_value.insert.return_value.execute.return_value.data = [_candidate_row(uuid4())]

    data = HRCandidateCreate(client_name="Internal Hire", full_name="Jane Doe", email="jane@example.com")
    svc.create_candidate_direct(data, TENANT_A, LOCATION_A1, created_by=PERFORMER)

    insert_calls = mock_db.table.return_value.insert.call_args_list
    event_insert = next(c.args[0] for c in insert_calls if c.args[0].get("event_type") == "request_raised")
    assert event_insert["details"]["source"] == "hr_direct"


# ---------------------------------------------------------------------- #
# reject_offer
# ---------------------------------------------------------------------- #
@pytest.mark.parametrize("stage", ["offered", "revised"])
def test_reject_offer_succeeds_from_offered_or_revised(stage: str) -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage=stage))
    updated_row = dict(_candidate_row(candidate_id, stage="rejected"))
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [updated_row]

    result = svc.reject_offer(candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER, reason="Candidate declined")
    assert result.stage == "rejected"


@pytest.mark.parametrize("stage", ["requested", "joined", "id_assigned", "active", "exited"])
def test_reject_offer_rejects_wrong_stage(stage: str) -> None:
    candidate_id = uuid4()
    svc, _ = _service_with_candidate(_candidate_row(candidate_id, stage=stage))
    with pytest.raises(ValueError, match="Cannot reject"):
        svc.reject_offer(candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER)


def test_reject_offer_logs_event_with_reason() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="offered"))

    svc.reject_offer(candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER, reason="Took another offer")

    insert_calls = mock_db.table.return_value.insert.call_args_list
    event_insert = next(c.args[0] for c in insert_calls if c.args[0].get("event_type") == "rejected")
    assert event_insert["details"]["reason"] == "Took another offer"
