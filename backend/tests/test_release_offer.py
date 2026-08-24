"""
Tests for CandidateService.release_offer (Milestone 3).

Covers the state-machine rule that matters most here: only a candidate
still in 'requested' stage can have their first offer released — this
is what keeps "release offer" and "revise offer" (Milestone 7) as
distinct, unambiguous actions instead of one endpoint silently doing
different things depending on current state.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.models.user import Candidate
from app.services.candidate_service import CandidateService

TENANT_A = uuid4()
LOCATION_A1 = uuid4()
HR_USER = uuid4()


def _make_candidate_row(candidate_id, stage="requested", **overrides) -> dict:
    row = {
        "id": str(candidate_id),
        "tenant_id": str(TENANT_A),
        "location_id": str(LOCATION_A1),
        "request_date": "2026-01-01T00:00:00",
        "account_manager_id": str(uuid4()),
        "recruiter_id": None,
        "client_name": "Deloitte USI",
        "full_name": "Test Candidate",
        "email": "test@example.com",
        "phone": None,
        "designation": "Engineer",
        "department": None,
        "work_location": None,
        "proposed_ctc": 1200000.0,
        "expected_doj": "2026-06-01",
        "stage": stage,
        "offer_released_at": None,
        "offer_letter_path": None,
        "is_revised": False,
        "confirmed_doj": None,
        "employee_id": None,
        "employee_id_auto": None,
        "appointment_released_at": None,
        "appointment_letter_path": None,
        "documents_submitted_at": None,
        "resignation_date": None,
        "last_working_day": None,
        "clearance_received": False,
        "clearance_date": None,
        "relieving_released_at": None,
        "relieving_letter_path": None,
        "hr_owner_id": None,
        "notes": None,
        "created_at": "2026-01-01T00:00:00",
        "updated_at": "2026-01-01T00:00:00",
    }
    row.update(overrides)
    return row


def _service_with_candidate(candidate_row: dict) -> tuple[CandidateService, MagicMock]:
    svc = CandidateService.__new__(CandidateService)
    mock_db = MagicMock()
    svc._db = mock_db

    # get_candidate()'s chain for role='hr': .select().eq("id").eq("tenant_id")
    # .eq("location_id").maybe_single().execute().data — three .eq() calls deep,
    # since _scope() adds both a tenant_id and (for HR) a location_id filter
    # on top of the id filter already applied before _scope() runs.
    select_chain = mock_db.table.return_value.select.return_value
    select_chain.eq.return_value.eq.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value.data = candidate_row
    # Also handle the super_user path, which only chains two .eq() calls (id, tenant_id).
    select_chain.eq.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value.data = candidate_row

    # the UPDATE call's .execute().data[0]
    updated_row = dict(candidate_row, stage="offered", offer_released_at="2026-02-01T00:00:00")
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value \
        .execute.return_value.data = [updated_row]

    return svc, mock_db


def test_release_offer_succeeds_from_requested_stage() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_make_candidate_row(candidate_id, stage="requested"))

    result = svc.release_offer(
        candidate_id=candidate_id, tenant_id=TENANT_A, role="hr",
        location_id=LOCATION_A1, released_by_user_id=HR_USER,
    )

    assert result.stage == "offered"
    assert result.offer_released_at is not None


@pytest.mark.parametrize("stage", ["offered", "revised", "joined", "active", "rejected", "exited"])
def test_release_offer_rejects_any_non_requested_stage(stage: str) -> None:
    candidate_id = uuid4()
    svc, _ = _service_with_candidate(_make_candidate_row(candidate_id, stage=stage))

    with pytest.raises(ValueError, match="Cannot release an offer"):
        svc.release_offer(
            candidate_id=candidate_id, tenant_id=TENANT_A, role="hr",
            location_id=LOCATION_A1, released_by_user_id=HR_USER,
        )


def test_release_offer_raises_for_invisible_candidate() -> None:
    """A candidate that doesn't exist, or belongs to a different
    location/tenant, must never be releasable — get_candidate's own
    scoping is what enforces this, release_offer just has to respect it."""
    svc = CandidateService.__new__(CandidateService)
    svc._db = MagicMock()
    svc.get_candidate = MagicMock(return_value=None)

    with pytest.raises(ValueError, match="not found"):
        svc.release_offer(
            candidate_id=uuid4(), tenant_id=TENANT_A, role="hr",
            location_id=LOCATION_A1, released_by_user_id=HR_USER,
        )


def test_release_offer_logs_an_event() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_make_candidate_row(candidate_id, stage="requested"))

    svc.release_offer(
        candidate_id=candidate_id, tenant_id=TENANT_A, role="hr",
        location_id=LOCATION_A1, released_by_user_id=HR_USER,
    )

    insert_call = mock_db.table.return_value.insert.call_args
    assert insert_call is not None, "release_offer must log a candidate_events row"
    inserted = insert_call.args[0]
    assert inserted["event_type"] == "offer_released"
    assert inserted["performed_by"] == str(HR_USER)


def test_release_offer_update_is_scoped_to_the_correct_tenant() -> None:
    """The UPDATE itself must be scoped, not just the preceding read —
    defense in depth against the read-check ever being bypassed or buggy."""
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_make_candidate_row(candidate_id, stage="requested"))

    svc.release_offer(
        candidate_id=candidate_id, tenant_id=TENANT_A, role="hr",
        location_id=LOCATION_A1, released_by_user_id=HR_USER,
    )

    update_chain = mock_db.table.return_value.update.return_value
    first_eq_calls = [c.args for c in update_chain.eq.call_args_list]
    second_eq_calls = [c.args for c in update_chain.eq.return_value.eq.call_args_list]
    assert ("id", str(candidate_id)) in first_eq_calls
    assert ("tenant_id", str(TENANT_A)) in second_eq_calls
