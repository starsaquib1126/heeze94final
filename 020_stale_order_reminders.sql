-- Run after 019_cron_reminder_flags.sql.
-- Tracks the last time the owner was emailed a "please update this order's
-- status" reminder, so the existing cron can space repeat reminders 24h apart
-- instead of re-sending on every run.

alter table orders add column if not exists last_status_reminder_sent_at timestamptz;
