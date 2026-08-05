-- Run after 016_gift_notes_and_stock_alerts.sql.
-- Adds referral-code support by extending the EXISTING promo_codes table
-- rather than creating a new one — a referral code IS a promo code, just
-- one that's owned by a specific customer instead of being a site-wide code.

alter table promo_codes add column if not exists owner_customer_id uuid references customers(id) on delete set null;
alter table promo_codes add column if not exists is_referral boolean default false;

-- Fast lookup: "does this customer already have a referral code?"
create index if not exists idx_promo_codes_owner on promo_codes(owner_customer_id) where is_referral = true;
