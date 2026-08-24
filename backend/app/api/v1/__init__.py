"""Central API router — registers all endpoint groups under /api/v1."""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    admin, candidates, ctc_structures, letter_templates, me, platform, public,
)

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(platform.router)
api_router.include_router(admin.router)
api_router.include_router(public.router)
api_router.include_router(me.router)
api_router.include_router(candidates.router)
api_router.include_router(ctc_structures.router)
api_router.include_router(letter_templates.router)
