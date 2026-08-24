"""
Regression test for a real bug found in production: a document-upload
token was correctly generated and marked as "sent" (documents_link_sent_at
set, a documents_link_sent event logged) right after releasing an
Appointment Letter — but the actual link was never included in the
email itself. The candidate received their letter with no indication
they needed to submit documents, let alone a way to do it. The
generated link variable existed in the endpoint but was silently never
passed through to the email template.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.services.email_service import EmailService


def _service() -> EmailService:
    svc = EmailService.__new__(EmailService)
    svc._from = "HR Portal <test@example.com>"
    svc._log = MagicMock()
    return svc


def test_document_link_appears_in_the_actual_email_body() -> None:
    svc = _service()
    link = "https://frontend.test/documents/realtoken123"

    with patch("app.services.email_service.resend") as mock_resend:
        svc.notify_appointment_released(
            tenant_id=uuid4(), candidate_id=uuid4(),
            recipients=[{"email": "hr@test.com"}],
            candidate_name="Priya", candidate_email="priya@test.com",
            employee_id="IB-1042", client_name="Deloitte USI",
            portal_url="https://x.test/recruitment/123",
            document_link=link,
        )
        payload = mock_resend.Emails.send.call_args.args[0]
        assert link in payload["html"]


def test_email_still_sends_cleanly_when_document_link_is_omitted() -> None:
    """Backward compatibility: any future caller that doesn't pass
    document_link (or genuinely has none to send) must not crash or
    leave a broken/empty link in the email."""
    svc = _service()

    with patch("app.services.email_service.resend") as mock_resend:
        svc.notify_appointment_released(
            tenant_id=uuid4(), candidate_id=uuid4(),
            recipients=[{"email": "hr@test.com"}],
            candidate_name="Priya", candidate_email="priya@test.com",
            employee_id="IB-1042", client_name="Deloitte USI",
            portal_url="https://x.test/recruitment/123",
        )
        payload = mock_resend.Emails.send.call_args.args[0]
        assert "None" not in payload["html"]
