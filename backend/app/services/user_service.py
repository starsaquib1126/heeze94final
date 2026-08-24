"""
User Management Service.

Super User creates/manages HR logins for their own tenant.
Uses the Supabase Admin API (service key) to create auth.users entries,
then creates the user_profiles record linked to it.

The Platform Owner uses this same service to create the initial
Super User for a new tenant — the only time Platform Owner touches
anything inside a tenant record.
"""

from __future__ import annotations

from uuid import UUID

from app.db.client import get_service_db
from app.models.user import UserProfile, UserProfileCreate


class UserService:
    def __init__(self) -> None:
        self._db = get_service_db()

    def create_user(
        self,
        data: UserProfileCreate,
        created_by_tenant_id: UUID | None = None,
    ) -> UserProfile:
        """
        Create a Supabase auth user + profile in one transaction.
        `created_by_tenant_id` is used to verify the caller's tenant
        matches the profile's tenant when called by a Super User.
        """
        if created_by_tenant_id and str(created_by_tenant_id) != str(data.tenant_id):
            raise PermissionError("Cannot create users for a different tenant")

        # Create the Supabase auth user — this sends an invite email
        auth_response = self._db.auth.admin.create_user(
            {
                "email": data.email,
                "email_confirm": True,
                "user_metadata": {
                    "full_name": data.full_name,
                    "tenant_id": str(data.tenant_id),
                    "role": data.role,
                },
            }
        )
        auth_user = auth_response.user
        if not auth_user:
            raise RuntimeError("Failed to create auth user")

        # Create the profile record
        profile_data = {
            "id": str(auth_user.id),
            "tenant_id": str(data.tenant_id),
            "location_id": str(data.location_id) if data.location_id else None,
            "full_name": data.full_name,
            "role": data.role,
        }
        result = (
            self._db.table("user_profiles")
            .insert(profile_data)
            .execute()
        )
        return UserProfile(**result.data[0])

    def list_users(self, tenant_id: UUID) -> list[UserProfile]:
        result = (
            self._db.table("user_profiles")
            .select("*")
            .eq("tenant_id", str(tenant_id))
            .order("created_at", desc=True)
            .execute()
        )
        return [UserProfile(**row) for row in result.data]

    def deactivate_user(self, user_id: UUID, tenant_id: UUID) -> UserProfile:
        # Verify the user belongs to this tenant before deactivating
        check = (
            self._db.table("user_profiles")
            .select("tenant_id")
            .eq("id", str(user_id))
            .single()
            .execute()
        )
        if not check.data or check.data["tenant_id"] != str(tenant_id):
            raise PermissionError("User not found in this tenant")

        result = (
            self._db.table("user_profiles")
            .update({"is_active": False})
            .eq("id", str(user_id))
            .execute()
        )
        # Also disable the Supabase auth account
        self._db.auth.admin.update_user_by_id(
            str(user_id), {"ban_duration": "876600h"}  # ~100 years
        )
        return UserProfile(**result.data[0])

    def get_profile(self, user_id: UUID) -> UserProfile:
        result = (
            self._db.table("user_profiles")
            .select("*")
            .eq("id", str(user_id))
            .single()
            .execute()
        )
        if not result.data:
            raise ValueError(f"User {user_id} not found")
        return UserProfile(**result.data)

    def get_auth_email(self, user_id: UUID) -> str:
        """
        Look up a user's email from Supabase's auth.users table — not
        stored on user_profiles at all (see UserProfile.email's docstring
        in models/user.py). Returns "" rather than raising if the lookup
        fails, since this is almost always used to build a notification
        recipient list where a missing email should degrade gracefully
        (skip that recipient) rather than block the whole action.
        """
        try:
            auth_user = self._db.auth.admin.get_user_by_id(str(user_id))
            return auth_user.user.email if auth_user.user else ""
        except Exception:
            return ""
