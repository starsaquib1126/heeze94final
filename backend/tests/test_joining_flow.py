"""
Tests for the joining flow (Milestone 7): confirm_joining,
assign_employee_id, release_appointment.

The state-machine transitions (each method only valid from one specific
prior stage) matter as much here as they did for release_offer — a
candidate can't be confirmed as joined before an offer went out, can't
get an Employee ID before joining is confirmed, and can't get an
appointment letter before an Employee ID exists. Each of these is
tested explicitly, not just the happy path.

Employee ID assignment gets the most scrutiny: it's the one place a
genuine collision would be a real, visible problem (two people with the
same ID), so both the auto-assignment path (via the atomic
`increment_employee_id` RPC) and the manual-override path (with its own
uniqueness check) are covered.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.candidate_service import CandidateService

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
        "offer_released_at": "2026-02-01T00:00:00", "offer_letter_path": "path/offer.docx",
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

    # get_candidate()'s chain for role='hr': .select().eq("id").eq("tenant_id")
    # .eq("location_id").maybe_single().execute().data — three .eq() calls
    # deep, since _scope() adds both a tenant_id and (for HR) a location_id
    # filter on top of the id filter already applied before _scope() runs.
    select_chain = mock_db.table.return_value.select.return_value
    select_chain.eq.return_value.eq.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value.data = row

    updated_row = dict(row)
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [updated_row]

    return svc, mock_db


# ---------------------------------------------------------------------- #
# confirm_joining
# ---------------------------------------------------------------------- #
@pytest.mark.parametrize("stage", ["offered", "revised"])
def test_confirm_joining_succeeds_from_offered_or_revised(stage: str) -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage=stage))
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data[0]["stage"] = "joined"

    result = svc.confirm_joining(
        candidate_id, "2026-06-05", TENANT_A, "hr", LOCATION_A1, PERFORMER
    )
    assert result.stage == "joined"


@pytest.mark.parametrize("stage", ["requested", "joined", "id_assigned", "active", "rejected", "exited"])
def test_confirm_joining_rejects_wrong_stage(stage: str) -> None:
    candidate_id = uuid4()
    svc, _ = _service_with_candidate(_candidate_row(candidate_id, stage=stage))
    with pytest.raises(ValueError, match="Cannot confirm joining"):
        svc.confirm_joining(candidate_id, "2026-06-05", TENANT_A, "hr", LOCATION_A1, PERFORMER)


# ---------------------------------------------------------------------- #
# assign_employee_id — auto path
# ---------------------------------------------------------------------- #
def test_assign_employee_id_auto_uses_atomic_rpc() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="joined"))

    mock_db.rpc.return_value.execute.return_value.data = 1042

    updated_row = dict(_candidate_row(candidate_id, stage="joined"))
    updated_row["stage"] = "id_assigned"
    updated_row["employee_id"] = "IB-1042"
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [updated_row]

    result = svc.assign_employee_id(candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER)

    mock_db.rpc.assert_called_once_with("increment_employee_id", {"p_tenant_id": str(TENANT_A)})
    assert result.employee_id == "IB-1042"
    assert result.stage == "id_assigned"


def test_assign_employee_id_only_valid_from_joined_stage() -> None:
    candidate_id = uuid4()
    svc, _ = _service_with_candidate(_candidate_row(candidate_id, stage="offered"))
    with pytest.raises(ValueError, match="Cannot assign an Employee ID"):
        svc.assign_employee_id(candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER)


# ---------------------------------------------------------------------- #
# assign_employee_id — manual override path
# ---------------------------------------------------------------------- #
def test_assign_employee_id_manual_override_skips_the_rpc_entirely() -> None:
    """The manual path must never call the auto-increment RPC — this is
    the explicitly required "manual input option" from the design, not
    just a fallback that quietly still consults the sequence."""
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="joined"))

    # No existing employee_id conflict
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value.data = None

    updated_row = dict(_candidate_row(candidate_id, stage="joined"))
    updated_row["stage"] = "id_assigned"
    updated_row["employee_id"] = "IB-CUSTOM-001"
    updated_row["employee_id_auto"] = False
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [updated_row]

    result = svc.assign_employee_id(
        candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER, manual_code="ib-custom-001"
    )

    mock_db.rpc.assert_not_called()
    assert result.employee_id == "IB-CUSTOM-001"
    assert result.employee_id_auto is False


def test_assign_employee_id_manual_code_must_be_unique() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="joined"))

    # Simulate an existing candidate already using this code
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value.data = {"id": str(uuid4())}

    with pytest.raises(ValueError, match="already in use"):
        svc.assign_employee_id(
            candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER, manual_code="IB-DUPLICATE-001"
        )


def test_assign_employee_id_manual_code_is_uppercased() -> None:
    """Consistency with how codes look everywhere else in the app —
    lowercase input shouldn't produce a differently-cased ID than the
    auto-generated ones."""
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(_candidate_row(candidate_id, stage="joined"))
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value.data = None

    updated_row = dict(_candidate_row(candidate_id, stage="joined"))
    updated_row["employee_id"] = "IB-LOWER-002"
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [updated_row]

    svc.assign_employee_id(candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER, manual_code="ib-lower-002")

    update_call_args = mock_db.table.return_value.update.call_args.args[0]
    assert update_call_args["employee_id"] == "IB-LOWER-002"


# ---------------------------------------------------------------------- #
# release_appointment
# ---------------------------------------------------------------------- #
def test_release_appointment_only_valid_from_id_assigned() -> None:
    candidate_id = uuid4()
    svc, _ = _service_with_candidate(_candidate_row(candidate_id, stage="joined"))
    with pytest.raises(ValueError, match="Employee ID must be assigned first"):
        svc.release_appointment(
            candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER, appointment_letter_path="x.docx"
        )


def test_release_appointment_transitions_to_active() -> None:
    candidate_id = uuid4()
    svc, mock_db = _service_with_candidate(
        _candidate_row(candidate_id, stage="id_assigned", employee_id="IB-NOI-1042")
    )
    updated_row = dict(_candidate_row(candidate_id, stage="id_assigned", employee_id="IB-NOI-1042"))
    updated_row["stage"] = "active"
    updated_row["appointment_letter_path"] = "appointment.docx"
    mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [updated_row]

    result = svc.release_appointment(
        candidate_id, TENANT_A, "hr", LOCATION_A1, PERFORMER, appointment_letter_path="appointment.docx"
    )
    assert result.stage == "active"
    assert result.appointment_letter_path == "appointment.docx"


# ---------------------------------------------------------------------- #
# Document request token
# ---------------------------------------------------------------------- #
def test_create_document_request_token_uses_the_database_generated_token() -> None:
    """The token itself must come from the database's own random default,
    never be invented in application code — this method should just read
    back whatever the DB generated, not construct a token value itself."""
    candidate_id = uuid4()
    svc = CandidateService.__new__(CandidateService)
    mock_db = MagicMock()
    svc._db = mock_db

    mock_db.table.return_value.insert.return_value.execute.return_value.data = [
        {"token": "a1b2c3d4e5f6", "id": str(uuid4())}
    ]

    token = svc.create_document_request_token(candidate_id, TENANT_A)
    assert token == "a1b2c3d4e5f6"
