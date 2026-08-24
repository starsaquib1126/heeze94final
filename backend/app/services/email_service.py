"""
Email Notification Service.

Every step of the candidate pipeline sends an email copy to:
  - Account Manager who raised the request
  - HR owner of the location
  - Core Director (company-wide)
  - Location Director (for this location)
  - Constant entries (e.g. hr@ibridgetechsoft.com)

All sends are logged to the notification_log table regardless of
success or failure — so HR always has proof of what was (or wasn't) sent.

Using Resend for deliverability — generous free tier (3,000/month),
works with custom domains, has a clean Python SDK.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

import resend

from app.core.config import get_settings
from app.db.client import get_service_db


class EmailService:
    def __init__(self) -> None:
        s = get_settings()
        resend.api_key = s.resend_api_key
        self._from = f"{s.email_from_name} <{s.email_from}>"
        self._db = get_service_db()

    def _log(
        self,
        tenant_id: UUID,
        candidate_id: UUID | None,
        event_type: str,
        recipients: list[dict],
        subject: str,
        status: str,
        error: str | None = None,
    ) -> None:
        self._db.table("notification_log").insert({
            "tenant_id": str(tenant_id),
            "candidate_id": str(candidate_id) if candidate_id else None,
            "event_type": event_type,
            "recipients": recipients,
            "subject": subject,
            "status": status,
            "error_message": error,
        }).execute()

    def send(
        self,
        tenant_id: UUID,
        candidate_id: UUID | None,
        event_type: str,
        recipients: list[dict],  # [{email, name, role}]
        subject: str,
        html_body: str,
        to_override: str | None = None,
        attachment_bytes: bytes | None = None,
        attachment_filename: str | None = None,
    ) -> bool:
        """
        Default behavior (to_override=None): every recipient goes in "to",
        unchanged from before — used by internal-only notifications (DOJ
        reminders, relieving reminders, archive-ready).

        When `to_override` is given (a candidate's own email), that
        becomes the sole "to" recipient and everyone in `recipients`
        moves to "cc" instead — used when a letter goes directly to the
        candidate with the internal distribution copied, not addressed.
        """
        if to_override:
            to_list = [to_override]
            cc_list = [r["email"] for r in recipients]
        else:
            to_list = [r["email"] for r in recipients]
            cc_list = []

        payload = {
            "from": self._from,
            "to": to_list,
            "subject": subject,
            "html": html_body,
        }
        if cc_list:
            payload["cc"] = cc_list
        if attachment_bytes and attachment_filename:
            import base64
            payload["attachments"] = [{
                "filename": attachment_filename,
                "content": base64.b64encode(attachment_bytes).decode(),
            }]

        try:
            resend.Emails.send(payload)
            self._log(tenant_id, candidate_id, event_type, recipients, subject, "sent")
            return True
        except Exception as exc:
            self._log(
                tenant_id, candidate_id, event_type, recipients, subject,
                "failed", str(exc)
            )
            return False

    # ------------------------------------------------------------------ #
    # Typed wrappers for each pipeline event — enforces consistent
    # subjects and bodies rather than having each API endpoint compose them
    # ------------------------------------------------------------------ #

    def notify_new_request(
        self,
        tenant_id: UUID,
        candidate_id: UUID,
        recipients: list[dict],
        candidate_name: str,
        client_name: str,
        am_name: str,
        designation: str | None,
        proposed_ctc: float | None,
        expected_doj: str | None,
        portal_url: str,
    ) -> bool:
        subject = f"New Offer Request — {candidate_name} ({client_name})"
        html = f"""
        <h2>New Offer Request Raised</h2>
        <p><b>Candidate:</b> {candidate_name}<br>
           <b>Client:</b> {client_name}<br>
           <b>Designation:</b> {designation or "—"}<br>
           <b>Proposed CTC:</b> {f"₹{proposed_ctc:,.0f}" if proposed_ctc else "—"}<br>
           <b>Expected DOJ:</b> {expected_doj or "—"}<br>
           <b>Raised by:</b> {am_name}</p>
        <p><a href="{portal_url}">Open in Portal →</a></p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated notification from the iBridge HR Portal.
        </p>
        """
        return self.send(tenant_id, candidate_id, "request_raised", recipients, subject, html)

    def notify_offer_released(
        self,
        tenant_id: UUID,
        candidate_id: UUID,
        recipients: list[dict],
        candidate_name: str,
        candidate_email: str,
        client_name: str,
        is_revised: bool,
        portal_url: str,
        attachment_bytes: bytes | None = None,
        attachment_filename: str | None = None,
    ) -> bool:
        action = "Offer Letter Revised" if is_revised else "Offer Letter"
        subject = f"{action} — {candidate_name}"
        html = f"""
        <p>Dear {candidate_name},</p>
        <p>Please find your {action.lower()} attached to this email.</p>
        <p>If you have any questions, please reach out to your point of contact.</p>
        <p>Warm regards,<br>HR Team</p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated notification from the iBridge HR Portal.
        </p>
        """
        return self.send(
            tenant_id, candidate_id,
            "offer_revised" if is_revised else "offer_released",
            recipients, subject, html,
            to_override=candidate_email,
            attachment_bytes=attachment_bytes, attachment_filename=attachment_filename,
        )

    def notify_appointment_released(
        self,
        tenant_id: UUID,
        candidate_id: UUID,
        recipients: list[dict],
        candidate_name: str,
        candidate_email: str,
        employee_id: str,
        client_name: str,
        portal_url: str,
        document_link: str | None = None,
        attachment_bytes: bytes | None = None,
        attachment_filename: str | None = None,
    ) -> bool:
        subject = f"Appointment Letter — {candidate_name}"
        document_link_html = f"""
        <p>Please also submit your documents (PAN, Aadhaar, bank details, and a few
        statutory forms) using this link, at your earliest convenience:</p>
        <p><a href="{document_link}" style="font-weight:bold;">{document_link}</a></p>
        """ if document_link else ""
        html = f"""
        <p>Dear {candidate_name},</p>
        <p>Please find your Appointment Letter attached to this email.</p>
        {document_link_html}
        <p>If you have any questions, please reach out to your point of contact.</p>
        <p>Warm regards,<br>HR Team</p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated notification from the iBridge HR Portal.
        </p>
        """
        return self.send(
            tenant_id, candidate_id, "appointment_released", recipients, subject, html,
            to_override=candidate_email,
            attachment_bytes=attachment_bytes, attachment_filename=attachment_filename,
        )

    def notify_hike_released(
        self,
        tenant_id: UUID,
        candidate_id: UUID,
        recipients: list[dict],
        candidate_name: str,
        candidate_email: str,
        employee_id: str,
        previous_ctc: float,
        revised_ctc: float,
        effective_date: str,
        portal_url: str,
        attachment_bytes: bytes | None = None,
        attachment_filename: str | None = None,
    ) -> bool:
        subject = f"Salary Revision Letter — {candidate_name}"
        html = f"""
        <p>Dear {candidate_name},</p>
        <p>Please find your Salary Revision Letter attached to this email.</p>
        <p>If you have any questions, please reach out to your point of contact.</p>
        <p>Warm regards,<br>HR Team</p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated notification from the iBridge HR Portal.
        </p>
        """
        return self.send(
            tenant_id, candidate_id, "hike_released", recipients, subject, html,
            to_override=candidate_email,
            attachment_bytes=attachment_bytes, attachment_filename=attachment_filename,
        )

    def notify_relieving_released(
        self,
        tenant_id: UUID,
        candidate_id: UUID,
        recipients: list[dict],
        candidate_name: str,
        candidate_email: str,
        employee_id: str,
        last_working_day: str,
        portal_url: str,
        attachment_bytes: bytes | None = None,
        attachment_filename: str | None = None,
    ) -> bool:
        subject = f"Relieving Letter — {candidate_name}"
        html = f"""
        <p>Dear {candidate_name},</p>
        <p>Please find your Relieving Letter attached to this email.</p>
        <p>If you have any questions, please reach out to your point of contact.</p>
        <p>Warm regards,<br>HR Team</p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated notification from the iBridge HR Portal.
        </p>
        """
        return self.send(
            tenant_id, candidate_id, "relieving_released", recipients, subject, html,
            to_override=candidate_email,
            attachment_bytes=attachment_bytes, attachment_filename=attachment_filename,
        )

    def notify_lwd_intimation(
        self,
        tenant_id: UUID,
        candidate_id: UUID,
        employee_email: str,
        employee_name: str,
        last_working_day: str,
    ) -> bool:
        """
        The one notification in this class that goes directly to the
        employee themselves, not the internal AM/HR/Leadership
        distribution — per the designed exit flow: at resignation/layoff,
        the employee is sent an intimation of their Last Working Day.
        Sent as its own single-recipient email rather than folded into
        the standard recipients pattern, since an employee should never
        end up on the same distribution list used for internal process
        copies (they're the subject of those emails, not a recipient).
        """
        subject = "Confirmation of Your Last Working Day"
        html = f"""
        <h2>Last Working Day Confirmation</h2>
        <p>Dear {employee_name},</p>
        <p>This is to confirm your Last Working Day as <b>{last_working_day}</b>.</p>
        <p>Please coordinate with your reporting manager and HR for a smooth handover
           and clearance process.</p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated notification from your employer's HR Portal.
        </p>
        """
        return self.send(
            tenant_id, candidate_id, "lwd_set",
            recipients=[{"email": employee_email, "name": employee_name, "role": "employee"}],
            subject=subject, html_body=html,
        )

    def notify_archive_ready(
        self,
        tenant_id: UUID,
        hr_recipients: list[dict],
        financial_year: str,
        location_name: str,
        document_count: int,
        portal_url: str,
    ) -> bool:
        """
        HR gets notified when a location's yearly document backup is
        ready — pointing them to the portal to download it, not
        attaching the zip directly to the email (a year's worth of
        documents across a location's candidates could easily exceed
        typical email attachment size limits).
        """
        subject = f"Document Archive Ready — FY {financial_year} ({location_name})"
        html = f"""
        <h2>Yearly Document Archive Ready</h2>
        <p>A backup of {document_count} document(s) submitted during FY {financial_year}
           at <b>{location_name}</b> is ready to download.</p>
        <p>This is a backup copy only — the original documents remain individually
           available in each candidate's record as before.</p>
        <p><a href="{portal_url}">Download from Portal →</a></p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated notification from the iBridge HR Portal.
        </p>
        """
        return self.send(
            tenant_id, None, "archive_ready", hr_recipients, subject, html,
        )

    def notify_doj_reminder(
        self,
        tenant_id: UUID,
        candidate_id: UUID,
        hr_recipients: list[dict],
        candidate_name: str,
        client_name: str,
        doj: str,
        portal_url: str,
    ) -> bool:
        subject = f"Joining Today — {candidate_name} ({client_name})"
        html = f"""
        <h2>Candidate Joining Today</h2>
        <p><b>{candidate_name}</b> from <b>{client_name}</b> is scheduled to join today
           ({doj}).</p>
        <p>Please confirm joining and assign an Employee ID from the portal.</p>
        <p><a href="{portal_url}">Open in Portal →</a></p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated notification from the iBridge HR Portal.
        </p>
        """
        return self.send(
            tenant_id, candidate_id, "doj_reminder", hr_recipients, subject, html
        )

    def notify_relieving_due(
        self,
        tenant_id: UUID,
        candidate_id: UUID,
        hr_recipients: list[dict],
        candidate_name: str,
        employee_id: str,
        last_working_day: str,
        portal_url: str,
    ) -> bool:
        subject = f"Action Required: Relieving Letter Due — {candidate_name}"
        html = f"""
        <h2>Relieving Letter Due</h2>
        <p>It has been 20 days since <b>{candidate_name}</b> ({employee_id})'s
           last working day ({last_working_day}).</p>
        <p>If client clearance has been received, please release the relieving letter.</p>
        <p><a href="{portal_url}">Open in Portal →</a></p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated reminder from the iBridge HR Portal.
        </p>
        """
        return self.send(
            tenant_id, candidate_id, "relieving_due_reminder", hr_recipients, subject, html
        )

    def notify_offer_rejected(
        self,
        tenant_id: UUID,
        candidate_id: UUID,
        recipients: list[dict],
        candidate_name: str,
        candidate_email: str | None,
        reason: str | None,
        portal_url: str,
        notify_candidate: bool = False,
    ) -> bool:
        """
        The internal distribution (AM/HR/Leadership) is always notified
        when an offer is rejected/revoked — this is genuinely new
        information for them, unlike a release action they already
        triggered themselves. Notifying the candidate is optional and
        off by default: a rejection often means the candidate declined
        it themselves (they already know), so an automatic email in
        that case would be redundant or even confusing. Set
        notify_candidate=True only when the company is the one revoking
        an offer the candidate hasn't yet responded to either way.
        """
        reason_line = f"<p><b>Reason:</b> {reason}</p>" if reason else ""

        internal_subject = f"Offer Rejected — {candidate_name}"
        internal_html = f"""
        <h2>Offer Rejected</h2>
        <p>The offer for <b>{candidate_name}</b> has been marked as rejected.</p>
        {reason_line}
        <p><a href="{portal_url}">View Record →</a></p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated notification from the iBridge HR Portal.
        </p>
        """
        internal_sent = self.send(
            tenant_id, candidate_id, "offer_rejected", recipients, internal_subject, internal_html,
        )

        if not notify_candidate or not candidate_email:
            return internal_sent

        candidate_subject = "Update on Your Offer"
        candidate_html = f"""
        <p>Dear {candidate_name},</p>
        <p>We're writing to let you know that your offer has been withdrawn.</p>
        <p>If you have any questions, please reach out to your point of contact.</p>
        <p>Warm regards,<br>HR Team</p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated notification from the iBridge HR Portal.
        </p>
        """
        candidate_sent = self.send(
            tenant_id, candidate_id, "offer_rejected_candidate", recipients, candidate_subject, candidate_html,
            to_override=candidate_email,
        )
        return internal_sent and candidate_sent

    def notify_document_link_resent(
        self, tenant_id: UUID, candidate_id: UUID, candidate_name: str,
        candidate_email: str, document_link: str,
    ) -> bool:
        """A standalone reminder — just the link, not bundled with a
        letter — for when the original link expired, got lost, or (per
        a real bug found and fixed earlier) never actually reached the
        candidate in the first place."""
        subject = "Reminder: Submit Your Documents"
        html = f"""
        <p>Dear {candidate_name},</p>
        <p>This is a reminder to submit your documents and personal details using the link below:</p>
        <p><a href="{document_link}" style="font-weight:bold;">{document_link}</a></p>
        <p>If you have any questions, please reach out to your point of contact.</p>
        <p>Warm regards,<br>HR Team</p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated notification from the iBridge HR Portal.
        </p>
        """
        return self.send(
            tenant_id, candidate_id, "documents_link_resent", [], subject, html,
            to_override=candidate_email,
        )

    def send_am_verification_code(
        self, tenant_id: UUID, account_manager_id: UUID, am_email: str, am_name: str, code: str,
    ) -> bool:
        """
        Sends the one-time code proving whoever is filling out the public
        offer-request form actually has access to this Account Manager's
        own registered email — not shown anywhere in the app itself, only
        delivered here.
        """
        subject = "Your verification code"
        html = f"""
        <p>Hi {am_name},</p>
        <p>Your verification code is:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:4px;">{code}</p>
        <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
        <hr><p style="color:#888;font-size:12px;">
        This is an automated notification from the iBridge HR Portal.
        </p>
        """
        return self.send(
            tenant_id, None, "am_verification_code_sent", [{"email": am_email, "name": am_name}],
            subject, html,
        )
