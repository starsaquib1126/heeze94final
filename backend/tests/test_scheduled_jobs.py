"""
Tests for the scheduled jobs (Milestone 8): the DOJ reminder and the
20-day relieving reminder, plus the scheduler wiring itself.

The scheduler test uses TestClient's `with` context, which actually
exercises the FastAPI lifespan startup/shutdown — a plain import check
would NOT catch a broken job registration, since scheduler.add_job()
only runs inside the lifespan context manager, not at module import time.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app, scheduler
from app.services.scheduled_jobs import run_doj_reminders, run_relieving_reminders


def test_scheduler_starts_and_registers_both_jobs() -> None:
    with TestClient(app):
        assert scheduler.running is True
        job_ids = {job.id for job in scheduler.get_jobs()}
        assert "doj_reminders" in job_ids
        assert "relieving_reminders" in job_ids
    assert scheduler.running is False


def test_doj_reminder_job_iterates_every_active_tenant() -> None:
    tenant_a, tenant_b = uuid4(), uuid4()

    with patch("app.services.scheduled_jobs.get_service_db") as mock_get_db, \
         patch("app.services.scheduled_jobs.CandidateService") as MockCandidateService, \
         patch("app.services.scheduled_jobs.DirectoryService"), \
         patch("app.services.scheduled_jobs.EmailService") as MockEmailService, \
         patch("app.services.scheduled_jobs.UserService"):

        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": str(tenant_a)}, {"id": str(tenant_b)},
        ]
        MockCandidateService.return_value.get_joining_today.return_value = []

        run_doj_reminders()

        # Must have checked BOTH tenants independently, not just the first.
        calls = MockCandidateService.return_value.get_joining_today.call_args_list
        checked_tenants = {c.args[0] for c in calls}
        assert checked_tenants == {tenant_a, tenant_b}


def test_doj_reminder_job_sends_for_each_candidate_joining_today() -> None:
    tenant_id = uuid4()
    candidate = MagicMock()
    candidate.id = uuid4()
    candidate.location_id = uuid4()
    candidate.account_manager_id = None
    candidate.full_name = "Test Candidate"
    candidate.client_name = "Test Client"
    candidate.expected_doj = "2026-08-13"

    with patch("app.services.scheduled_jobs.get_service_db") as mock_get_db, \
         patch("app.services.scheduled_jobs.CandidateService") as MockCandidateService, \
         patch("app.services.scheduled_jobs.DirectoryService") as MockDirectoryService, \
         patch("app.services.scheduled_jobs.EmailService") as MockEmailService, \
         patch("app.services.scheduled_jobs.UserService"), \
         patch("app.services.scheduled_jobs._hr_email_for_location", return_value="hr@test.com"):

        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": str(tenant_id)}
        ]
        MockCandidateService.return_value.get_joining_today.return_value = [candidate]
        MockDirectoryService.return_value.get_notification_recipients.return_value = []
        MockEmailService.return_value.notify_doj_reminder.return_value = True

        sent = run_doj_reminders()

        assert sent == 1
        MockEmailService.return_value.notify_doj_reminder.assert_called_once()
        call_kwargs = MockEmailService.return_value.notify_doj_reminder.call_args.kwargs
        assert call_kwargs["candidate_id"] == candidate.id


def test_relieving_reminder_job_sends_for_each_pending_candidate() -> None:
    tenant_id = uuid4()
    candidate = MagicMock()
    candidate.id = uuid4()
    candidate.location_id = uuid4()
    candidate.account_manager_id = None
    candidate.full_name = "Test Employee"
    candidate.employee_id = "IB-NOI-1042"
    candidate.last_working_day = "2026-07-01"

    with patch("app.services.scheduled_jobs.get_service_db") as mock_get_db, \
         patch("app.services.scheduled_jobs.CandidateService") as MockCandidateService, \
         patch("app.services.scheduled_jobs.DirectoryService") as MockDirectoryService, \
         patch("app.services.scheduled_jobs.EmailService") as MockEmailService, \
         patch("app.services.scheduled_jobs.UserService"), \
         patch("app.services.scheduled_jobs._hr_email_for_location", return_value="hr@test.com"):

        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": str(tenant_id)}
        ]
        MockCandidateService.return_value.get_pending_relieving_reminders.return_value = [candidate]
        MockDirectoryService.return_value.get_notification_recipients.return_value = []
        MockEmailService.return_value.notify_relieving_due.return_value = True

        sent = run_relieving_reminders()

        assert sent == 1
        MockCandidateService.return_value.get_pending_relieving_reminders.assert_called_once_with(
            tenant_id, reminder_days=20
        )
        MockEmailService.return_value.notify_relieving_due.assert_called_once()


def test_reminder_jobs_never_raise_even_if_email_sending_fails() -> None:
    """A single failed send must not crash the whole job — other
    tenants'/candidates' reminders still need to go out."""
    tenant_id = uuid4()
    candidate = MagicMock()
    candidate.id = uuid4()
    candidate.location_id = uuid4()
    candidate.account_manager_id = None
    candidate.full_name = "Test"
    candidate.client_name = "Test Client"
    candidate.expected_doj = "2026-08-13"

    with patch("app.services.scheduled_jobs.get_service_db") as mock_get_db, \
         patch("app.services.scheduled_jobs.CandidateService") as MockCandidateService, \
         patch("app.services.scheduled_jobs.DirectoryService") as MockDirectoryService, \
         patch("app.services.scheduled_jobs.EmailService") as MockEmailService, \
         patch("app.services.scheduled_jobs.UserService"), \
         patch("app.services.scheduled_jobs._hr_email_for_location", return_value="hr@test.com"):

        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": str(tenant_id)}
        ]
        MockCandidateService.return_value.get_joining_today.return_value = [candidate]
        MockDirectoryService.return_value.get_notification_recipients.return_value = []
        MockEmailService.return_value.notify_doj_reminder.return_value = False  # simulated failure

        sent = run_doj_reminders()
        assert sent == 0  # failure counted correctly, no exception raised


def test_yearly_archive_job_registered_in_scheduler() -> None:
    with TestClient(app):
        job_ids = {job.id for job in scheduler.get_jobs()}
        assert "yearly_archive" in job_ids


def test_yearly_archive_is_a_noop_on_any_day_other_than_april_1st() -> None:
    """The job runs daily but must only actually do anything on April 1st
    — every other day of the year it should return immediately without
    touching the database at all."""
    from datetime import date
    from unittest.mock import patch

    from app.services.scheduled_jobs import run_yearly_archive

    with patch("app.services.scheduled_jobs.date") as mock_date, \
         patch("app.services.scheduled_jobs.get_service_db") as mock_get_db:
        mock_date.today.return_value = date(2026, 6, 15)  # any non-April-1st date
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)

        result = run_yearly_archive()

        assert result == 0
        mock_get_db.assert_not_called()


def test_yearly_archive_runs_on_april_1st_and_iterates_locations() -> None:
    from datetime import date
    from unittest.mock import MagicMock, patch

    from app.services.scheduled_jobs import run_yearly_archive

    tenant_id = uuid4()
    location_id = uuid4()

    with patch("app.services.scheduled_jobs.date") as mock_date, \
         patch("app.services.scheduled_jobs.get_service_db") as mock_get_db, \
         patch("app.services.scheduled_jobs.DirectoryService") as MockDirectoryService, \
         patch("app.services.scheduled_jobs.EmailService") as MockEmailService, \
         patch("app.services.scheduled_jobs._hr_email_for_location", return_value="hr@test.com"), \
         patch("app.services.document_service.get_service_db"), \
         patch("app.services.document_service.DocumentService.generate_yearly_archive") as mock_generate:

        mock_date.today.return_value = date(2027, 4, 1)

        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        # First call: active tenants. Second call: locations for that tenant.
        # Third call: document count for the notification.
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": str(tenant_id)}
        ]
        mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"id": str(location_id), "name": "Noida"}
        ]
        mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value.count = 5

        mock_generate.return_value = f"{tenant_id}/archives/{location_id}/2026-27_20270401.zip"
        MockDirectoryService.return_value.get_notification_recipients.return_value = []
        MockEmailService.return_value.notify_archive_ready.return_value = True

        sent = run_yearly_archive()

        assert sent == 1
        mock_generate.assert_called_once()
        call_args = mock_generate.call_args.args
        assert call_args[0] == tenant_id
        assert call_args[1] == location_id
        assert call_args[2] == "2026-27"  # the FY that just ended
