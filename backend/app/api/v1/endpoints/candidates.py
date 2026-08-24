"""
Candidate Tracker, Dashboard, Offer Release & Letter Generation endpoints.

Milestone 2 built the read-only tracker/dashboard surface. Milestone 3
added the first write action: releasing an offer, plus the notification
pipeline. Milestone 5 adds real document generation, reusing the block
templates and CTC structures built in Milestone 4.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.auth import CurrentUser
from app.core.config import get_settings
from app.db.client import get_service_db, safe_data
from app.models.candidate_context import LetterGenerationContext
from app.models.user import Candidate, CandidateEvent, CandidateUpdate, HRCandidateCreate, NotificationLogEntry
from app.services.candidate_service import ACTIVE_STAGES, CandidateService
from app.services.directory_service import DirectoryService
from app.services.email_service import EmailService
from app.services.letter_generation_service import LetterGenerationService
from app.services.user_service import UserService


def _download_letter_bytes(storage_path: str, filename_hint: str) -> tuple[bytes | None, str | None]:
    """
    Fetches a generated letter's bytes for email attachment. Returns
    (None, None) on any failure rather than raising — a candidate not
    receiving an attachment on their copy is worth logging, but must
    never block the release itself, since the document already exists
    in the portal regardless of whether this download succeeds.
    """
    try:
        db = get_service_db()
        settings = get_settings()
        content = db.storage.from_(settings.storage_bucket).download(storage_path)
        filename = f"{filename_hint}.docx"
        return content, filename
    except Exception:
        return None, None

router = APIRouter(tags=["candidates"])


@router.get("/candidates", response_model=list[Candidate])
def list_candidates(
    user: CurrentUser,
    stage: str | None = Query(None, description="Filter to a single pipeline stage"),
    search: str | None = Query(None, description="Search name, email, or client"),
    limit: int = Query(100, le=500),
) -> list[Candidate]:
    return CandidateService().list_candidates(
        tenant_id=user.tenant_id,
        role=user.role,
        location_id=user.location_id,
        stage=stage,
        search=search,
        limit=limit,
    )


@router.post("/candidates", response_model=Candidate, status_code=201)
def create_candidate(
    data: HRCandidateCreate, user: CurrentUser,
    location_id: UUID | None = Query(None, description="Required if the caller is Super User (not location-scoped)"),
) -> Candidate:
    """
    HR creating a request directly — bypassing the public Account
    Manager form for internal hires, walk-ins, or anything with no
    external AM involved. HR users are always scoped to their own
    location; Super Users must specify which location via the query param.
    """
    target_location = location_id if user.role == "super_user" else user.location_id
    if target_location is None:
        raise HTTPException(status_code=400, detail="location_id is required")
    try:
        return CandidateService().create_candidate_direct(
            data, user.tenant_id, target_location, created_by=user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/candidates/export")
def export_candidates(
    user: CurrentUser,
    stage: str | None = Query(None),
    date_from: str | None = Query(None, description="ISO date, filters on request_date"),
    date_to: str | None = Query(None, description="ISO date, filters on request_date"),
    recruiter_id: UUID | None = Query(None),
    account_manager_id: UUID | None = Query(None),
):
    """
    Filterable Excel export of the tracker — built for periodic
    incentive/reporting use, hence the filters, rather than a single
    unfiltered dump that then has to be filtered manually in Excel.
    Respects the same scoping as everything else: HR only ever exports
    their own location's candidates.
    """
    from fastapi.responses import StreamingResponse
    from app.services.excel_export_service import ExcelExportService

    candidates = CandidateService().list_candidates(
        tenant_id=user.tenant_id, role=user.role, location_id=user.location_id,
        stage=stage, date_from=date_from, date_to=date_to,
        recruiter_id=recruiter_id, account_manager_id=account_manager_id,
        limit=10000,  # export needs a much higher ceiling than the tracker's page view
    )

    xlsx_bytes = ExcelExportService().build_export(candidates)
    filename = f"candidates_export_{date_from or 'all'}_{date_to or 'all'}.xlsx"

    return StreamingResponse(
        iter([xlsx_bytes]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/candidates/{candidate_id}", response_model=Candidate)
def get_candidate(candidate_id: UUID, user: CurrentUser) -> Candidate:
    candidate = CandidateService().get_candidate(
        candidate_id, user.tenant_id, user.role, user.location_id
    )
    if candidate is None:
        # Deliberately the same 404 whether the candidate doesn't exist at all
        # or exists but belongs to a location/tenant this user can't see —
        # a distinct "exists but forbidden" response would leak that a given
        # candidate_id is valid to someone who shouldn't know that.
        raise HTTPException(status_code=404, detail="Candidate not found")
    return candidate


@router.patch("/candidates/{candidate_id}", response_model=Candidate)
def update_candidate(candidate_id: UUID, data: CandidateUpdate, user: CurrentUser) -> Candidate:
    """Edit a request's own details — only valid while still in
    'requested' stage. See CandidateService.update_candidate."""
    updates = data.model_dump(exclude_unset=True, mode="json")
    try:
        return CandidateService().update_candidate(
            candidate_id, user.tenant_id, user.role, user.location_id, updates=updates,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/candidates/{candidate_id}", status_code=204)
def delete_candidate(candidate_id: UUID, user: CurrentUser) -> None:
    """Permanently remove a request — only valid while still in
    'requested' stage. See CandidateService.delete_candidate."""
    try:
        CandidateService().delete_candidate(candidate_id, user.tenant_id, user.role, user.location_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/candidates/{candidate_id}/events", response_model=list[CandidateEvent])
def get_candidate_events(candidate_id: UUID, user: CurrentUser) -> list[CandidateEvent]:
    events = CandidateService().get_candidate_events(
        candidate_id, user.tenant_id, user.role, user.location_id
    )
    # get_candidate_events returns [] both for "no events yet" and "not
    # visible to this user" — distinguish them so a genuinely inaccessible
    # candidate still 404s instead of silently looking like an empty timeline.
    if not events:
        candidate = CandidateService().get_candidate(
            candidate_id, user.tenant_id, user.role, user.location_id
        )
        if candidate is None:
            raise HTTPException(status_code=404, detail="Candidate not found")
    return events


@router.get("/dashboard/analytics")
def get_analytics(
    user: CurrentUser,
    date_from: str | None = Query(None, description="ISO date — filter to requests raised on/after this date"),
    date_to: str | None = Query(None, description="ISO date — filter to requests raised on/before this date"),
) -> dict:
    """Headline recruiting metrics: requests raised, offers released,
    joined, rejected, and the offer→joining conversion rate."""
    return CandidateService().get_analytics(
        user.tenant_id, user.role, user.location_id, date_from=date_from, date_to=date_to,
    )


@router.get("/dashboard/summary")
def get_dashboard_summary(user: CurrentUser) -> dict:
    """
    Everything the dashboard's landing view needs in one call:
      - stage_counts: headline numbers for the stat cards
      - upcoming_joinings: candidates joining within the lookahead window
      - joining_today: candidates whose expected DOJ is today (what the
        DOJ notification is about — surfaced here too so it's visible
        even if a notification was missed or the app was closed)
    """
    settings = get_settings()
    svc = CandidateService()

    stage_counts = svc.get_stage_counts(user.tenant_id, user.role, user.location_id)
    upcoming = svc.get_upcoming_joinings(
        user.tenant_id, user.role, user.location_id,
        lookahead_days=settings.upcoming_doj_lookahead_days,
    )
    joining_today = svc.get_joining_today(user.tenant_id, user.role, user.location_id)

    active_total = sum(stage_counts.get(s, 0) for s in ACTIVE_STAGES)

    return {
        "stage_counts": stage_counts,
        "active_total": active_total,
        "upcoming_joinings": upcoming,
        "joining_today": joining_today,
    }


@router.post("/candidates/{candidate_id}/release-offer", response_model=Candidate)
def release_offer(
    candidate_id: UUID,
    user: CurrentUser,
    context: LetterGenerationContext | None = None,
    ctc_structure_id: UUID | None = Query(None, description="Required if the offer template includes a CTC breakup table"),
) -> Candidate:
    """
    Release the offer letter for a candidate still in 'requested' stage.

    As of Milestone 5, this actually generates the document — using the
    tenant's active Offer Letter template and (if the template needs one)
    the given CTC structure — BEFORE transitioning the tracker stage.
    Generation failing (no template configured, missing required fields,
    invalid CTC structure) blocks the whole release: there's deliberately
    no state where a candidate shows as "Offered" in the tracker with no
    actual letter behind it.
    """
    generation_context = context or LetterGenerationContext()

    try:
        storage_path = LetterGenerationService().generate_for_candidate(
            candidate_id=candidate_id, letter_type="offer", tenant_id=user.tenant_id,
            context=generation_context, ctc_structure_id=ctc_structure_id,
            role=user.role, location_id=user.location_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    svc = CandidateService()
    try:
        candidate = svc.release_offer(
            candidate_id=candidate_id,
            tenant_id=user.tenant_id,
            role=user.role,
            location_id=user.location_id,
            released_by_user_id=user.id,
            offer_letter_path=storage_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Build the notification recipient list and send — failures here are
    # logged (see EmailService.send) but never block the release itself;
    # the tracker state change is the source of truth, not the email.
    db = get_service_db()
    directory = DirectoryService()

    am_email = ""
    if candidate.account_manager_id:
        am_result = (
            db.table("directory_account_managers")
            .select("email")
            .eq("id", str(candidate.account_manager_id))
            .maybe_single()
            .execute()
        )
        am_email = (safe_data(am_result) or {}).get("email", "")

    hr_user_id = candidate.hr_owner_id or user.id
    hr_email = UserService().get_auth_email(hr_user_id)

    recipients = directory.get_notification_recipients(
        tenant_id=user.tenant_id,
        location_id=candidate.location_id,
        hr_email=hr_email,
        am_email=am_email,
    )

    settings = get_settings()
    portal_url = f"{settings.app_base_url}/recruitment/{candidate.id}"
    letter_bytes, letter_filename = _download_letter_bytes(storage_path, f"Offer_Letter_{candidate.full_name}")
    EmailService().notify_offer_released(
        tenant_id=user.tenant_id,
        candidate_id=candidate.id,
        recipients=recipients,
        candidate_name=candidate.full_name,
        candidate_email=candidate.email,
        client_name=candidate.client_name,
        is_revised=False,
        portal_url=portal_url,
        attachment_bytes=letter_bytes, attachment_filename=letter_filename,
    )

    return candidate


class RejectOfferRequest(BaseModel):
    reason: str | None = None
    notify_candidate: bool = False


@router.post("/candidates/{candidate_id}/reject-offer", response_model=Candidate)
def reject_offer(candidate_id: UUID, data: RejectOfferRequest, user: CurrentUser) -> Candidate:
    """
    Revoke/decline an already-released offer — the candidate turned it
    down, or it was released in error. Only valid from 'offered' or
    'revised'. Moves to the terminal 'rejected' stage rather than
    deleting the record, preserving the history of what was offered.

    The internal distribution (AM/HR/Leadership) is always notified.
    Notifying the candidate directly is opt-in via notify_candidate —
    off by default, since a rejection often means the candidate
    declined it themselves and already knows.
    """
    try:
        candidate = CandidateService().reject_offer(
            candidate_id, user.tenant_id, user.role, user.location_id,
            performed_by=user.id, reason=data.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    db = get_service_db()
    directory = DirectoryService()

    am_email = ""
    if candidate.account_manager_id:
        am_result = (
            db.table("directory_account_managers").select("email")
            .eq("id", str(candidate.account_manager_id)).maybe_single().execute()
        )
        am_email = (safe_data(am_result) or {}).get("email", "")

    hr_user_id = candidate.hr_owner_id or user.id
    hr_email = UserService().get_auth_email(hr_user_id)

    recipients = directory.get_notification_recipients(
        tenant_id=user.tenant_id, location_id=candidate.location_id,
        hr_email=hr_email, am_email=am_email,
    )

    settings = get_settings()
    portal_url = f"{settings.app_base_url}/recruitment/{candidate.id}"
    EmailService().notify_offer_rejected(
        tenant_id=user.tenant_id, candidate_id=candidate.id, recipients=recipients,
        candidate_name=candidate.full_name, candidate_email=candidate.email,
        reason=data.reason, portal_url=portal_url, notify_candidate=data.notify_candidate,
    )

    return candidate


@router.post("/candidates/{candidate_id}/generate/{letter_type}")
def generate_letter(
    candidate_id: UUID,
    letter_type: str,
    context: LetterGenerationContext,
    user: CurrentUser,
    ctc_structure_id: UUID | None = Query(None, description="Required for letter types with a CTC breakup table"),
) -> dict:
    """
    Generate a real .docx for this candidate using the tenant's active
    template for `letter_type`, uploading the result to storage.

    This does NOT change the candidate's tracker stage or send any
    notification — it just produces the document. `release_offer` (and,
    later, the appointment/hike/relieving equivalents) call this
    internally and handle the stage transition + notification on top.
    """
    # Confirm this candidate is actually visible to the caller before
    # generating anything for them — same access rule as every other
    # candidate-scoped endpoint.
    candidate = CandidateService().get_candidate(candidate_id, user.tenant_id, user.role, user.location_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")

    try:
        storage_path = LetterGenerationService().generate_for_candidate(
            candidate_id=candidate_id, letter_type=letter_type, tenant_id=user.tenant_id,
            context=context, ctc_structure_id=ctc_structure_id,
            role=user.role, location_id=user.location_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"storage_path": storage_path}


@router.get("/candidates/{candidate_id}/letter-url")
def get_letter_download_url(
    candidate_id: UUID,
    user: CurrentUser,
    field: str = Query(..., description="Which stored path to sign, e.g. 'offer_letter_path'"),
) -> dict:
    """
    Returns a time-limited signed URL for a candidate's generated letter.
    Storage paths are never exposed directly as public URLs — everything
    in the bucket requires a signed URL, generated fresh per request and
    scoped to whoever can already see this candidate.
    """
    candidate = CandidateService().get_candidate(candidate_id, user.tenant_id, user.role, user.location_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")

    allowed_fields = {"offer_letter_path", "appointment_letter_path", "relieving_letter_path"}
    if field not in allowed_fields:
        raise HTTPException(status_code=400, detail=f"field must be one of: {', '.join(allowed_fields)}")

    storage_path = getattr(candidate, field, None)
    if not storage_path:
        raise HTTPException(status_code=404, detail="No document has been generated for this field yet")

    settings = get_settings()
    db = get_service_db()
    signed = db.storage.from_(settings.storage_bucket).create_signed_url(storage_path, 300)  # 5 minutes
    return {"url": signed.get("signedURL") or signed.get("signedUrl")}


@router.get("/candidates/{candidate_id}/notifications", response_model=list[NotificationLogEntry])
def get_candidate_notifications(candidate_id: UUID, user: CurrentUser) -> list[NotificationLogEntry]:
    """
    Every email actually sent for this candidate — proof of delivery (or
    failure). Same 404-for-invisible-candidate pattern as
    get_candidate_events: distinguishes "no notifications yet" from
    "you can't see this candidate at all" rather than returning an
    identical empty list for both.
    """
    entries = CandidateService().get_notification_log(
        candidate_id, user.tenant_id, user.role, user.location_id
    )
    if not entries:
        candidate = CandidateService().get_candidate(
            candidate_id, user.tenant_id, user.role, user.location_id
        )
        if candidate is None:
            raise HTTPException(status_code=404, detail="Candidate not found")
    return entries


# ---------------------------------------------------------------------- #
# Joining flow (Milestone 7)
# ---------------------------------------------------------------------- #

class ConfirmJoiningRequest(BaseModel):
    confirmed_doj: str  # ISO date


class AssignEmployeeIdRequest(BaseModel):
    manual_code: str | None = None


@router.post("/candidates/{candidate_id}/confirm-joining", response_model=Candidate)
def confirm_joining(candidate_id: UUID, data: ConfirmJoiningRequest, user: CurrentUser) -> Candidate:
    """Mark a candidate as having actually joined. Valid only from
    'offered' or 'revised' — see CandidateService.confirm_joining."""
    try:
        return CandidateService().confirm_joining(
            candidate_id, data.confirmed_doj, user.tenant_id, user.role, user.location_id,
            performed_by=user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/candidates/{candidate_id}/assign-employee-id", response_model=Candidate)
def assign_employee_id(candidate_id: UUID, data: AssignEmployeeIdRequest, user: CurrentUser) -> Candidate:
    """
    Assign the candidate's Employee ID — auto-suggested from the shared
    cross-location sequence by default, or `manual_code` to override
    entirely. The one deliberately manual step in the pipeline, per the
    explicit design requirement that this never happens without a human
    able to confirm or change it.
    """
    try:
        return CandidateService().assign_employee_id(
            candidate_id, user.tenant_id, user.role, user.location_id,
            performed_by=user.id, manual_code=data.manual_code,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/candidates/{candidate_id}/resend-document-link", status_code=200)
def resend_document_link(candidate_id: UUID, user: CurrentUser) -> dict:
    """
    Generates a fresh document-submission link and emails it to the
    candidate directly — for when the original link expired, got lost,
    or never reached them in the first place. Doesn't invalidate any
    still-valid earlier link; both would work.
    """
    candidate = CandidateService().get_candidate(candidate_id, user.tenant_id, user.role, user.location_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")

    settings = get_settings()
    token = CandidateService().create_document_request_token(candidate_id, user.tenant_id)
    document_link = f"{settings.app_base_url}/documents/{token}"

    EmailService().notify_document_link_resent(
        tenant_id=user.tenant_id, candidate_id=candidate_id,
        candidate_name=candidate.full_name, candidate_email=candidate.email,
        document_link=document_link,
    )
    return {"status": "sent"}


@router.post("/candidates/{candidate_id}/suggest-employee-id")
def suggest_employee_id(candidate_id: UUID, user: CurrentUser) -> dict:
    """
    Preview what the auto-assigned Employee ID *would* be, without
    actually consuming a number from the sequence — lets the frontend
    show a suggested value in an editable field (matching the desktop
    app's "Assign Employee ID" dialog pattern) before the HR admin
    commits to it. Calling this never advances the sequence; only
    `assign_employee_id` (without a manual_code) does that.
    """
    candidate = CandidateService().get_candidate(candidate_id, user.tenant_id, user.role, user.location_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")

    db = get_service_db()

    # Preview only: read the CURRENT sequence value without incrementing it,
    # so calling this repeatedly (e.g. re-opening the dialog) never burns
    # through numbers nobody ended up using.
    seq_result = db.table("employee_id_sequences").select("last_number").eq("tenant_id", str(user.tenant_id)).maybe_single().execute()
    seq_data = safe_data(seq_result)
    next_number = (seq_data["last_number"] + 1) if seq_data else 1001

    return {"suggested_employee_id": f"IB-{next_number}"}


@router.post("/candidates/{candidate_id}/release-appointment", response_model=Candidate)
def release_appointment(
    candidate_id: UUID,
    user: CurrentUser,
    context: LetterGenerationContext | None = None,
    ctc_structure_id: UUID | None = Query(None, description="Required if the appointment template includes a CTC breakup table"),
) -> Candidate:
    """
    Release the Appointment Letter and promote the candidate to 'active'
    — same fail-closed guarantee as release_offer: document generation
    must succeed before the tracker stage changes. Also creates the
    candidate's document-request token and fires the notification
    pipeline, matching the designed workflow: appointment letter ->
    candidate becomes active -> a link goes out for them to submit
    their own documents.
    """
    generation_context = context or LetterGenerationContext()

    try:
        storage_path = LetterGenerationService().generate_for_candidate(
            candidate_id=candidate_id, letter_type="appointment", tenant_id=user.tenant_id,
            context=generation_context, ctc_structure_id=ctc_structure_id,
            role=user.role, location_id=user.location_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    svc = CandidateService()
    try:
        candidate = svc.release_appointment(
            candidate_id=candidate_id, tenant_id=user.tenant_id, role=user.role,
            location_id=user.location_id, performed_by=user.id,
            appointment_letter_path=storage_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Create the candidate's document submission link right away — per
    # the designed workflow, this goes out immediately once the
    # appointment letter is released, not as a separate manual step.
    settings = get_settings()
    token = svc.create_document_request_token(candidate_id, user.tenant_id)
    document_link = f"{settings.app_base_url}/documents/{token}"

    db = get_service_db()
    directory = DirectoryService()

    am_email = ""
    if candidate.account_manager_id:
        am_result = (
            db.table("directory_account_managers").select("email")
            .eq("id", str(candidate.account_manager_id)).maybe_single().execute()
        )
        am_email = (safe_data(am_result) or {}).get("email", "")

    hr_user_id = candidate.hr_owner_id or user.id
    hr_email = UserService().get_auth_email(hr_user_id)

    recipients = directory.get_notification_recipients(
        tenant_id=user.tenant_id, location_id=candidate.location_id,
        hr_email=hr_email, am_email=am_email,
    )

    portal_url = f"{settings.app_base_url}/recruitment/{candidate.id}"
    letter_bytes, letter_filename = _download_letter_bytes(storage_path, f"Appointment_Letter_{candidate.full_name}")
    EmailService().notify_appointment_released(
        tenant_id=user.tenant_id, candidate_id=candidate.id, recipients=recipients,
        candidate_name=candidate.full_name, candidate_email=candidate.email,
        client_name=candidate.client_name,
        employee_id=candidate.employee_id or "", portal_url=portal_url,
        document_link=document_link,
        attachment_bytes=letter_bytes, attachment_filename=letter_filename,
    )

    return candidate


# ---------------------------------------------------------------------- #
# Exit flow (Milestone 8)
# ---------------------------------------------------------------------- #
class LogResignationRequest(BaseModel):
    resignation_date: str  # ISO date
    last_working_day: str  # ISO date


class MarkClearanceRequest(BaseModel):
    clearance_date: str  # ISO date


@router.post("/candidates/{candidate_id}/log-resignation", response_model=Candidate)
def log_resignation(candidate_id: UUID, data: LogResignationRequest, user: CurrentUser) -> Candidate:
    """
    Logs a resignation/layoff and sends the employee their Last Working
    Day intimation directly — the one notification in this whole
    pipeline sent to the employee's own email rather than the internal
    AM/HR/Leadership distribution.
    """
    svc = CandidateService()
    try:
        candidate = svc.log_resignation(
            candidate_id, data.resignation_date, data.last_working_day,
            user.tenant_id, user.role, user.location_id, performed_by=user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    EmailService().notify_lwd_intimation(
        tenant_id=user.tenant_id, candidate_id=candidate.id,
        employee_email=candidate.email, employee_name=candidate.full_name,
        last_working_day=data.last_working_day,
    )

    return candidate


@router.post("/candidates/{candidate_id}/mark-clearance", response_model=Candidate)
def mark_clearance_received(candidate_id: UUID, data: MarkClearanceRequest, user: CurrentUser) -> Candidate:
    """
    HR manually confirms clearance was received from the Client — this
    system never verifies clearance on its own, it only records that HR
    has confirmed it (per the explicit design: "there should be a
    release relieving letter — we receive clearance from Client, post
    that we release it").
    """
    try:
        return CandidateService().mark_clearance_received(
            candidate_id, data.clearance_date, user.tenant_id, user.role, user.location_id,
            performed_by=user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/candidates/{candidate_id}/release-relieving", response_model=Candidate)
def release_relieving(
    candidate_id: UUID,
    user: CurrentUser,
    context: LetterGenerationContext | None = None,
) -> Candidate:
    """
    Release the Relieving Letter. Fail-closed like release_offer and
    release_appointment — document generation must succeed first — AND
    additionally gated on clearance_received, checked in the service
    layer itself (see CandidateService.release_relieving) so it can
    never be bypassed by a future caller that skips a UI step.
    """
    generation_context = context or LetterGenerationContext()

    try:
        storage_path = LetterGenerationService().generate_for_candidate(
            candidate_id=candidate_id, letter_type="relieving", tenant_id=user.tenant_id,
            context=generation_context, ctc_structure_id=None,
            role=user.role, location_id=user.location_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    svc = CandidateService()
    try:
        candidate = svc.release_relieving(
            candidate_id=candidate_id, tenant_id=user.tenant_id, role=user.role,
            location_id=user.location_id, performed_by=user.id,
            relieving_letter_path=storage_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    db = get_service_db()
    directory = DirectoryService()

    am_email = ""
    if candidate.account_manager_id:
        am_result = (
            db.table("directory_account_managers").select("email")
            .eq("id", str(candidate.account_manager_id)).maybe_single().execute()
        )
        am_email = (safe_data(am_result) or {}).get("email", "")

    hr_user_id = candidate.hr_owner_id or user.id
    hr_email = UserService().get_auth_email(hr_user_id)

    recipients = directory.get_notification_recipients(
        tenant_id=user.tenant_id, location_id=candidate.location_id,
        hr_email=hr_email, am_email=am_email,
    )

    settings = get_settings()
    portal_url = f"{settings.app_base_url}/recruitment/{candidate.id}"
    letter_bytes, letter_filename = _download_letter_bytes(storage_path, f"Relieving_Letter_{candidate.full_name}")
    EmailService().notify_relieving_released(
        tenant_id=user.tenant_id, candidate_id=candidate.id, recipients=recipients,
        candidate_name=candidate.full_name, candidate_email=candidate.email,
        employee_id=candidate.employee_id or "",
        last_working_day=str(candidate.last_working_day or ""), portal_url=portal_url,
        attachment_bytes=letter_bytes, attachment_filename=letter_filename,
    )

    return candidate


# ---------------------------------------------------------------------- #
# Revise Offer & Hike Letter (Milestone 9)
# ---------------------------------------------------------------------- #
from app.models.user import HikeLetter
from app.services.hike_service import HikeService


class ReviseOfferRequest(BaseModel):
    proposed_ctc: float | None = None
    expected_doj: str | None = None
    designation: str | None = None
    department: str | None = None
    work_location: str | None = None


class ReleaseHikeRequest(BaseModel):
    revised_ctc: float
    effective_date: str  # ISO date


@router.post("/candidates/{candidate_id}/revise-offer", response_model=Candidate)
def revise_offer(
    candidate_id: UUID,
    data: ReviseOfferRequest,
    user: CurrentUser,
    ctc_structure_id: UUID | None = Query(None, description="Required if the offer template includes a CTC breakup table"),
) -> Candidate:
    """
    Revise an already-released offer — overwrites the candidate's terms
    and tags the record "Revised", per the explicit design decision
    (distinct from CTC structures, which version, and hikes, which
    append). Fail-closed like every other release action: the letter
    generates first, and only a successful generation lets the tracker
    actually change.
    """
    context = LetterGenerationContext(
        revised_ctc_override=data.proposed_ctc, location=data.work_location,
    )
    try:
        storage_path = LetterGenerationService().generate_for_candidate(
            candidate_id=candidate_id, letter_type="offer", tenant_id=user.tenant_id,
            context=context, ctc_structure_id=ctc_structure_id,
            role=user.role, location_id=user.location_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    svc = CandidateService()
    try:
        candidate = svc.revise_offer(
            candidate_id, user.tenant_id, user.role, user.location_id, performed_by=user.id,
            offer_letter_path=storage_path,
            proposed_ctc=data.proposed_ctc, expected_doj=data.expected_doj,
            designation=data.designation, department=data.department, work_location=data.work_location,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    db = get_service_db()
    directory = DirectoryService()
    am_email = ""
    if candidate.account_manager_id:
        am_result = (
            db.table("directory_account_managers").select("email")
            .eq("id", str(candidate.account_manager_id)).maybe_single().execute()
        )
        am_email = (safe_data(am_result) or {}).get("email", "")
    hr_user_id = candidate.hr_owner_id or user.id
    hr_email = UserService().get_auth_email(hr_user_id)
    recipients = directory.get_notification_recipients(
        tenant_id=user.tenant_id, location_id=candidate.location_id,
        hr_email=hr_email, am_email=am_email,
    )
    settings = get_settings()
    portal_url = f"{settings.app_base_url}/recruitment/{candidate.id}"
    letter_bytes, letter_filename = _download_letter_bytes(storage_path, f"Revised_Offer_Letter_{candidate.full_name}")
    EmailService().notify_offer_released(
        tenant_id=user.tenant_id, candidate_id=candidate.id, recipients=recipients,
        candidate_name=candidate.full_name, candidate_email=candidate.email,
        client_name=candidate.client_name,
        is_revised=True, portal_url=portal_url,
        attachment_bytes=letter_bytes, attachment_filename=letter_filename,
    )

    return candidate


@router.get("/candidates/{candidate_id}/hikes", response_model=list[HikeLetter])
def get_hike_history(candidate_id: UUID, user: CurrentUser) -> list[HikeLetter]:
    candidate = CandidateService().get_candidate(candidate_id, user.tenant_id, user.role, user.location_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return HikeService().get_hike_history(candidate_id, user.tenant_id)


@router.post("/candidates/{candidate_id}/release-hike", response_model=HikeLetter)
def release_hike(candidate_id: UUID, data: ReleaseHikeRequest, user: CurrentUser) -> HikeLetter:
    """
    Release a Hike Letter — a standalone action on an active employee,
    not a tracker stage transition (the candidate's stage stays
    'active' across any number of hikes over their tenure). Same
    fail-closed generation-before-record guarantee as every other
    release action.
    """
    candidate = CandidateService().get_candidate(candidate_id, user.tenant_id, user.role, user.location_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if candidate.stage != "active":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot release a hike letter for a candidate in stage '{candidate.stage}' — "
                   f"only active employees are eligible for a hike.",
        )

    context = LetterGenerationContext(
        revised_ctc_override=data.revised_ctc, effective_date=data.effective_date,
    )
    try:
        storage_path = LetterGenerationService().generate_for_candidate(
            candidate_id=candidate_id, letter_type="hike", tenant_id=user.tenant_id,
            context=context, ctc_structure_id=None,
            role=user.role, location_id=user.location_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        hike = HikeService().release_hike(
            candidate_id, user.tenant_id, revised_ctc=data.revised_ctc,
            effective_date=data.effective_date, released_by=user.id, letter_path=storage_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    db = get_service_db()
    directory = DirectoryService()
    am_email = ""
    if candidate.account_manager_id:
        am_result = (
            db.table("directory_account_managers").select("email")
            .eq("id", str(candidate.account_manager_id)).maybe_single().execute()
        )
        am_email = (safe_data(am_result) or {}).get("email", "")
    hr_user_id = candidate.hr_owner_id or user.id
    hr_email = UserService().get_auth_email(hr_user_id)
    recipients = directory.get_notification_recipients(
        tenant_id=user.tenant_id, location_id=candidate.location_id,
        hr_email=hr_email, am_email=am_email,
    )
    settings = get_settings()
    portal_url = f"{settings.app_base_url}/recruitment/{candidate.id}"
    letter_bytes, letter_filename = _download_letter_bytes(storage_path, f"Hike_Letter_{candidate.full_name}")
    EmailService().notify_hike_released(
        tenant_id=user.tenant_id, candidate_id=candidate.id, recipients=recipients,
        candidate_name=candidate.full_name, candidate_email=candidate.email,
        employee_id=candidate.employee_id or "",
        previous_ctc=hike.previous_ctc, revised_ctc=hike.revised_ctc,
        effective_date=data.effective_date, portal_url=portal_url,
        attachment_bytes=letter_bytes, attachment_filename=letter_filename,
    )

    return hike


# ---------------------------------------------------------------------- #
# Document Vault (Milestone 10)
# ---------------------------------------------------------------------- #
from app.models.user import CandidateDocument
from app.services.document_service import DocumentService


@router.get("/candidates/{candidate_id}/documents", response_model=list[CandidateDocument])
def list_candidate_documents(candidate_id: UUID, user: CurrentUser) -> list[CandidateDocument]:
    """
    HR view of everything a candidate has submitted through their
    document link. Originals stay listed here forever, regardless of
    whether they've since been included in a yearly archive ZIP — per
    the explicit design decision that archiving is a backup, not a
    replacement.
    """
    return DocumentService().list_documents(candidate_id, user.tenant_id, user.role, user.location_id)


@router.get("/candidates/{candidate_id}/documents/{document_id}/url")
def get_document_download_url(candidate_id: UUID, document_id: UUID, user: CurrentUser) -> dict:
    url = DocumentService().get_download_url(document_id, user.tenant_id, user.role, user.location_id)
    if url is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"url": url}
