"""
Directory Service.

Manages the routing directory — the single source of truth for:
  - Which client → which location/HR
  - Account Managers (who use the public offer-request link)
  - Recruiters (dropdown for AMs, incentive tracking only)
  - Leadership (who gets CC'd on every communication)

All methods are tenant-scoped. The routing logic is also here —
given a client name from an AM's form, resolve to a location.
"""

from __future__ import annotations

from uuid import UUID

from app.db.client import get_service_db, safe_data
from app.models.user import (
    AccountManager,
    AccountManagerCreate,
    DirectoryClient,
    DirectoryClientCreate,
    Leadership,
    LeadershipCreate,
    Location,
    LocationCreate,
    Recruiter,
    RecruiterCreate,
)


class DirectoryService:
    def __init__(self) -> None:
        self._db = get_service_db()

    # ------------------------------------------------------------------ #
    # Locations
    # ------------------------------------------------------------------ #
    def create_location(self, tenant_id: UUID, data: LocationCreate) -> Location:
        result = (
            self._db.table("locations")
            .insert({"tenant_id": str(tenant_id), **data.model_dump(mode="json")})
            .execute()
        )
        return Location(**result.data[0])

    def list_locations(self, tenant_id: UUID) -> list[Location]:
        result = (
            self._db.table("locations")
            .select("*")
            .eq("tenant_id", str(tenant_id))
            .eq("is_active", True)
            .order("name")
            .execute()
        )
        return [Location(**row) for row in result.data]

    # ------------------------------------------------------------------ #
    # Client → Location routing
    # ------------------------------------------------------------------ #
    def create_client_mapping(
        self, tenant_id: UUID, data: DirectoryClientCreate
    ) -> DirectoryClient:
        result = (
            self._db.table("directory_clients")
            .insert({"tenant_id": str(tenant_id), **data.model_dump(mode="json")})
            .execute()
        )
        return DirectoryClient(**result.data[0])

    def list_client_mappings(self, tenant_id: UUID) -> list[DirectoryClient]:
        result = (
            self._db.table("directory_clients")
            .select("*")
            .eq("tenant_id", str(tenant_id))
            .eq("is_active", True)
            .order("client_name")
            .execute()
        )
        return [DirectoryClient(**row) for row in result.data]

    def resolve_client(
        self, tenant_id: UUID, client_name: str
    ) -> Location | None:
        """
        Given a client name from the AM's form, return the routed location.
        Returns None when the client isn't in the directory — the caller
        should then fall back to asking the AM to pick an HR from a dropdown.
        """
        mapping = (
            self._db.table("directory_clients")
            .select("location_id")
            .eq("tenant_id", str(tenant_id))
            .ilike("client_name", client_name.strip())  # case-insensitive match
            .eq("is_active", True)
            .maybe_single()
            .execute()
        )
        mapping_data = safe_data(mapping)
        if not mapping_data:
            return None

        location = (
            self._db.table("locations")
            .select("*")
            .eq("id", mapping_data["location_id"])
            .maybe_single()
            .execute()
        )
        location_data = safe_data(location)
        return Location(**location_data) if location_data else None

    # ------------------------------------------------------------------ #
    # Account Managers
    # ------------------------------------------------------------------ #
    def create_account_manager(
        self, tenant_id: UUID, data: AccountManagerCreate
    ) -> AccountManager:
        result = (
            self._db.table("directory_account_managers")
            .insert({"tenant_id": str(tenant_id), **data.model_dump(mode="json")})
            .execute()
        )
        return AccountManager(**result.data[0])

    def list_account_managers(self, tenant_id: UUID) -> list[AccountManager]:
        result = (
            self._db.table("directory_account_managers")
            .select("*")
            .eq("tenant_id", str(tenant_id))
            .eq("is_active", True)
            .order("full_name")
            .execute()
        )
        return [AccountManager(**row) for row in result.data]

    def deactivate_account_manager(self, am_id: UUID, tenant_id: UUID) -> None:
        self._db.table("directory_account_managers").update(
            {"is_active": False}
        ).eq("id", str(am_id)).eq("tenant_id", str(tenant_id)).execute()

    # ------------------------------------------------------------------ #
    # Recruiters
    # ------------------------------------------------------------------ #
    def create_recruiter(
        self, tenant_id: UUID, data: RecruiterCreate
    ) -> Recruiter:
        result = (
            self._db.table("directory_recruiters")
            .insert({"tenant_id": str(tenant_id), **data.model_dump(mode="json")})
            .execute()
        )
        return Recruiter(**result.data[0])

    def list_recruiters(self, tenant_id: UUID) -> list[Recruiter]:
        result = (
            self._db.table("directory_recruiters")
            .select("*")
            .eq("tenant_id", str(tenant_id))
            .eq("is_active", True)
            .order("full_name")
            .execute()
        )
        return [Recruiter(**row) for row in result.data]

    def deactivate_recruiter(self, recruiter_id: UUID, tenant_id: UUID) -> None:
        self._db.table("directory_recruiters").update(
            {"is_active": False}
        ).eq("id", str(recruiter_id)).eq("tenant_id", str(tenant_id)).execute()

    # ------------------------------------------------------------------ #
    # Leadership (CC recipients)
    # ------------------------------------------------------------------ #
    def create_leadership(
        self, tenant_id: UUID, data: LeadershipCreate
    ) -> Leadership:
        result = (
            self._db.table("directory_leadership")
            .insert({"tenant_id": str(tenant_id), **data.model_dump(mode="json")})
            .execute()
        )
        return Leadership(**result.data[0])

    def list_leadership(self, tenant_id: UUID) -> list[Leadership]:
        result = (
            self._db.table("directory_leadership")
            .select("*")
            .eq("tenant_id", str(tenant_id))
            .eq("is_active", True)
            .order("full_name")
            .execute()
        )
        return [Leadership(**row) for row in result.data]

    def get_notification_recipients(
        self,
        tenant_id: UUID,
        location_id: UUID,
        hr_email: str,
        am_email: str,
    ) -> list[dict]:
        """
        Build the full CC/recipient list for any notification event:
          - The Account Manager who raised the request
          - The HR owner of this location
          - Core Director (location_id IS NULL)
          - Location Director for this location
          - Constant entries (e.g. hr@ibridgetechsoft.com)
        Returns a list of {email, name, role} dicts ready for the email service.
        """
        recipients = [
            {"email": am_email, "name": "Account Manager", "role": "account_manager"},
            {"email": hr_email, "name": "HR", "role": "hr"},
        ]

        leadership = (
            self._db.table("directory_leadership")
            .select("*")
            .eq("tenant_id", str(tenant_id))
            .eq("is_active", True)
            .execute()
        )

        for leader in leadership.data:
            # Core Director (no location_id = company-wide) or this location
            if leader["location_id"] is None or leader["location_id"] == str(location_id):
                recipients.append({
                    "email": leader["email"],
                    "name": leader["full_name"],
                    "role": leader["role_label"] or "leadership",
                })

        # Deduplicate by email
        seen = set()
        unique = []
        for r in recipients:
            if r["email"] not in seen:
                seen.add(r["email"])
                unique.append(r)
        return unique
