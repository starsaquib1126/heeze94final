"""
Public endpoints — no authentication required.

These are the routes Account Managers use via their constant link.
Since there's no JWT, we:
  1. Validate the tenant_slug from the URL so we know which company this is for
  2. Verify the account manager ID is in that tenant's directory
  3. Use the service key to write to the DB (bypassing RLS, but only for
     the offer-request table — no reads of any sensitive data)
  4. Trigger the HR notification immediately
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel

from app.db.client import get_service_db, safe_data
from app.models.user import AccountManager, OfferRequestCreate, PersonalDetailsSubmit, Recruiter
from app.services.directory_service import DirectoryService
from app.services.email_service import EmailService
from app.services.user_service import UserService
from app.core.config import get_settings

router = APIRouter(prefix="/public", tags=["public"])


def _resolve_tenant(slug: str) -> dict:
    """Get the tenant record from its slug — raises 404 if not found or inactive."""
    db = get_service_db()
    result = (
        db.table("tenants")
        .select("id, name, is_active")
        .eq("slug", slug)
        .maybe_single()
        .execute()
    )
    data = safe_data(result)
    if not data or not data["is_active"]:
        raise HTTPException(status_code=404, detail="Portal not found")
    return data


def _next_employee_id_number(tenant_id: str) -> int:
    """Atomically increment and return the next employee ID number."""
    db = get_service_db()
    result = db.rpc("increment_employee_id", {"p_tenant_id": tenant_id}).execute()
    return result.data


@router.get("/{tenant_slug}/form-data")
def get_form_data(tenant_slug: str = Path(...)) -> dict:
    """
    Returns the data the AM's form needs to populate its dropdowns:
      - Account Manager list (AM picks themselves)
      - Recruiter list
      - Client list (so AM can find their client — if not listed, they can type free text)
    No sensitive data is exposed here.
    """
    tenant = _resolve_tenant(tenant_slug)
    tenant_id = UUID(tenant["id"])
    svc = DirectoryService()

    return {
        "account_managers": [
            {"id": str(am.id), "name": am.full_name}
            for am in svc.list_account_managers(tenant_id)
        ],
        "recruiters": [
            {"id": str(r.id), "name": r.full_name}
            for r in svc.list_recruiters(tenant_id)
        ],
        "known_clients": [
            c.client_name
            for c in svc.list_client_mappings(tenant_id)
        ],
        # HR list — for the always-visible, editable HR picker
        "hr_users": _get_hr_list(tenant_id),
    }


@router.get("/{tenant_slug}/resolve-client-hr")
def resolve_client_hr(client_name: str, tenant_slug: str = Path(...)) -> dict:
    """
    Given a client name, returns which HR it currently routes to (per
    Client Routing) — without creating or submitting anything. Lets the
    form pre-fill the HR picker with the real, correct answer as the AM
    types, while still leaving it visible and editable rather than
    hidden behind automatic routing entirely.
    """
    tenant = _resolve_tenant(tenant_slug)
    tenant_id = UUID(tenant["id"])
    svc = DirectoryService()

    if not client_name or not client_name.strip():
        return {"hr_id": None, "hr_name": None}

    location = svc.resolve_client(tenant_id, client_name)
    if not location:
        return {"hr_id": None, "hr_name": None}

    db = get_service_db()
    hr_result = (
        db.table("user_profiles")
        .select("id, full_name")
        .eq("tenant_id", str(tenant_id))
        .eq("location_id", str(location.id))
        .eq("role", "hr")
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    if not hr_result.data:
        return {"hr_id": None, "hr_name": None}

    return {"hr_id": hr_result.data[0]["id"], "hr_name": hr_result.data[0]["full_name"]}


def _get_hr_list(tenant_id: UUID) -> list[dict]:
    db = get_service_db()
    result = (
        db.table("user_profiles")
        .select("id, full_name, location_id")
        .eq("tenant_id", str(tenant_id))
        .eq("role", "hr")
        .eq("is_active", True)
        .execute()
    )
    return [{"id": r["id"], "name": r["full_name"]} for r in result.data]


@router.post("/{tenant_slug}/account-managers/{account_manager_id}/send-code", status_code=200)
def send_am_verification_code(
    account_manager_id: UUID, tenant_slug: str = Path(...),
) -> dict:
    """
    Sends a 6-digit code to this Account Manager's own registered
    email — never one the caller types themselves — proving whoever is
    filling out the public form actually has access to that inbox
    before their request is accepted. Single-use, expires in 10 minutes.
    """
    tenant = _resolve_tenant(tenant_slug)
    tenant_id = UUID(tenant["id"])
    db = get_service_db()

    am_result = (
        db.table("directory_account_managers")
        .select("id, full_name, email")
        .eq("id", str(account_manager_id)).eq("tenant_id", str(tenant_id)).eq("is_active", True)
        .maybe_single().execute()
    )
    am = safe_data(am_result)
    if not am:
        raise HTTPException(status_code=404, detail="Account Manager not found")

    code = f"{random.randint(0, 999999):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    db.table("am_verification_codes").insert({
        "tenant_id": str(tenant_id), "account_manager_id": str(account_manager_id),
        "code": code, "expires_at": expires_at.isoformat(),
    }).execute()

    settings = get_settings()
    if settings.demo_mode:
        # DEMO MODE: real email sending is skipped entirely — see the
        # setting's own docstring in config.py for why this exists and
        # why it must be off in real production use.
        return {
            "status": "sent", "sent_to_email_ending_in": am["email"][-12:],
            "demo_code": code,
        }

    EmailService().send_am_verification_code(
        tenant_id, account_manager_id, am["email"], am["full_name"], code,
    )
    # Never echo the code itself, or the whole point of emailing it is moot.
    return {"status": "sent", "sent_to_email_ending_in": am["email"][-12:]}


def _verify_am_code(db, tenant_id: UUID, account_manager_id: UUID, code: str) -> None:
    """Raises HTTPException(400) if the code is missing, wrong, expired,
    or already used. Marks it used on success so it can't be replayed."""
    result = (
        db.table("am_verification_codes")
        .select("id, code, expires_at, used_at")
        .eq("tenant_id", str(tenant_id)).eq("account_manager_id", str(account_manager_id))
        .order("created_at", desc=True).limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=400, detail="No verification code was sent for this Account Manager.")
    row = rows[0]

    if row["used_at"]:
        raise HTTPException(status_code=400, detail="This verification code has already been used. Please request a new one.")
    expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This verification code has expired. Please request a new one.")
    if row["code"] != code.strip():
        raise HTTPException(status_code=400, detail="Incorrect verification code.")

    db.table("am_verification_codes").update({"used_at": datetime.now(timezone.utc).isoformat()}) \
        .eq("id", row["id"]).execute()


