"""
Pytest configuration.

Sets fake-but-valid-shaped environment variables before any test
imports `app.core.config` (which requires them at import time via
pydantic-settings) — this lets the whole test suite run with zero
external services, using mocks for anything that would otherwise hit
Supabase or Resend.
"""

import os

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test_anon_key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test_service_key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test_jwt_secret_at_least_32_characters_long")
os.environ.setdefault("RESEND_API_KEY", "test_resend_key")
os.environ.setdefault("PLATFORM_OWNER_KEY", "test_platform_key_for_pytest")
