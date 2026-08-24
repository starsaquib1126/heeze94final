"""
Tests for Milestone 9: revise_offer and the Hike Letter service.

The property that matters most for hikes: `previous_ctc` is always
computed by the service from the candidate's actual current CTC —
never supplied by the caller — specifically so it can never drift out
of sync with reality across multiple hikes over an employee's tenure.
That derivation (most recent hike's revised_ctc, or the candidate's
original proposed_ctc if there's no prior hike) gets the most scrutiny.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.candidate_service import CandidateService
from app.services.hike_service import HikeService

TENANT_A = uuid4()
LOCATION_A1 = uuid4()
PERFORMER = uuid4()


def _candidate_row(candidate_id, stage="offered", **overrides) -> dict:
    row = {
        "id": str(candidate_id), "tenant_id": str(TENANT_A), "location_id": str(LOCATION_A1),
        "request_date": "2026-01-01T00:00:00", "account_manager_id": str(uuid4()), "recruiter_id": None,
        "client_name": "Deloitte USI", "full_name": "Test Candidate", "email": "test@example.com",
        "phone": None, "designation": "Engineer", "department": None, "work_location": None,
        "proposed_ctc": 1200000.0, "expected_doj": "2026-06-01", "stage": stage,
        "offer_released_at": "2026-02-01T00:00:00", "offer_letter_path": "offer.docx",
        "is_revised": False, "confirmed_doj": None, "employee_id": None, "employee_id_auto": None,
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
# revise_offer
# ---------------------------------------------------------------------- #
@pytest.mark.parametrize("stage", ["offered", "revised"])
def test_revise_offer_succeeds_from_offered_or_revised(stage: str) -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage=stage))
    updated_row = dict(_candidate_row(candidate_id, stage="revised", is_revised=True))
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [updated_row]

    result = svc.revise_offer(
        candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER, offer_letter_path="revised.docx",
        proposed_ctc=1400000.0,
    )
    assert result.stage == "revised"
    assert result.is_revised is True


@pytest.mark.parametrize("stage", ["requested", "joined", "id_assigned", "active", "rejected", "exited"])
def test_revise_offer_rejects_wrong_stage(stage: str) -> None:
    candidate_id = uuid4()
    svc, _ = _service_with_candidate(_candidate_row(candidate_id, stage=stage))
    with pytest.raises(ValueError, match="Cannot revise an offer"):
        svc.revise_offer(candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER, offer_letter_path="x.docx")


def test_revise_offer_only_updates_provided_fields() -> None:
    """Fields left as None must not overwrite the candidate's existing
    values — only an explicitly provided field should change."""
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="offered"))

    svc.revise_offer(
        candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER, offer_letter_path="revised.docx",
        proposed_ctc=1500000.0,  # only CTC changes
    )

    update_call_args = mock_db.table.return_value.update.call_args.args[0]
    assert update_call_args["proposed_ctc"] == 1500000.0
    assert "expected_doj" not in update_call_args
    assert "designation" not in update_call_args


def test_revise_offer_logs_event_with_only_changed_fields() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="offered"))

    svc.revise_offer(
        candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER, offer_letter_path="revised.docx",
        expected_doj="2026-07-01",
    )

    insert_calls = mock_db.table.return_value.insert.call_args_list
    event_insert = next(c.args[0] for c in insert_calls if c.args[0].get("event_type") == "offer_revised")
    assert event_insert["details"] == {"expected_doj": "2026-07-01"}


# ---------------------------------------------------------------------- #
# HikeService.get_current_ctc — the derivation logic that matters most
# ---------------------------------------------------------------------- #
def test_current_ctc_falls_back_to_proposed_ctc_when_no_prior_hikes() -> None:
    candidate_id = uuid4()
    svc = HikeService.__new__(HikeService)
    mock_db = MagicMock()
    svc._db = mock_db

    # No hike history at all
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .order.return_value.limit.return_value.execute.return_value.data = []
    # Falls back to the candidate's original proposed_ctc
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value.data = {"proposed_ctc": 1200000.0}

    current = svc.get_current_ctc(candidate_id, TENANT_A)
    assert current == 1200000.0


def test_current_ctc_uses_most_recent_hikes_revised_ctc_when_hikes_exist() -> None:
    """This is the case that actually matters for a second (or third)
    hike: the baseline must be the LAST hike's outcome, not the original
    offer CTC, which would silently undercount cumulative raises."""
    candidate_id = uuid4()
    svc = HikeService.__new__(HikeService)
    mock_db = MagicMock()
    svc._db = mock_db

    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .order.return_value.limit.return_value.execute.return_value.data = [{"revised_ctc": 1500000.0}]

    current = svc.get_current_ctc(candidate_id, TENANT_A)
    assert current == 1500000.0


def test_current_ctc_raises_if_candidate_has_no_ctc_at_all() -> None:
    candidate_id = uuid4()
    svc = HikeService.__new__(HikeService)
    mock_db = MagicMock()
    svc._db = mock_db

    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .order.return_value.limit.return_value.execute.return_value.data = []
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value.data = {"proposed_ctc": None}

    with pytest.raises(ValueError, match="no CTC on record"):
        svc.get_current_ctc(candidate_id, TENANT_A)


def test_release_hike_never_accepts_previous_ctc_as_a_parameter() -> None:
    """Structural check: release_hike's signature must not let a caller
    supply previous_ctc directly — it's always derived internally via
    get_current_ctc, which is the whole point of this design."""
    import inspect
    signature = inspect.signature(HikeService.release_hike)
    assert "previous_ctc" not in signature.parameters


def test_release_hike_computes_previous_ctc_from_current_ctc() -> None:
    candidate_id = uuid4()
    svc = HikeService.__new__(HikeService)
    mock_db = MagicMock()
    svc._db = mock_db

    svc.get_current_ctc = MagicMock(return_value=1300000.0)

    inserted_row = {
        "id": str(uuid4()), "tenant_id": str(TENANT_A), "candidate_id": str(candidate_id),
        "previous_ctc": 1300000.0, "revised_ctc": 1500000.0, "effective_date": "2026-09-01",
        "letter_path": "hike.docx", "released_by": str(PERFORMER), "released_at": "2026-08-15T00:00:00",
    }
    mock_db.table.return_value.insert.return_value.execute.return_value.data = [inserted_row]

    result = svc.release_hike(
        candidate_id, TENANT_A, revised_ctc=1500000.0, effective_date="2026-09-01",
        released_by=PERFORMER, letter_path="hike.docx",
    )

    assert result.previous_ctc == 1300000.0
    assert result.revised_ctc == 1500000.0
    svc.get_current_ctc.assert_called_once_with(candidate_id, TENANT_A)


def test_release_hike_logs_an_event() -> None:
    candidate_id = uuid4()
    svc = HikeService.__new__(HikeService)
    mock_db = MagicMock()
    svc._db = mock_db
    svc.get_current_ctc = MagicMock(return_value=1200000.0)

    inserted_row = {
        "id": str(uuid4()), "tenant_id": str(TENANT_A), "candidate_id": str(candidate_id),
        "previous_ctc": 1200000.0, "revised_ctc": 1400000.0, "effective_date": "2026-09-01",
        "letter_path": "hike.docx", "released_by": str(PERFORMER), "released_at": "2026-08-15T00:00:00",
    }
    mock_db.table.return_value.insert.return_value.execute.return_value.data = [inserted_row]

    svc.release_hike(
        candidate_id, TENANT_A, revised_ctc=1400000.0, effective_date="2026-09-01",
        released_by=PERFORMER, letter_path="hike.docx",
    )

    insert_calls = mock_db.table.return_value.insert.call_args_list
    event_insert = next((c.args[0] for c in insert_calls if c.args[0].get("event_type") == "hike_released"), None)
    assert event_insert is not None
    assert event_insert["details"]["previous_ctc"] == 1200000.0
    assert event_insert["details"]["revised_ctc"] == 1400000.0
