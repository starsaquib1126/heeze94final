"""
Current-user endpoint.

Every authenticated frontend session calls GET /api/v1/me right after
login to learn who it's talking to — role, tenant, location — since the
Supabase JWT itself only proves identity, not what this app's data model
says about that identity (which the frontend needs to decide what to
render).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.auth import CurrentUser
from app.models.user import UserProfile

router = APIRouter(tags=["me"])


@router.get("/me", response_model=UserProfile)
def get_my_profile(user: CurrentUser) -> UserProfile:
    """`user` is already the full profile record — `get_current_user()`
    loads it straight from the database, so there's nothing to transform."""
    return user
