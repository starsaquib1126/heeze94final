-- 015: Status-change notification tracking (polling-based, no Supabase
-- webhooks needed)
--
-- Your Supabase project doesn't have the `supabase_functions` schema
-- provisioned, so native Database Webhooks aren't available. Instead of
-- fighting that, this uses a much simpler, fully reliable approach: a
-- "needs notification" flag that flips on whenever status changes, checked
-- every few minutes by a free external scheduler calling our own backend.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS notification_sent boolean DEFAULT true;
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS notification_sent boolean DEFAULT true;

-- Plain Postgres triggers — no supabase_functions dependency at all, so
-- these work regardless of the schema issue above.
CREATE OR REPLACE FUNCTION mark_needs_notification()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.notification_sent := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_notify_on_status_change ON orders;
CREATE TRIGGER orders_notify_on_status_change
BEFORE UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION mark_needs_notification();

DROP TRIGGER IF EXISTS returns_notify_on_status_change ON return_requests;
CREATE TRIGGER returns_notify_on_status_change
BEFORE UPDATE ON return_requests
FOR EACH ROW
EXECUTE FUNCTION mark_needs_notification();

-- HOW THIS WORKS NOW:
-- 1. You change an order or return request's status in Supabase, as before.
-- 2. This trigger silently flags it as "needs notification".
-- 3. A free external scheduler (set up separately — see the accompanying
--    guide) calls your website every few minutes to check for anything
--    flagged, sends the right email, and clears the flag.
-- Emails now arrive within a few minutes of your update, rather than
-- instantly — but reliably, and without depending on the missing Supabase
-- feature or paying for a faster Vercel plan.

