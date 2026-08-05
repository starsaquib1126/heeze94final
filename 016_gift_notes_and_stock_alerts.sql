-- Run this in Supabase's SQL Editor (after all previous numbered migrations).
-- Two independent additions, safe to run together:

-- 1) Gift note support on orders
alter table orders add column if not exists gift_note text;
alter table orders add column if not exists is_gift boolean default false;

-- 2) "Notify me when back in stock" signups
create table if not exists stock_notifications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  product_variant_id uuid references product_variants(id) on delete cascade,
  created_at timestamptz default now(),
  notified_at timestamptz, -- set once we've emailed them; null = still waiting
  unique(email, product_variant_id)
);

alter table stock_notifications enable row level security;
-- No public read policy on purpose — this table is only ever written to (via the API,
-- using the service role key) and read by the notification cron job, never by the browser directly.
