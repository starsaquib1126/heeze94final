"""
Database clients.

Two clients, two purposes:
  - `get_db()` — uses the anon key + the user's JWT, so Supabase's Row
    Level Security policies enforce tenant isolation automatically.
    Use this for every request that comes from a logged-in HR user.
  - `get_service_db()` — uses the service key, bypasses RLS completely.
    Use ONLY for:
      • Platform Owner provisioning new tenants (no JWT yet)
      • The public AM offer-request form (no JWT)
      • Scheduled jobs (cron, reminders)
      • Atomic employee ID increment (needs to touch sequences table
        from a context that doesn't carry a user JWT)
    Never call this from a route that receives user input without
    first validating the user's identity separately.
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache()
def get_service_db() -> Client:
    """Service-role client — bypasses RLS. Use sparingly."""
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_key)


def get_user_db(jwt: str) -> Client:
    """
    Anon-key client with the user's JWT injected so Supabase enforces
    RLS policies. A new client instance per request — not cached, since
    each request carries a different JWT.
    """
    s = get_settings()
    client = create_client(s.supabase_url, s.supabase_anon_key)
    client.auth.set_session(jwt, "")
    return client


def safe_data(result) -> dict | None:
    """
    Safely extract `.data` from a `.maybe_single().execute()` result.

    On the library version actually deployed, that call returns `None`
    outright (not an object with `.data = None`) when zero rows match —
    hit twice in production as a real AttributeError crash (branding
    lookup for a tenant that had never uploaded a logo, letter
    generation's own branding check) before this became a shared,
    audited helper instead of a pattern repeated inline 36 times across
    9 files with no guarantee every copy actually guarded against it.
    Every `.maybe_single()` call site in this codebase should route
    through this function rather than reading `.data` directly.
    """
    return result.data if result is not None else None
