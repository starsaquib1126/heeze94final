"""
Authentication & Authorization dependencies.

Every protected route uses one of:
    CurrentUser      — any valid HR or Super User
    SuperUserOnly    — Super User only
    HROnly           — HR only (location-scoped)
    PlatformOwner    — reserved for the platform provisioning endpoints

Tokens are verified against Supabase's own JWKS endpoint
(https://<project>.supabase.co/auth/v1/jwks) rather than a single
hardcoded shared secret. This is Supabase's own recommended approach —
their JWKS endpoint transparently exposes whichever keys are actually
valid for a given project, whether it's still on the older single-secret
(HS256) system or has migrated to the newer per-key signing system
(which can use HS256, RS256, or ES256 depending on configuration).
Hardcoding one algorithm/secret combination broke verification the
moment a project used the newer system, even with a byte-for-byte
correct secret value — this is what fixed that.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.core.config import get_settings
from app.db.client import get_service_db
from app.models.user import UserProfile

bearer = HTTPBearer()

# Cached across requests — PyJWKClient handles its own key caching/refresh
# internally, so this should be a long-lived singleton, not rebuilt per call.
_jwks_client: PyJWKClient | None = None


class AuthError(HTTPException):
    def __init__(self, detail: str = "Not authenticated"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


class ForbiddenError(HTTPException):
    def __init__(self, detail: str = "Insufficient permissions"):
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        s = get_settings()
        # The correct, officially-documented path is /.well-known/jwks.json —
        # NOT the bare /auth/v1/jwks this originally used, which is a real
        # bug: Supabase's docs (supabase.com/docs/guides/auth/jwts) specify
        # "GET https://project-id.supabase.co/auth/v1/.well-known/jwks.json"
        # explicitly. The apikey header is also required — Supabase's
        # gateway rejects unauthenticated requests to /auth/v1/* routes
        # generally (confirmed via Supabase's own GitHub discussions), even
        # though the JWKS content itself is meant to be publicly readable.
        jwks_url = f"{s.supabase_url}/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(
            jwks_url, cache_keys=True, lifespan=3600,
            headers={"apikey": s.supabase_anon_key},
        )
    return _jwks_client


def _decode_jwt(token: str) -> dict:
    """Validate the JWT signature (via Supabase's JWKS endpoint) and
    return its payload."""
    try:
        jwks_client = _get_jwks_client()
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["HS256", "RS256", "ES256"],
            audience="authenticated",
        )
    except jwt.ExpiredSignatureError:
        raise AuthError("Token has expired")
    except jwt.InvalidTokenError as exc:
        raise AuthError(f"Invalid token: {exc}")
    except Exception as exc:
        # PyJWKClient itself can raise (network issues reaching Supabase,
        # no matching key found, malformed JWKS response, etc.) — these
        # aren't jwt.InvalidTokenError subclasses, so they need their own
        # catch to still surface as a clean 401 rather than an unhandled 500.
        raise AuthError(f"Could not verify token: {exc}")


def _load_profile(user_id: str) -> UserProfile:
    """Load the user's profile from the database."""
    db = get_service_db()
    result = (
        db.table("user_profiles")
        .select("*")
        .eq("id", user_id)
        .eq("is_active", True)
        .single()
        .execute()
    )
    if not result.data:
        raise AuthError("User profile not found or inactive")
    return UserProfile(**result.data)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer)],
) -> UserProfile:
    """Dependency: any valid, active HR or Super User."""
    payload = _decode_jwt(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise AuthError("Token missing subject")
    profile = _load_profile(user_id)
    profile.email = payload.get("email", "")
    return profile


async def get_super_user(
    user: Annotated[UserProfile, Depends(get_current_user)],
) -> UserProfile:
    """Dependency: Super User only."""
    if user.role != "super_user":
        raise ForbiddenError("Super User access required")
    return user


async def get_hr_user(
    user: Annotated[UserProfile, Depends(get_current_user)],
) -> UserProfile:
    """Dependency: HR only (location-scoped)."""
    if user.role not in ("hr", "super_user"):
        raise ForbiddenError("HR access required")
    return user


# Type aliases for clean route signatures
CurrentUser  = Annotated[UserProfile, Depends(get_current_user)]
SuperUser    = Annotated[UserProfile, Depends(get_super_user)]
HRUser       = Annotated[UserProfile, Depends(get_hr_user)]
