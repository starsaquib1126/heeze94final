"""
IBridge HR Portal — FastAPI Application.

Entry point for Render deployment.
Start locally with:  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.core.config import get_settings

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def _run_doj_reminders_job() -> None:
    from app.services.scheduled_jobs import run_doj_reminders
    try:
        run_doj_reminders()
    except Exception:
        logger.exception("DOJ reminder job failed")


def _run_relieving_reminders_job() -> None:
    from app.services.scheduled_jobs import run_relieving_reminders
    try:
        run_relieving_reminders()
    except Exception:
        logger.exception("Relieving reminder job failed")


def _run_yearly_archive_job() -> None:
    from app.services.scheduled_jobs import run_yearly_archive
    try:
        run_yearly_archive()
    except Exception:
        logger.exception("Yearly archive job failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: verify Supabase connectivity
    s = get_settings()
    from app.db.client import get_service_db
    try:
        get_service_db().table("tenants").select("id").limit(1).execute()
    except Exception as exc:
        logging.critical("Database connectivity check failed at startup: %s", exc)

    # Both jobs run once daily at 8:00 AM server time — early enough that
    # HR sees the DOJ reminder before a candidate is expected to actually
    # show up, and consistent for the relieving reminder regardless of
    # what time a given candidate happened to cross the 20-day mark.
    scheduler.add_job(_run_doj_reminders_job, CronTrigger(hour=8, minute=0), id="doj_reminders")
    scheduler.add_job(_run_relieving_reminders_job, CronTrigger(hour=8, minute=5), id="relieving_reminders")
    # Checked daily (not a once-a-year trigger) — see run_yearly_archive's
    # own docstring for why a daily no-op check is more resilient than a
    # once-a-year cron that silently never fires again if ever missed.
    scheduler.add_job(_run_yearly_archive_job, CronTrigger(hour=8, minute=10), id="yearly_archive")
    scheduler.start()

    yield

    scheduler.shutdown(wait=False)


def create_app() -> FastAPI:
    s = get_settings()

    app = FastAPI(
        title="IBridge HR Portal API",
        description="Multi-tenant HR management platform",
        version="1.0.0",
        docs_url="/docs" if s.debug else None,   # disable Swagger in production
        redoc_url=None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)

    @app.get("/health", tags=["health"])
    def health_check() -> dict:
        return {"status": "ok", "version": "1.0.0"}

    return app


app = create_app()
