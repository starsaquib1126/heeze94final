"""
Tests for platform-owner endpoints.

The whole point of this file: a real regression test for the critical
bug found during Milestone 1 review — every platform-owner route
(create/list/suspend tenants, create super user) had a `verify_platform_key`
guard defined but never actually applied via `Depends()`, leaving every
one of these routes completely open. These tests fail loudly if that
guard is ever accidentally removed or un-wired again.
"""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

PLATFORM_ENDPOINTS = [
    ("GET", "/api/v1/platform/tenants"),
    ("POST", "/api/v1/platform/tenants"),
    ("PATCH", "/api/v1/platform/tenants/00000000-0000-0000-0000-000000000000/activate"),
    ("PATCH", "/api/v1/platform/tenants/00000000-0000-0000-0000-000000000000/suspend"),
    ("POST", "/api/v1/platform/tenants/00000000-0000-0000-0000-000000000000/super-user"),
]


@pytest.mark.parametrize("method,path", PLATFORM_ENDPOINTS)
def test_platform_endpoint_rejects_missing_key(method: str, path: str) -> None:
    """No x-platform-key header at all -> must never succeed (422 is fine: it
    means FastAPI's Header(...) validation ran, i.e. the guard is wired in)."""
    response = client.request(method, path, json={} if method != "GET" else None)
    assert response.status_code in (422, 403), (
        f"{method} {path} returned {response.status_code} without a platform key — "
        f"this is the exact regression the critical security fix addressed."
    )
    assert response.status_code != 200
    assert response.status_code != 201


@pytest.mark.parametrize("method,path", PLATFORM_ENDPOINTS)
def test_platform_endpoint_rejects_wrong_key(method: str, path: str) -> None:
    """A present but incorrect key must be rejected with 403, never allowed through."""
    response = client.request(
        method, path,
        headers={"x-platform-key": "definitely-not-the-real-key"},
        json={} if method != "GET" else None,
    )
    assert response.status_code == 403
    assert "Invalid platform key" in response.json()["detail"]


def test_platform_key_env_var_must_be_set_for_any_key_to_work() -> None:
    """
    Sanity check on the guard's fail-closed behavior: if PLATFORM_OWNER_KEY
    were ever unset in production (e.g. a deploy config mistake), the guard
    must still reject everything rather than accepting an empty key.
    """
    original = os.environ.pop("PLATFORM_OWNER_KEY", None)
    try:
        response = client.get("/api/v1/platform/tenants", headers={"x-platform-key": ""})
        assert response.status_code == 403
    finally:
        if original is not None:
            os.environ["PLATFORM_OWNER_KEY"] = original


def test_health_check_is_public() -> None:
    """The health check must never require the platform key — it's used by
    Render's own uptime monitoring, which doesn't have credentials."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
