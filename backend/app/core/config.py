"""
Application configuration.

All secrets come from environment variables — never hardcoded.
On Render: set these in the Environment tab.
Locally:   copy .env.example to .env and fill in your Supabase project values.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # ------------------------------------------------------------------ #
    # Supabase
    # ------------------------------------------------------------------ #
    supabase_url: str
    supabase_anon_key: str          # safe to expose to browser
    supabase_service_key: str       # never sent to browser — used server-side only

    # ------------------------------------------------------------------ #
    # JWT (Supabase signs with this — we verify it on every request)
    # ------------------------------------------------------------------ #
    supabase_jwt_secret: str

    # ------------------------------------------------------------------ #
    # Email (Resend)
    # ------------------------------------------------------------------ #
    resend_api_key: str
    email_from: str = "hr-portal@ibridgetechsoft.com"
    email_from_name: str = "iBridge HR Portal"

    # ------------------------------------------------------------------ #
    # Document storage
    # ------------------------------------------------------------------ #
    storage_bucket: str = "hr-documents"

    # ------------------------------------------------------------------ #
    # App
    # ------------------------------------------------------------------ #
    app_name: str = "IBridge HR Portal"
    app_base_url: str = "https://ibridge-hr.onrender.com"
    debug: bool = False
    # When true, the AM verification code is returned directly in the API
    # response instead of being emailed — ONLY that one flow, nothing
    # else. Exists because real email sending isn't fully configured yet
    # (still using Resend's test address, not a verified domain) and this
    # unblocks testing/demoing the verification feature in the meantime.
    # Turn this off (or remove the env var) once real email works —
    # leaving it on in production would defeat the entire point of email
    # verification, since anyone could see the code without owning that
    # inbox.
    demo_mode: bool = False
    allowed_origins: list[str] = [
        "https://ibridge-hr.onrender.com",
        "http://localhost:5173",   # Vite dev server
    ]

    # ------------------------------------------------------------------ #
    # Scheduled jobs
    # ------------------------------------------------------------------ #
    # How many days after LWD the relieving-letter reminder fires
    relieving_reminder_days: int = 20
    # Days before DOJ to surface in "upcoming joinings" dashboard section
    upcoming_doj_lookahead_days: int = 7

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache()
def get_settings() -> Settings:
    return Settings()
