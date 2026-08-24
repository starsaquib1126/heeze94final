"""
Platform Owner: Tenant provisioning endpoints.

These routes are ONLY for Saquib — the platform owner.
They're protected by a separate PLATFORM_OWNER_KEY header
(not a Supabase JWT) since the platform owner doesn't have a tenant
to belong to, and Supabase's RLS model doesn't cover this layer.

In production, access to /api/platform/* should be further restricted
at the infrastructure level (Render's IP allow-list or a VPN).
"""

from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.models.user import (
    Tenant,
    TenantCreate,
    UserProfile,
    UserProfileCreate,
)
from app.services.tenant_service import TenantService
from app.services.user_service import UserService

router = APIRouter(prefix="/platform", tags=["platform"])


def verify_platform_key(x_platform_key: str = Header(...)) -> None:
    """
    Pre-shared key guard for the platform-owner endpoints. Not a JWT —
    the platform owner doesn't belong to any tenant, so Supabase auth
    doesn't apply here.

    CRITICAL: every route in this file must declare
    `Depends(verify_platform_key)` — FastAPI does not apply dependencies
    automatically just because they're defined in the same module.
    """
    expected = os.getenv("PLATFORM_OWNER_KEY", "")
    if not expected or x_platform_key != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid platform key",
        )


@router.post("/tenants", response_model=Tenant, status_code=201)
def create_tenant(
    data: TenantCreate,
    _: None = Depends(verify_platform_key),
) -> Tenant:
    """Create a new client company (tenant) on the platform."""
    try:
        return TenantService().create(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/tenants", response_model=list[Tenant])
def list_tenants(_: None = Depends(verify_platform_key)) -> list[Tenant]:
    return TenantService().list_all()


@router.patch("/tenants/{tenant_id}/activate", response_model=Tenant)
def activate_tenant(tenant_id: UUID, _: None = Depends(verify_platform_key)) -> Tenant:
    return TenantService().set_active(tenant_id, True)


@router.patch("/tenants/{tenant_id}/suspend", response_model=Tenant)
def suspend_tenant(tenant_id: UUID, _: None = Depends(verify_platform_key)) -> Tenant:
    """Suspends access — all that tenant's HR users can no longer log in."""
    return TenantService().set_active(tenant_id, False)


@router.post("/tenants/{tenant_id}/super-user", response_model=UserProfile, status_code=201)
def create_super_user(
    tenant_id: UUID,
    data: UserProfileCreate,
    _: None = Depends(verify_platform_key),
) -> UserProfile:
    """
    Create the initial Super User for a new tenant.
    This is the only time the Platform Owner touches inside a tenant.
    """
    data.tenant_id = tenant_id
    data.role = "super_user"
    data.location_id = None   # Super Users are not scoped to a location
    try:
        return UserService().create_user(data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

