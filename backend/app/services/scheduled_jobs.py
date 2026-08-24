"""
Scheduled Jobs — the daily background checks the exit and joining flows
depend on:

  1. DOJ reminder: HR gets notified the day a candidate is expected to
     join (the "Joining Today" dashboard section already showed this
     passively since Milestone 2, but nothing ever sent the actual
     email — this closes that gap).
  2. Relieving reminder: 20 days after a candidate's Last Working Day,
     if their relieving letter still hasn't been released, HR gets a
     reminder to check on clearance and release it.

Both jobs iterate every active tenant — there's no single "current
user" context in a background job, so each tenant is checked
independently, tenant-wide (not scoped to any one location), and only
Super User + HR recipients relevant to each candidate's own location
are notified, via the same DirectoryService.get_notification_recipients
used everywhere else.
"""

from __future__ import annotations

import logging
from datetime import date
from uuid import UUID

from app.core.config import get_settings
from app.db.client import get_service_db, safe_data
from app.services.candidate_service import CandidateService
from app.services.directory_service import DirectoryService
from app.services.email_service import EmailService
from app.services.user_service import UserService

logger = logging.getLogger(__name__)


def _active_tenant_ids() -> list[UUID]:
    db = get_service_db()
    result = db.table("tenants").select("id").eq("is_active", True).execute()
    return [UUID(row["id"]) for row in result.data]


def _hr_email_for_location(location_id: UUID, tenant_id: UUID) -> str:
    db = get_service_db()
    hr_result = (
        db.table("user_profiles").select("id")
        .eq("tenant_id", str(tenant_id)).eq("location_id", str(location_id))
        .eq("role", "hr").eq("is_active", True).limit(1).execute()
    )
    if not hr_result.data:
        return ""
    return UserService().get_auth_email(UUID(hr_result.data[0]["id"]))


def run_doj_reminders() -> int:
    """Sends today's joining reminder for every candidate whose
    expected_doj is today, across every active tenant. Returns the
    number of reminders sent, mainly for logging/observability."""
    settings = get_settings()
    svc = CandidateService()
    directory = DirectoryService()
    sent = 0

    for tenant_id in _active_tenant_ids():
        # role="super_user" + location_id=None -> tenant-wide, unscoped to
        # any one location, since this runs independent of any logged-in user.
        candidates = svc.get_joining_today(tenant_id, role="super_user", location_id=None)
        for candidate in candidates:
            hr_email = _hr_email_for_location(candidate.location_id, tenant_id)
            am_email = ""
            if candidate.account_manager_id:
                db = get_service_db()
                am_result = (
                    db.table("directory_account_managers").select("email")
                    .eq("id", str(candidate.account_manager_id)).maybe_single().execute()
                )
                am_email = (safe_data(am_result) or {}).get("email", "")

            recipients = directory.get_notification_recipients(
                tenant_id=tenant_id, location_id=candidate.location_id,
                hr_email=hr_email, am_email=am_email,
            )
            portal_url = f"{settings.app_base_url}/recruitment/{candidate.id}"
            ok = EmailService().notify_doj_reminder(
                tenant_id=tenant_id, candidate_id=candidate.id, hr_recipients=recipients,
                candidate_name=candidate.full_name, client_name=candidate.client_name,
                doj=str(candidate.expected_doj), portal_url=portal_url,
            )
            if ok:
                sent += 1

    logger.info("DOJ reminder job: sent %d reminder(s)", sent)
    return sent


def run_relieving_reminders(reminder_days: int = 20) -> int:
    """Sends the relieving-letter-due reminder for every candidate whose
    Last Working Day was at least `reminder_days` ago and whose relieving
    letter still hasn't been released, across every active tenant."""
    settings = get_settings()
    svc = CandidateService()
    directory = DirectoryService()
    sent = 0

    for tenant_id in _active_tenant_ids():
        candidates = svc.get_pending_relieving_reminders(tenant_id, reminder_days=reminder_days)
        for candidate in candidates:
            hr_email = _hr_email_for_location(candidate.location_id, tenant_id)
            am_email = ""
            if candidate.account_manager_id:
                db = get_service_db()
                am_result = (
                    db.table("directory_account_managers").select("email")
                    .eq("id", str(candidate.account_manager_id)).maybe_single().execute()
                )
                am_email = (safe_data(am_result) or {}).get("email", "")

            recipients = directory.get_notification_recipients(
                tenant_id=tenant_id, location_id=candidate.location_id,
                hr_email=hr_email, am_email=am_email,
            )
            portal_url = f"{settings.app_base_url}/recruitment/{candidate.id}"
            ok = EmailService().notify_relieving_due(
                tenant_id=tenant_id, candidate_id=candidate.id, hr_recipients=recipients,
                candidate_name=candidate.full_name, employee_id=candidate.employee_id or "",
                last_working_day=str(candidate.last_working_day), portal_url=portal_url,
            )
            if ok:
                sent += 1

    logger.info("Relieving reminder job: sent %d reminder(s)", sent)
    return sent


def run_yearly_archive() -> int:
    """
    Runs the yearly document backup — only actually does anything on
    April 1st (the start of a new financial year, so the one that just
    ended gets archived). Checked daily like every other job in this
    module rather than scheduled with its own once-a-year cron trigger,
    since a once-a-year trigger that silently never fires again if it's
    ever missed (a deploy outage, a scheduler restart at the wrong
    moment) is a much easier failure to have go unnoticed than a daily
    check that's a no-op on 364 days and self-corrects if today's run
    was ever missed — it just picks it up on the next day it looks.

    Iterates every active tenant and every one of that tenant's
    locations independently, since the archive itself is scoped to a
    single location's candidates.
    """
    from app.services.document_service import DocumentService, previous_financial_year

    today = date.today()
    if today.month != 4 or today.day != 1:
        return 0

    settings = get_settings()
    financial_year = previous_financial_year(today)
    doc_svc = DocumentService()
    directory = DirectoryService()
    sent = 0

    for tenant_id in _active_tenant_ids():
        db = get_service_db()
        locations_result = db.table("locations").select("id, name").eq("tenant_id", str(tenant_id)).eq("is_active", True).execute()

        for location_row in locations_result.data:
            location_id = UUID(location_row["id"])
            zip_path = doc_svc.generate_yearly_archive(tenant_id, location_id, financial_year)
            if zip_path is None:
                continue  # nothing to archive at this location this year

            hr_email = _hr_email_for_location(location_id, tenant_id)
            recipients = directory.get_notification_recipients(
                tenant_id=tenant_id, location_id=location_id, hr_email=hr_email, am_email="",
            )
            docs_result = (
                db.table("candidate_documents").select("id", count="exact")
                .eq("archived_zip_path", zip_path).execute()
            )
            document_count = docs_result.count or 0

            portal_url = f"{settings.app_base_url}/admin/documents"
            ok = EmailService().notify_archive_ready(
                tenant_id=tenant_id, hr_recipients=recipients, financial_year=financial_year,
                location_name=location_row["name"], document_count=document_count, portal_url=portal_url,
            )
            if ok:
                sent += 1

    logger.info("Yearly archive job: archived FY %s, notified %d location(s)", financial_year, sent)
    return sent
