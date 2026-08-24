"""
Tests for the safe_data() helper (app/db/client.py) and its rollout
across every maybe_single() call site in the backend.

The bug this guards against: on the library version actually deployed,
`.maybe_single().execute()` returns None outright (not an object with
`.data = None`) when zero rows match a query. This crashed twice in
production before becoming a shared, audited helper — first in
branding lookup (a tenant that had never uploaded a logo), then in
letter generation's own branding check. A full sweep found 36 call
sites across 9 files with the same latent bug, including
`CandidateService.get_candidate` — the single most-called function in
the entire backend, which would have 500'd instead of cleanly
returning None for any genuinely missing or invisible candidate.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

from app.db.client import safe_data
from app.services.candidate_service import CandidateService


def test_safe_data_returns_none_for_a_none_result() -> None:
    """The exact real-world case: zero rows matched, and the library
    returns None outright rather than an object with .data = None."""
    assert safe_data(None) is None


def test_safe_data_returns_data_for_a_real_result() -> None:
    fake_result = MagicMock()
    fake_result.data = {"id": "123"}
    assert safe_data(fake_result) == {"id": "123"}


def test_safe_data_passes_through_none_data_on_a_real_result_object() -> None:
    fake_result = MagicMock()
    fake_result.data = None
    assert safe_data(fake_result) is None


def test_get_candidate_does_not_crash_when_query_returns_none_outright() -> None:
    """
    Regression test for the most critical instance of this bug:
    get_candidate is called by nearly every endpoint in the app. Before
    the fix, a genuinely missing or invisible candidate_id would crash
    with AttributeError (surfacing as an unexplained 500, often
    displayed as a misleading CORS error in the browser) instead of the
    clean None -> 404 that every caller expects and handles.
    """
    svc = CandidateService.__new__(CandidateService)
    mock_db = MagicMock()
    svc._db = mock_db
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value = None

    result = svc.get_candidate(uuid4(), uuid4(), "hr", uuid4())
    assert result is None
