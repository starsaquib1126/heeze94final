"""
Tests for the client -> HR resolution preview endpoint — lets the
public offer-request form show (and pre-fill) which HR a client
actually routes to as the AM types, without submitting anything.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import app.api.v1.endpoints.public as public_module
from app.models.user import Location

TENANT = uuid4()


def test_known_client_resolves_to_its_routed_hr(monkeypatch) -> None:
    monkeypatch.setattr(
        public_module, "_resolve_tenant",
        lambda slug: {"id": str(TENANT), "name": "Test", "is_active": True},
    )
    location_id = uuid4()
    mock_directory = MagicMock()
    mock_directory.resolve_client.return_value = Location(
        id=location_id, tenant_id=TENANT, name="Noida", location_code="NOI",
        address=None, is_active=True, created_at="2026-01-01T00:00:00",
    )
    monkeypatch.setattr(public_module, "DirectoryService", lambda: mock_directory)

    hr_id = str(uuid4())
    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value \
        .eq.return_value.limit.return_value.execute.return_value.data = [
            {"id": hr_id, "full_name": "Saquib Siddiqui"}
        ]
    monkeypatch.setattr(public_module, "get_service_db", lambda: mock_db)

    result = public_module.resolve_client_hr(client_name="Deloitte USI", tenant_slug="ibridge")
    assert result == {"hr_id": hr_id, "hr_name": "Saquib Siddiqui"}


def test_unknown_client_resolves_to_nothing(monkeypatch) -> None:
    monkeypatch.setattr(
        public_module, "_resolve_tenant",
        lambda slug: {"id": str(TENANT), "name": "Test", "is_active": True},
    )
    mock_directory = MagicMock()
    mock_directory.resolve_client.return_value = None
    monkeypatch.setattr(public_module, "DirectoryService", lambda: mock_directory)

    result = public_module.resolve_client_hr(client_name="Some Random Client", tenant_slug="ibridge")
    assert result == {"hr_id": None, "hr_name": None}


def test_blank_client_name_resolves_to_nothing_without_querying(monkeypatch) -> None:
    monkeypatch.setattr(
        public_module, "_resolve_tenant",
        lambda slug: {"id": str(TENANT), "name": "Test", "is_active": True},
    )
    mock_directory = MagicMock()
    monkeypatch.setattr(public_module, "DirectoryService", lambda: mock_directory)

    result = public_module.resolve_client_hr(client_name="   ", tenant_slug="ibridge")
    assert result == {"hr_id": None, "hr_name": None}
    mock_directory.resolve_client.assert_not_called()


def test_client_routed_but_no_active_hr_at_that_location(monkeypatch) -> None:
    """A location exists in Client Routing but has no active HR
    assigned yet — should resolve to nothing, not crash."""
    monkeypatch.setattr(
        public_module, "_resolve_tenant",
        lambda slug: {"id": str(TENANT), "name": "Test", "is_active": True},
    )
    location_id = uuid4()
    mock_directory = MagicMock()
    mock_directory.resolve_client.return_value = Location(
        id=location_id, tenant_id=TENANT, name="Bengaluru", location_code="BLR",
        address=None, is_active=True, created_at="2026-01-01T00:00:00",
    )
    monkeypatch.setattr(public_module, "DirectoryService", lambda: mock_directory)

    mock_db = MagicMock()
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value \
        .eq.return_value.limit.return_value.execute.return_value.data = []
    monkeypatch.setattr(public_module, "get_service_db", lambda: mock_db)

    result = public_module.resolve_client_hr(client_name="IBM", tenant_slug="ibridge")
    assert result == {"hr_id": None, "hr_name": None}
