"""
Tests for candidate tracker access scoping (Milestone 2).

This is the boundary that matters most in a multi-tenant system: an HR
user must never see another location's candidates, and never another
tenant's candidates at all, regardless of role. These tests exercise
`CandidateService` directly against a mocked Supabase client rather than
through the full HTTP stack, so the scoping logic itself is what's under
test — not incidentally covered as a side effect of an endpoint test.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.candidate_service import CandidateService

TENANT_A = uuid4()
LOCATION_A1 = uuid4()
LOCATION_A2 = uuid4()


def _service_with_mock_query():
    """Build a CandidateService whose underlying table() call returns a
    MagicMock query builder we can inspect afterward."""
    svc = CandidateService.__new__(CandidateService)  # skip __init__'s real get_service_db()
    mock_db = MagicMock()
    svc._db = mock_db
    return svc, mock_db


def test_super_user_query_is_scoped_to_tenant_only() -> None:
    svc, mock_db = _service_with_mock_query()
    mock_table = mock_db.table.return_value
    mock_select = mock_table.select.return_value
    mock_select.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = []

    svc.list_candidates(tenant_id=TENANT_A, role="super_user", location_id=None)

    # Super User's query must filter by tenant_id...
    mock_select.eq.assert_any_call("tenant_id", str(TENANT_A))
    # ...and must NOT additionally filter by location_id — anywhere in the
    # call chain — since Super User is meant to see every location.
    all_eq_calls = [c.args for c in mock_select.eq.call_args_list]
    assert not any(call[0] == "location_id" for call in all_eq_calls), (
        "Super User's query was scoped to a location — it should see the whole tenant."
    )


def test_hr_query_is_scoped_to_tenant_and_own_location() -> None:
    svc, mock_db = _service_with_mock_query()
    mock_table = mock_db.table.return_value
    mock_select = mock_table.select.return_value
    mock_select.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = []

    svc.list_candidates(tenant_id=TENANT_A, role="hr", location_id=LOCATION_A1)

    # First .eq() call must be tenant_id
    first_call = mock_select.eq.call_args_list[0]
    assert first_call.args == ("tenant_id", str(TENANT_A))

    # The chained .eq() after that must scope to this HR's own location
    second_eq = mock_select.eq.return_value.eq
    second_eq.assert_called_with("location_id", str(LOCATION_A1))


def test_hr_with_no_location_id_raises_instead_of_returning_everything() -> None:
    """
    A data-integrity bug that gave an HR profile a NULL location_id must
    fail loudly, not silently produce a query with no location filter —
    which would be the same as Super User's unrestricted access, granted
    to someone whose role says they shouldn't have it.
    """
    svc, _ = _service_with_mock_query()
    with pytest.raises(ValueError, match="no location_id"):
        svc.list_candidates(tenant_id=TENANT_A, role="hr", location_id=None)


def test_get_candidate_events_never_leaks_events_for_an_invisible_candidate() -> None:
    """
    If `get_candidate` (the visibility check) returns None for a candidate
    that belongs to a different location, `get_candidate_events` must
    return nothing for it too — even if, hypothetically, the events table
    query itself wasn't separately scoped. The visibility check must
    short-circuit before any event data is fetched.
    """
    svc, mock_db = _service_with_mock_query()

    # Simulate: the candidate lookup finds nothing (wrong location/tenant)
    svc.get_candidate = MagicMock(return_value=None)

    events = svc.get_candidate_events(
        candidate_id=uuid4(), tenant_id=TENANT_A, role="hr", location_id=LOCATION_A1
    )

    assert events == []
    # The events table must never even be queried once visibility failed.
    mock_db.table.assert_not_called()


def test_two_locations_in_the_same_tenant_get_different_scoping() -> None:
    """Sanity check that location_id actually flows through — not just
    that *a* location filter gets applied, but the *right* one per caller."""
    svc, mock_db = _service_with_mock_query()
    mock_select = mock_db.table.return_value.select.return_value
    mock_select.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = []

    svc.list_candidates(tenant_id=TENANT_A, role="hr", location_id=LOCATION_A1)
    first_hr_location_call = mock_select.eq.return_value.eq.call_args

    svc.list_candidates(tenant_id=TENANT_A, role="hr", location_id=LOCATION_A2)
    second_hr_location_call = mock_select.eq.return_value.eq.call_args

    assert first_hr_location_call.args == ("location_id", str(LOCATION_A1))
    assert second_hr_location_call.args == ("location_id", str(LOCATION_A2))
    assert first_hr_location_call != second_hr_location_call
