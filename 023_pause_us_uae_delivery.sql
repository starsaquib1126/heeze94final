-- Run after 022_shipping_fees.sql.
-- Temporarily pausing orders to US and UAE -- browsing stays open, but
-- checkout is blocked for these countries (create-order.js already checks
-- this table and rejects with "We currently don't deliver to this location").

update delivery_countries set active = false where country_code in ('US', 'AE');
