-- Run after 017_referral_codes.sql.

create table if not exists product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id text not null, -- matches the product's slug/id used across the site (e.g. 'black-oud')
  customer_email text not null,
  customer_name text,
  rating int not null check (rating between 1 and 5),
  comment text,
  verified_purchase boolean default false,
  approved boolean default true, -- auto-approved for now; flip to false here if you want to moderate before publishing
  created_at timestamptz default now()
);

create index if not exists idx_product_reviews_product on product_reviews(product_id) where approved = true;

alter table product_reviews enable row level security;
-- Reviews ARE meant to be publicly readable (unlike promo_codes/stock_notifications) —
-- but only ever WRITTEN via the API using the service role key, never directly from
-- the browser, so there's no public insert policy.
create policy "Public can read approved reviews" on product_reviews
  for select using (approved = true);
