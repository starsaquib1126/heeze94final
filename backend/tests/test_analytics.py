"""
Tests for CandidateService.get_analytics() — the headline recruiting
metrics (requests raised, offers released, joined, rejected, and the
offer→joining conversion rate) shown on the Analytics view.

Includes a regression test for a real bug caught before shipping:
"joined" was initially computed using ACTIVE_STAGES, a set meant for a
different purpose ("still in the active pipeline") that includes
'requested' and 'offered' — which would have massively overcounted
joinings to include candidates who haven't joined at all.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

from app.services.candidate_service import CandidateService

TENANT = uuid4()
LOCATION = uuid4()


def _mock_service_with_rows(rows: list[dict]) -> CandidateService:
    svc = CandidateService.__new__(CandidateService)
    mock_db = MagicMock()
    svc._db = mock_db
    # Chain for role="hr": table().select().eq(tenant_id).eq(location_id).execute()
    # — two .eq() calls, since _scope() applies both a tenant filter and
    # (for HR) a location filter. MagicMock's .eq always resolves to the
    # same .eq.return_value regardless of call count/args, so this one
    # path correctly covers both calls chained together.
    (mock_db.table.return_value.select.return_value.eq.return_value.eq
     .return_value.execute.return_value.data) = rows
    return svc


def test_analytics_counts_are_correct_for_a_realistic_mixed_pipeline() -> None:
    rows = [
        {"stage": "requested", "offer_released_at": None, "confirmed_doj": None, "request_date": "2026-01-01"},
        {"stage": "offered", "offer_released_at": "2026-01-05", "confirmed_doj": None, "request_date": "2026-01-01"},
        {"stage": "rejected", "offer_released_at": "2026-01-06", "confirmed_doj": None, "request_date": "2026-01-01"},
        {"stage": "joined", "offer_released_at": "2026-01-02", "confirmed_doj": "2026-02-01", "request_date": "2026-01-01"},
        {"stage": "active", "offer_released_at": "2026-01-03", "confirmed_doj": "2026-02-01", "request_date": "2026-01-01"},
        {"stage": "exited", "offer_released_at": "2026-01-04", "confirmed_doj": "2026-02-01", "request_date": "2026-01-01"},
    ]
    svc = _mock_service_with_rows(rows)
    result = svc.get_analytics(TENANT, "hr", LOCATION)

    assert result["requests_raised"] == 6
    assert result["offers_released"] == 5  # everyone except the plain 'requested' row
    assert result["joined"] == 3  # joined, active, exited — all genuinely progressed past joining
    assert result["rejected"] == 1
    assert result["offer_to_joining_rate"] == 60.0  # 3/5 * 100


def test_requested_and_offered_stages_do_not_count_as_joined() -> None:
    """
    Regression test for the real bug: a candidate merely 'requested' or
    'offered' (not yet joined) must never be counted in "joined", even
    though both those stages belong to the unrelated ACTIVE_STAGES set
    used elsewhere for "still in the active pipeline".
    """
    rows = [
        {"stage": "requested", "offer_released_at": None, "confirmed_doj": None, "request_date": "2026-01-01"},
        {"stage": "offered", "offer_released_at": "2026-01-05", "confirmed_doj": None, "request_date": "2026-01-01"},
        {"stage": "revised", "offer_released_at": "2026-01-06", "confirmed_doj": None, "request_date": "2026-01-01"},
    ]
    svc = _mock_service_with_rows(rows)
    result = svc.get_analytics(TENANT, "hr", LOCATION)

    assert result["joined"] == 0
    assert result["offers_released"] == 2


def test_offer_to_joining_rate_is_none_when_no_offers_released_yet() -> None:
    """Avoid a divide-by-zero — a brand new pipeline with zero offers
    released has no meaningful conversion rate to show."""
    rows = [
        {"stage": "requested", "offer_released_at": None, "confirmed_doj": None, "request_date": "2026-01-01"},
    ]
    svc = _mock_service_with_rows(rows)
    result = svc.get_analytics(TENANT, "hr", LOCATION)

    assert result["offer_to_joining_rate"] is None


def test_joined_via_confirmed_doj_even_if_stage_somehow_lagging() -> None:
    """confirmed_doj being set is itself sufficient evidence of a
    joining, independent of the stage field, as defense in depth."""
    rows = [
        {"stage": "requested", "offer_released_at": "2026-01-01", "confirmed_doj": "2026-02-01", "request_date": "2026-01-01"},
    ]
    svc = _mock_service_with_rows(rows)
    result = svc.get_analytics(TENANT, "hr", LOCATION)

    assert result["joined"] == 1