@router.post("/{tenant_slug}/offer-request", status_code=200)
def submit_offer_request(
    data: OfferRequestCreate,
    tenant_slug: str = Path(...),
    # Optional: if the client wasn't in the routing table, AM picked an HR directly
    hr_override_id: UUID | None = None,
) -> dict:
    """
    The core public action — AM submits a candidate/offer request.
    This is the only write operation on the public surface.

    Returns 200 with `status: "unrouted"` when the client isn't in the
    directory and no HR was picked yet — nothing is created in that case,
    so 201 (Created) would be misleading. A successful creation still
    reports its own `status: "submitted"` in the body for the frontend
    to distinguish the two outcomes.
    """
    tenant = _resolve_tenant(tenant_slug)
    tenant_id = UUID(tenant["id"])
    db = get_service_db()
    svc = DirectoryService()
    settings = get_settings()

    # 1. Verify the AM is in this tenant's directory
    am_check = (
        db.table("directory_account_managers")
        .select("id, full_name, email")
        .eq("id", str(data.account_manager_id))
        .eq("tenant_id", str(tenant_id))
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    am = safe_data(am_check)
    if not am:
        raise HTTPException(status_code=400, detail="Account Manager not found in directory")

    # 1a. Verify the code sent to this AM's own registered email — proves
    # whoever is submitting actually has access to that inbox.
    _verify_am_code(db, tenant_id, data.account_manager_id, data.verification_code)

    # 1b. Verify the recruiter (if given) also belongs to this tenant — same
    # standard as the AM check above. Without this, a client-side bug or a
    # crafted request could attach another tenant's recruiter_id to this
    # tenant's candidate record (this endpoint uses the service key, which
    # bypasses RLS, so this check is the only thing enforcing that boundary).
    if data.recruiter_id:
        recruiter_check = (
            db.table("directory_recruiters")
            .select("id")
            .eq("id", str(data.recruiter_id))
            .eq("tenant_id", str(tenant_id))
            .eq("is_active", True)
            .maybe_single()
            .execute()
        )
        if not safe_data(recruiter_check):
            raise HTTPException(status_code=400, detail="Recruiter not found in directory")

    # 2. Resolve the location — either from the client routing table or the HR override
    location = svc.resolve_client(tenant_id, data.client_name)
    if not location and not hr_override_id:
        # Client not in routing table and no HR was manually selected
        return {
            "status": "unrouted",
            "message": "Client not found in directory. Please select an HR from the list.",
        }

    if not location and hr_override_id:
        # AM picked an HR directly — resolve that HR's own location
        hr_profile_result = (
            db.table("user_profiles")
            .select("location_id, full_name, id")
            .eq("id", str(hr_override_id))
            .eq("tenant_id", str(tenant_id))
            .maybe_single()
            .execute()
        )
        hr_profile = safe_data(hr_profile_result)
        if not hr_profile:
            raise HTTPException(status_code=400, detail="Selected HR not found")

        loc_result = (
            db.table("locations")
            .select("*")
            .eq("id", hr_profile["location_id"])
            .maybe_single()
            .execute()
        )
        loc_data = safe_data(loc_result)
        if not loc_data:
            raise HTTPException(status_code=400, detail="HR location not found")
        from app.models.user import Location
        location = Location(**loc_data)
        hr_owner_id = str(hr_override_id)
    else:
        # Find the primary HR for this location
        hr_result = (
            db.table("user_profiles")
            .select("id")
            .eq("tenant_id", str(tenant_id))
            .eq("location_id", str(location.id))
            .eq("role", "hr")
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        hr_owner_id = hr_result.data[0]["id"] if hr_result.data else None

    # 3. Create the candidate record
    candidate_payload = {
        "tenant_id": str(tenant_id),
        "location_id": str(location.id),
        "account_manager_id": str(data.account_manager_id),
        "recruiter_id": str(data.recruiter_id) if data.recruiter_id else None,
        "client_name": data.client_name,
        "full_name": data.full_name,
        "email": data.email,
        "phone": data.phone,
        "designation": data.designation,
        "department": data.department,
        "work_location": data.work_location,
        "proposed_ctc": float(data.proposed_ctc) if data.proposed_ctc else None,
        "expected_doj": data.expected_doj.isoformat() if data.expected_doj else None,
        "pf_type": data.pf_type,
        "stage": "requested",
        "hr_owner_id": hr_owner_id,
    }
    candidate_result = db.table("candidates").insert(candidate_payload).execute()
    candidate = candidate_result.data[0]
    candidate_id = UUID(candidate["id"])

    # 4. Log the event
    db.table("candidate_events").insert({
        "candidate_id": str(candidate_id),
        "tenant_id": str(tenant_id),
        "event_type": "request_raised",
        "details": {
            "client_name": data.client_name,
            "am_name": am["full_name"],
            "routed_to_location": location.name,
        },
    }).execute()

    # 5. Get HR's email for notifications
    hr_email = UserService().get_auth_email(UUID(hr_owner_id)) if hr_owner_id else ""

    # 6. Build recipient list and send notification
    recipients = svc.get_notification_recipients(
        tenant_id=tenant_id,
        location_id=location.id,
        hr_email=hr_email,
        am_email=am["email"],
    )

    portal_url = f"{settings.app_base_url}/dashboard/candidates/{candidate_id}"
    EmailService().notify_new_request(
        tenant_id=tenant_id,
        candidate_id=candidate_id,
        recipients=recipients,
        candidate_name=data.full_name,
        client_name=data.client_name,
        am_name=am["full_name"],
        designation=data.designation,
        proposed_ctc=float(data.proposed_ctc) if data.proposed_ctc else None,
        expected_doj=data.expected_doj.isoformat() if data.expected_doj else None,
        portal_url=portal_url,
    )

    return {
        "status": "submitted",
        "message": "Your offer request has been submitted. The HR team has been notified.",
        "reference_id": str(candidate_id),
    }


# ---------------------------------------------------------------------- #
# Candidate document submission (Milestone 7)
#
# The one-time link sent to a candidate right after their Appointment
# Letter is released — no login, just a token in the URL. Deliberately
# allows multiple uploads over the token's validity window (not a
# single-use link that expires after the first document), since a
# candidate submitting PAN, Aadhaar, and a resume across a few visits
# is the realistic case, not one atomic batch upload.
# ---------------------------------------------------------------------- #

from fastapi import File, Form, UploadFile


def _resolve_document_token(token: str) -> dict:
    """Loads the token row, raising 404 for a missing/expired token —
    the same response either way, so an attacker probing for valid
    tokens can't distinguish "doesn't exist" from "expired"."""
    db = get_service_db()
    result = db.table("document_request_tokens").select("*").eq("token", token).maybe_single().execute()
    data = safe_data(result)
    if not data:
        raise HTTPException(status_code=404, detail="This link is invalid or has expired.")

    expires_at = datetime.fromisoformat(data["expires_at"].replace("Z", "+00:00"))
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=404, detail="This link is invalid or has expired.")

    return data


@router.get("/documents/{token}")
def get_document_request_info(token: str) -> dict:
    """Candidate-facing landing page data: who this link is for, so the
    upload page can greet them by name without needing a login."""
    token_row = _resolve_document_token(token)
    db = get_service_db()

    candidate_result = (
        db.table("candidates").select("full_name, client_name")
        .eq("id", token_row["candidate_id"]).maybe_single().execute()
    )
    candidate_data = safe_data(candidate_result)
    if not candidate_data:
        raise HTTPException(status_code=404, detail="This link is invalid or has expired.")

    tenant_result = db.table("tenants").select("name").eq("id", token_row["tenant_id"]).maybe_single().execute()
    tenant_data = safe_data(tenant_result)

    existing_docs = (
        db.table("candidate_documents").select("document_type, original_name, uploaded_at")
        .eq("candidate_id", token_row["candidate_id"]).execute()
    )

    return {
        "candidate_name": candidate_data["full_name"],
        "client_name": candidate_data["client_name"],
        "company_name": tenant_data["name"] if tenant_data else "",
        "already_submitted": existing_docs.data,
    }


@router.post("/documents/{token}/upload")
async def upload_candidate_document(
    token: str,
    document_type: str = Form(..., description="e.g. 'pan', 'aadhaar', 'resume', 'photo'"),
    file: UploadFile = File(...),
) -> dict:
    """
    Accepts one file per call — the candidate-facing page calls this once
    per document type they submit. Stored under the tenant's bucket,
    scoped by tenant and candidate, matching the same storage layout
    used for generated letters and branding assets.
    """
    token_row = _resolve_document_token(token)
    db = get_service_db()
    settings = get_settings()

    contents = await file.read()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = file.filename or "document"
    storage_path = (
        f"{token_row['tenant_id']}/candidates/{token_row['candidate_id']}/documents/"
        f"{document_type}_{timestamp}_{safe_name}"
    )
    db.storage.from_(settings.storage_bucket).upload(
        storage_path, contents, {"content-type": file.content_type or "application/octet-stream"},
    )

    from app.services.document_service import financial_year_for_date

    db.table("candidate_documents").insert({
        "tenant_id": token_row["tenant_id"],
        "candidate_id": token_row["candidate_id"],
        "document_type": document_type,
        "original_name": safe_name,
        "storage_path": storage_path,
        "financial_year": financial_year_for_date(datetime.now().date()),
    }).execute()

    # Mark the candidate's first-ever submission timestamp (idempotent —
    # only set if not already set) and the token's first-use timestamp,
    # without invalidating the token for further uploads.
    candidate_result = (
        db.table("candidates").select("documents_submitted_at")
        .eq("id", token_row["candidate_id"]).maybe_single().execute()
    )
    candidate_data = safe_data(candidate_result)
    if candidate_data and not candidate_data.get("documents_submitted_at"):
        db.table("candidates").update({"documents_submitted_at": datetime.now().isoformat()}) \
            .eq("id", token_row["candidate_id"]).execute()
        db.table("candidate_events").insert({
            "candidate_id": token_row["candidate_id"], "tenant_id": token_row["tenant_id"],
            "event_type": "documents_submitted", "performed_by": None,
            "details": {"document_type": document_type},
        }).execute()

    if not token_row.get("used_at"):
        db.table("document_request_tokens").update({"used_at": datetime.now().isoformat()}) \
            .eq("token", token).execute()

    return {"status": "uploaded", "document_type": document_type, "filename": safe_name}


@router.get("/documents/{token}/personal-details")
def get_personal_details(token: str) -> dict:
    """
    Returns whatever the candidate has already saved, so re-opening the
    link resumes where they left off rather than starting blank. Empty
    object (not 404) when nothing's been saved yet — a fresh form is a
    normal, expected state here, not an error.
    """
    token_row = _resolve_document_token(token)
    db = get_service_db()

    result = (
        db.table("candidate_personal_details").select("*")
        .eq("candidate_id", token_row["candidate_id"]).maybe_single().execute()
    )
    data = safe_data(result)
    return data or {}


@router.post("/documents/{token}/personal-details")
def submit_personal_details(token: str, data: PersonalDetailsSubmit, mark_submitted: bool = False) -> dict:
    """
    Saves the candidate's personal/bank/statutory details — replaces the
    real manual "fill in this Excel and email it back" process. Upserts
    (candidate_id is UNIQUE on this table): re-submitting updates the
    existing row rather than creating duplicates, so the candidate can
    save partial progress and come back to finish later.

    mark_submitted=True (sent when the candidate clicks the final
    "Submit" button, not on autosave) sets submitted_at and logs the
    completion event — distinguishing "still filling this in" from
    "actually done," the same distinction documents_submitted_at makes
    for the file-upload side of this same link.
    """
    token_row = _resolve_document_token(token)
    db = get_service_db()

    payload = data.model_dump(mode="json", exclude_unset=True)
    payload["tenant_id"] = token_row["tenant_id"]
    payload["candidate_id"] = token_row["candidate_id"]
    if mark_submitted:
        payload["submitted_at"] = datetime.now().isoformat()

    existing = (
        db.table("candidate_personal_details").select("id")
        .eq("candidate_id", token_row["candidate_id"]).maybe_single().execute()
    )
    if safe_data(existing):
        db.table("candidate_personal_details").update(payload) \
            .eq("candidate_id", token_row["candidate_id"]).execute()
    else:
        db.table("candidate_personal_details").insert(payload).execute()

    if mark_submitted:
        db.table("candidate_events").insert({
            "candidate_id": token_row["candidate_id"], "tenant_id": token_row["tenant_id"],
            "event_type": "documents_submitted", "performed_by": None,
            "details": {"personal_details_submitted": True},
        }).execute()

    return {"status": "saved"}
