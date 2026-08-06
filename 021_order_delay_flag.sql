-- Run after 020_stale_order_reminders.sql.
-- Lets the admin flag an order as delayed with a note and a revised delivery
-- estimate, shown as a banner on the customer-facing tracking timeline
-- WITHOUT changing the order's real status (an order can be "shipped" AND
-- "delayed" at the same time -- these are independent).

alter table orders add column if not exists is_delayed boolean default false;
alter table orders add column if not exists delay_note text;
alter table orders add column if not exists delayed_until date;
