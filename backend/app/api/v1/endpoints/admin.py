"""
Super User admin endpoints.

Everything the Head HR / Admin configures once per tenant:
  - Locations (offices)
  - Directory: clients, account managers, recruiters, leadership
  - HR user management
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.core.auth import CurrentUser, SuperUser
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
    UserProfile,
    UserProfileCreate,
)
from app.services.directory_service import DirectoryService
from app.services.user_service import UserService

router = APIRouter(prefix="/admin", tags=["admin"])


# ------------------------------------------------------------------ #
# Locations
# ------------------------------------------------------------------ #

@router.post("/locations", response_model=Location, status_code=201)
def create_location(data: LocationCreate, user: SuperUser) -> Location:
    return DirectoryService().create_location(user.tenant_id, data)


@router.get("/locations", response_model=list[Location])
def list_locations(user: CurrentUser) -> list[Location]:
    """Any logged-in user can list their tenant's locations."""
    return DirectoryService().list_locations(user.tenant_id)


# ------------------------------------------------------------------ #
# HR User Management
# ------------------------------------------------------------------ #

@router.post("/users", response_model=UserProfile, status_code=201)
def create_hr_user(data: UserProfileCreate, user: SuperUser) -> UserProfile:
    """Super User creates HR logins for their locations."""
    data.tenant_id = user.tenant_id
    data.role = "hr"
    try:
        return UserService().create_user(data, created_by_tenant_id=user.tenant_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/users", response_model=list[UserProfile])
def list_users(user: SuperUser) -> list[UserProfile]:
    return UserService().list_users(user.tenant_id)


@router.patch("/users/{user_id}/deactivate", response_model=UserProfile)
def deactivate_user(user_id: UUID, user: SuperUser) -> UserProfile:
    try:
        return UserService().deactivate_user(user_id, user.tenant_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


# ------------------------------------------------------------------ #
# Directory: Clients → Location mapping
# ------------------------------------------------------------------ #

@router.post("/directory/clients", response_model=DirectoryClient, status_code=201)
def create_client_mapping(data: DirectoryClientCreate, user: SuperUser) -> DirectoryClient:
    return DirectoryService().create_client_mapping(user.tenant_id, data)


@router.get("/directory/clients", response_model=list[DirectoryClient])
def list_client_mappings(user: CurrentUser) -> list[DirectoryClient]:
    return DirectoryService().list_client_mappings(user.tenant_id)


# ------------------------------------------------------------------ #
# Directory: Account Managers
# ------------------------------------------------------------------ #

@router.post("/directory/account-managers", response_model=AccountManager, status_code=201)
def create_account_manager(data: AccountManagerCreate, user: SuperUser) -> AccountManager:
    return DirectoryService().create_account_manager(user.tenant_id, data)


@router.get("/directory/account-managers", response_model=list[AccountManager])
def list_account_managers(user: CurrentUser) -> list[AccountManager]:
    return DirectoryService().list_account_managers(user.tenant_id)


@router.delete("/directory/account-managers/{am_id}", status_code=204)
def deactivate_account_manager(am_id: UUID, user: SuperUser) -> None:
    DirectoryService().deactivate_account_manager(am_id, user.tenant_id)


# ------------------------------------------------------------------ #
# Directory: Recruiters
# ------------------------------------------------------------------ #

@router.post("/directory/recruiters", response_model=Recruiter, status_code=201)
def create_recruiter(data: RecruiterCreate, user: SuperUser) -> Recruiter:
    return DirectoryService().create_recruiter(user.tenant_id, data)


@router.get("/directory/recruiters", response_model=list[Recruiter])
def list_recruiters(user: CurrentUser) -> list[Recruiter]:
    return DirectoryService().list_recruiters(user.tenant_id)


@router.delete("/directory/recruiters/{recruiter_id}", status_code=204)
def deactivate_recruiter(recruiter_id: UUID, user: SuperUser) -> None:
    DirectoryService().deactivate_recruiter(recruiter_id, user.tenant_id)


# ------------------------------------------------------------------ #
# Directory: Leadership (CC recipients)
# ------------------------------------------------------------------ #

@router.post("/directory/leadership", response_model=Leadership, status_code=201)
def create_leadership(data: LeadershipCreate, user: SuperUser) -> Leadership:
    return DirectoryService().create_leadership(user.tenant_id, data)


@router.get("/directory/leadership", response_model=list[Leadership])
def list_leadership(user: SuperUser) -> list[Leadership]:
    return DirectoryService().list_leadership(user.tenant_id)
