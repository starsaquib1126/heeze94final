"""
Guards against the exact bug found in Milestone 5: the `Candidate`
Pydantic model was missing `offer_letter_path`, `appointment_letter_path`,
and `relieving_letter_path` even though the database schema always had
them, and `release_offer` explicitly wrote to one of them. Pydantic v2
silently drops fields a model doesn't declare, so this didn't raise an
error anywhere — it just meant the field quietly vanished the moment a
database row got parsed back into a `Candidate` object, which nothing
short of actually checking for the field's presence would catch.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import uuid4

from app.models.user import Candidate

# Every column the candidates table actually has, per
# supabase/migrations/001_initial_schema.sql — kept as an explicit list
# here (not introspected from the schema file) so this test fails loudly
# if the model and the schema ever drift apart again, rather than only
# failing once someone happens to hit the missing field at runtime.
EXPECTED_CANDIDATE_FIELDS = {
    "id", "tenant_id", "location_id", "request_date", "account_manager_id",
    "recruiter_id", "client_name", "full_name", "email", "phone", "designation",
    "department", "work_location", "proposed_ctc", "expected_doj", "stage",
    "offer_released_at", "offer_letter_path", "is_revised", "confirmed_doj",
    "employee_id", "employee_id_auto", "appointment_released_at",
    "appointment_letter_path", "documents_submitted_at", "resignation_date",
    "last_working_day", "clearance_received", "clearance_date",
    "relieving_released_at", "relieving_letter_path", "hr_owner_id", "notes",
    "created_at", "updated_at",
}


def test_candidate_model_declares_every_expected_field() -> None:
    model_fields = set(Candidate.model_fields.keys())
    missing = EXPECTED_CANDIDATE_FIELDS - model_fields
    assert not missing, (
        f"Candidate model is missing fields that exist in the database schema: {missing}. "
        f"This is exactly the bug found in Milestone 5 — a field silently vanishes when "
        f"a database row is parsed into a Candidate object, with no error anywhere."
    )


def test_candidate_can_actually_be_constructed_with_a_letter_path_set() -> None:
    """Belt-and-suspenders: construct a real Candidate with all three
    letter path fields populated, confirming they're genuinely usable
    attributes afterward, not just declared and silently ignored."""
    candidate = Candidate(
        id=uuid4(), tenant_id=uuid4(), location_id=uuid4(), request_date=datetime.now(),
        account_manager_id=None, recruiter_id=None, client_name="Test Client",
        full_name="Test Candidate", email="test@example.com", phone=None, designation=None,
        department=None, work_location=None, proposed_ctc=None, expected_doj=None,
        stage="offered",
        offer_released_at=datetime.now(), offer_letter_path="tenant/candidates/x/offer.docx",
        is_revised=False, confirmed_doj=None, employee_id=None, employee_id_auto=None,
        appointment_released_at=None, appointment_letter_path="tenant/candidates/x/appt.docx",
        documents_submitted_at=None, resignation_date=None, last_working_day=None,
        clearance_received=False, clearance_date=None, relieving_released_at=None,
        relieving_letter_path="tenant/candidates/x/relieving.docx",
        hr_owner_id=None, notes=None, created_at=datetime.now(), updated_at=datetime.now(),
    )
    assert candidate.offer_letter_path == "tenant/candidates/x/offer.docx"
    assert candidate.appointment_letter_path == "tenant/candidates/x/appt.docx"
    assert candidate.relieving_letter_path == "tenant/candidates/x/relieving.docx"
