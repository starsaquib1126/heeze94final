-- Run after 023_pause_us_uae_delivery.sql.
-- A real Postgres sequence guarantees each invoice number is unique and
-- strictly increasing even if multiple orders are invoiced at the same
-- moment -- required for a valid GST "consecutive serial number".

create sequence if not exists gst_invoice_seq start 1;

-- Supabase's client can only call sequences through an RPC-exposed function,
-- not nextval() directly.
create or replace function nextval_gst_invoice()
returns bigint
language sql
as $$
  select nextval('gst_invoice_seq');
$$;

alter table orders add column if not exists invoice_number text;
alter table orders add column if not exists invoice_sent_at timestamptz;
