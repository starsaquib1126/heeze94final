"""
Tenant Provisioning Service.

This is the Platform Owner's (Saquib's) exclusive domain — he creates
a tenant, it becomes a live client. He disables one, the whole company's
access stops. No client data is ever read or returned here, just the
provisioning record itself.
"""

from __future__ import annotations

import re
from uuid import UUID

from app.db.client import get_service_db
from app.models.user import Tenant, TenantCreate


def _validate_slug(slug: str) -> None:
    if not re.match(r"^[a-z0-9-]{2,40}$", slug):
        raise ValueError(
            "Slug must be 2–40 characters, lowercase letters, digits and hyphens only"
        )


class TenantService:
    def __init__(self) -> None:
        self._db = get_service_db()

    def create(self, data: TenantCreate) -> Tenant:
        _validate_slug(data.slug)

        # Check slug uniqueness
        existing = (
            self._db.table("tenants")
            .select("id")
            .eq("slug", data.slug)
            .execute()
        )
        if existing.data:
            raise ValueError(f"Slug '{data.slug}' is already taken")

        result = (
            self._db.table("tenants")
            .insert(data.model_dump())
            .execute()
        )
        tenant = Tenant(**result.data[0])

        # Seed the employee ID sequence for this tenant
        self._db.table("employee_id_sequences").insert(
            {"tenant_id": str(tenant.id), "last_number": 1000}
        ).execute()

        return tenant

    def list_all(self) -> list[Tenant]:
        result = (
            self._db.table("tenants")
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )
        return [Tenant(**row) for row in result.data]

    def set_active(self, tenant_id: UUID, is_active: bool) -> Tenant:
        result = (
            self._db.table("tenants")
            .update({"is_active": is_active})
            .eq("id", str(tenant_id))
            .execute()
        )
        if not result.data:
            raise ValueError(f"Tenant {tenant_id} not found")
        return Tenant(**result.data[0])

    def get(self, tenant_id: UUID) -> Tenant:
        result = (
            self._db.table("tenants")
            .select("*")
            .eq("id", str(tenant_id))
            .single()
            .execute()
        )
        if not result.data:
            raise ValueError(f"Tenant {tenant_id} not found")
        return Tenant(**result.data)
