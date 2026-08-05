-- Run after 018_product_reviews.sql.
-- Both features reuse the EXISTING orders table and the EXISTING cron endpoint
-- (check-status-updates.js) — no new table, no new serverless function.

alter table orders add column if not exists abandoned_email_sent boolean default false;
alter table orders add column if not exists refill_reminder_sent boolean default false;
