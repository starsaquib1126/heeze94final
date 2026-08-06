-- Run after 021_order_delay_flag.sql.

-- Add a shipping fee column to delivery_countries, and set the actual rates.
alter table delivery_countries add column if not exists shipping_fee numeric default 0;

update delivery_countries set shipping_fee = 0   where country_code = 'IN';
update delivery_countries set shipping_fee = 500 where country_code = 'AE';
update delivery_countries set shipping_fee = 500 where country_code = 'US';

-- Store the shipping fee actually charged on each order (so historical orders
-- keep the fee that applied at the time, even if rates change later).
alter table orders add column if not exists shipping_fee numeric default 0;
