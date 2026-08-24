"""
Pydantic models for every database entity.

Naming convention:
  XxxBase     — shared fields
  XxxCreate   — what the API accepts on creation (no id/timestamps)
  XxxUpdate   — partial update (all fields Optional)
  Xxx         — the full DB record as returned to callers
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator


# ------------------------------------------------------------------ #
# Tenant
# ------------------------------------------------------------------ #

class TenantCreate(BaseModel):
    name: str
    slug: str
    plan: str = "trial"


class Tenant(TenantCreate):
    id: UUID
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ #
# User Profile
# ------------------------------------------------------------------ #

class UserProfileCreate(BaseModel):
    # Always overridden server-side by both endpoints that use this model
    # (create_super_user, create_hr_user both set data.tenant_id = user's
    # own tenant_id unconditionally) — Optional here so the client never
    # has to send a value that gets discarded anyway. Requiring it as a
    # non-optional field was the root cause of a real bug: FastAPI's own
    # request validation rejects the request before the endpoint body
    # (where the override happens) ever runs, if the field is missing.
    tenant_id: UUID | None = None
    location_id: UUID | None = None
    full_name: str
    role: str
    email: EmailStr           # used to create the auth.users entry via Supabase Admin API

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("super_user", "hr"):
            raise ValueError("role must be 'super_user' or 'hr'")
        return v


class UserProfile(BaseModel):
    id: UUID
    tenant_id: UUID
    location_id: UUID | None
    full_name: str
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    # Not a column on user_profiles — Supabase keeps email on its own
    # auth.users table. Populated from the JWT payload in get_current_user()
    # rather than a second database query, since the JWT already carries it.
    email: str = ""

    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ #
# Location
# ------------------------------------------------------------------ #

class LocationCreate(BaseModel):
    name: str
    location_code: str
    address: str | None = None


class Location(LocationCreate):
    id: UUID
    tenant_id: UUID
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ #
# Directory
# ------------------------------------------------------------------ #

class DirectoryClientCreate(BaseModel):
    client_name: str
    location_id: UUID


class DirectoryClient(DirectoryClientCreate):
    id: UUID
    tenant_id: UUID
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AccountManagerCreate(BaseModel):
    full_name: str
    email: EmailStr


class AccountManager(AccountManagerCreate):
    id: UUID
    tenant_id: UUID
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RecruiterCreate(BaseModel):
    full_name: str


class Recruiter(RecruiterCreate):
    id: UUID
    tenant_id: UUID
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LeadershipCreate(BaseModel):
    location_id: UUID | None = None   # None = Core Director (company-wide)
    full_name: str
    email: EmailStr
    role_label: str | None = None
    is_constant: bool = False


class Leadership(LeadershipCreate):
    id: UUID
    tenant_id: UUID
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ #
# CTC Structure
# ------------------------------------------------------------------ #

class CTCLineItemCreate(BaseModel):
    key: str
    label: str
    section: str = "Earnings"
    guided_type: str | None = None
    formula: str | None = None
    guided_params: dict[str, Any] | None = None
    display_text: str = ""
    is_subtotal: bool = False
    spacer_after: bool | None = None
    item_order: int = 0


class CTCLineItem(CTCLineItemCreate):
    id: UUID
    structure_id: UUID

    model_config = ConfigDict(from_attributes=True)


class CTCStructureCreate(BaseModel):
    name: str
    location_id: UUID
    line_items: list[CTCLineItemCreate] = []


class CTCStructure(BaseModel):
    id: UUID
    tenant_id: UUID
    location_id: UUID
    name: str
    version: int
    is_current: bool
    cloned_from_id: UUID | None
    created_at: datetime
    line_items: list[CTCLineItem] = []

    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ #
# Letter Templates (block editor content)
# ------------------------------------------------------------------ #

LETTER_TYPES = (
    "offer", "appointment", "hike", "relieving",
    "experience", "confirmation", "warning", "appreciation", "promotion",
)


class LetterTemplateCreate(BaseModel):
    letter_type: str
    name: str
    blocks: list[dict[str, Any]] = []
    mandatory_placeholders: list[str] = []
    custom_placeholder_defaults: dict[str, str] = {}

    @field_validator("letter_type")
    @classmethod
    def _validate_letter_type(cls, v: str) -> str:
        if v not in LETTER_TYPES:
            raise ValueError(f"letter_type must be one of: {', '.join(LETTER_TYPES)}")
        return v


class LetterTemplate(BaseModel):
    id: UUID
    tenant_id: UUID
    letter_type: str
    name: str
    blocks: list[dict[str, Any]]
    docx_storage_path: str | None
    mandatory_placeholders: list[str]
    custom_placeholder_defaults: dict[str, str]
    is_active: bool
    version: int
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TenantBranding(BaseModel):
    tenant_id: UUID
    logo_storage_path: str | None
    signature_storage_path: str | None
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ #
# Candidate / Tracker
# ------------------------------------------------------------------ #

class OfferRequestCreate(BaseModel):
    """Posted by Account Manager via the public (no-auth) form."""
    account_manager_id: UUID
    recruiter_id: UUID | None = None
    client_name: str
    full_name: str
    email: EmailStr
    phone: str | None = None
    designation: str | None = None
    department: str | None = None
    work_location: str | None = None
    proposed_ctc: float | None = None
    expected_doj: date | None = None
    pf_type: str = "standard"
    # Proves whoever is filling this out actually has access to the
    # selected Account Manager's own registered email — see
    # /public/{slug}/account-managers/{id}/send-code.
    verification_code: str

    @field_validator("pf_type")
    @classmethod
    def validate_pf_type(cls, v: str) -> str:
        if v not in ("standard", "max", "none"):
            raise ValueError("pf_type must be 'standard', 'max', or 'none'")
        return v


class CandidateUpdate(BaseModel):
    """
    Partial update for a candidate still in 'requested' stage — editing
    after an offer is released goes through revise_offer instead, which
    has its own overwrite-and-tag-"Revised" semantics. Every field here
    is optional; only what's provided gets changed.
    """
    full_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    client_name: str | None = None
    designation: str | None = None
    department: str | None = None
    work_location: str | None = None
    proposed_ctc: float | None = None
    expected_doj: date | None = None


class HRCandidateCreate(BaseModel):
    """
    HR creating a request directly, bypassing the public Account
    Manager form entirely — for internal hiring, walk-ins, or any case
    where there's no external AM involved. Unlike OfferRequestCreate,
    account_manager_id is optional here (an AM isn't always relevant to
    an internally-sourced hire).
    """
    account_manager_id: UUID | None = None
    recruiter_id: UUID | None = None
    client_name: str
    full_name: str
    email: EmailStr
    phone: str | None = None
    designation: str | None = None
    department: str | None = None
    work_location: str | None = None
    proposed_ctc: float | None = None
    expected_doj: date | None = None
    pf_type: str = "standard"

    @field_validator("pf_type")
    @classmethod
    def validate_pf_type(cls, v: str) -> str:
        if v not in ("standard", "max", "none"):
            raise ValueError("pf_type must be 'standard', 'max', or 'none'")
        return v


class Candidate(BaseModel):
    id: UUID
    tenant_id: UUID
    location_id: UUID
    request_date: datetime
    account_manager_id: UUID | None
    recruiter_id: UUID | None
    client_name: str
    full_name: str
    email: str
    phone: str | None
    designation: str | None
    department: str | None
    work_location: str | None
    proposed_ctc: float | None
    expected_doj: date | None
    pf_type: str = "standard"
    stage: str
    offer_released_at: datetime | None
    offer_letter_path: str | None
    is_revised: bool
    confirmed_doj: date | None
    employee_id: str | None
    employee_id_auto: bool | None
    appointment_released_at: datetime | None
    appointment_letter_path: str | None
    documents_submitted_at: datetime | None
    resignation_date: date | None
    last_working_day: date | None
    clearance_received: bool
    clearance_date: date | None
    relieving_released_at: datetime | None
    relieving_letter_path: str | None
    hr_owner_id: UUID | None
    notes: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CandidateEvent(BaseModel):
    id: UUID
    candidate_id: UUID
    tenant_id: UUID
    event_type: str
    performed_by: UUID | None
    details: dict[str, Any]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NotificationLogEntry(BaseModel):
    id: UUID
    tenant_id: UUID
    candidate_id: UUID | None
    event_type: str
    recipients: list[dict[str, Any]]
    subject: str
    status: str
    error_message: str | None
    sent_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ #
# Hike Letter
# ------------------------------------------------------------------ #

class HikeLetterCreate(BaseModel):
    candidate_id: UUID
    previous_ctc: float
    revised_ctc: float
    effective_date: date


class HikeLetter(HikeLetterCreate):
    id: UUID
    tenant_id: UUID
    letter_path: str | None
    released_by: UUID | None
    released_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ #
# Document
# ------------------------------------------------------------------ #

class CandidateDocument(BaseModel):
    id: UUID
    tenant_id: UUID
    candidate_id: UUID
    document_type: str
    original_name: str
    storage_path: str
    financial_year: str | None
    is_archived: bool
    archived_zip_path: str | None
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PersonalDetailsSubmit(BaseModel):
    """
    Submitted by the candidate themselves via the same private token
    link used for document uploads — replaces the real "Urgent: Bank &
    Personal Details" manual email process. Every field is optional at
    the model level (a candidate might save partial progress), but the
    endpoint tracks submitted_at separately to distinguish "in progress"
    from "actually submitted."
    """
    # Personal
    name_as_per_pan: str | None = None
    contact_number: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_relation: str | None = None
    emergency_contact_mobile: str | None = None
    date_of_birth: date | None = None
    blood_group: str | None = None
    aadhaar_number: str | None = None
    pan_number: str | None = None
    pf_uan_number: str | None = None
    fathers_name: str | None = None
    mothers_name: str | None = None
    temporary_address: str | None = None
    permanent_address: str | None = None

    # Bank
    bank_account_holder_name: str | None = None
    bank_name: str | None = None
    bank_account_number: str | None = None
    bank_ifsc_code: str | None = None
    bank_branch_name: str | None = None

    # Insurance / dependents
    insurance_option: str | None = None
    spouse_name: str | None = None
    spouse_dob: date | None = None
    child_1_name: str | None = None
    child_1_gender: str | None = None
    child_1_dob: date | None = None
    child_2_name: str | None = None
    child_2_gender: str | None = None
    child_2_dob: date | None = None

    # Statutory (from the real PF filing spreadsheet)
    nationality: str | None = None
    qualification: str | None = None
    marital_status: str | None = None
    is_international_worker: bool = False
    country_of_origin: str | None = None
    passport_number: str | None = None
    passport_valid_from: date | None = None
    passport_valid_to: date | None = None
    has_physical_handicap: bool = False
    has_locomotive_disability: bool = False
    has_hearing_disability: bool = False
    has_visual_disability: bool = False
    previous_pf_member_id: str | None = None

    @field_validator("insurance_option")
    @classmethod
    def validate_insurance_option(cls, v: str | None) -> str | None:
        if v is not None and v not in ("self", "family"):
            raise ValueError("insurance_option must be 'self' or 'family'")
        return v

    @field_validator("marital_status")
    @classmethod
    def validate_marital_status(cls, v: str | None) -> str | None:
        if v is not None and v not in ("married", "unmarried"):
            raise ValueError("marital_status must be 'married' or 'unmarried'")
        return v


class PersonalDetails(PersonalDetailsSubmit):
    """The full stored record, as HR sees it — same fields as the
    submission, plus identity and submission metadata."""
    id: UUID
    tenant_id: UUID
    candidate_id: UUID
    submitted_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
