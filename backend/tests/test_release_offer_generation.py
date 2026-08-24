"""
Tests for release_offer's integration with real document generation
(Milestone 5).

The one property that matters most here: releasing an offer must be
fail-closed. If document generation fails for any reason (no active
template, missing CTC structure, missing mandatory field), the
candidate's tracker stage must NOT change — there must never be a state
where a candidate shows as "Offered" with no actual letter behind it.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

TENANT_A = uuid4()
CANDIDATE_ID = uuid4()


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestReleaseOfferFailsClosed:
    """
    These test the endpoint's control flow directly (not the full HTTP
    stack with a mocked JWT/DB, which would require far more setup for
    marginal additional coverage) — specifically that
    LetterGenerationService is called and its failure prevents
    CandidateService.release_offer from ever being called at all.
    """

    def test_generation_failure_prevents_any_stage_transition(self) -> None:
        from app.api.v1.endpoints.candidates import release_offer
        from app.core.auth import UserProfile
        from datetime import datetime

        fake_user = UserProfile(
            id=uuid4(), tenant_id=TENANT_A, location_id=uuid4(), full_name="Test HR",
            role="hr", is_active=True, created_at=datetime.now(), updated_at=datetime.now(),
            email="hr@test.com",
        )

        with patch("app.api.v1.endpoints.candidates.LetterGenerationService") as MockGenService, \
             patch("app.api.v1.endpoints.candidates.CandidateService") as MockCandidateService:

            MockGenService.return_value.generate_for_candidate.side_effect = ValueError(
                "No active 'offer' letter template configured for this company"
            )

            with pytest.raises(Exception) as exc_info:
                release_offer(CANDIDATE_ID, fake_user, context=None, ctc_structure_id=None)

            # The critical assertion: CandidateService.release_offer must
            # NEVER have been called, since generation failed first.
            MockCandidateService.return_value.release_offer.assert_not_called()

    def test_successful_generation_passes_storage_path_to_release_offer(self) -> None:
        from app.api.v1.endpoints.candidates import release_offer
        from app.core.auth import UserProfile
        from datetime import datetime

        fake_user = UserProfile(
            id=uuid4(), tenant_id=TENANT_A, location_id=uuid4(), full_name="Test HR",
            role="hr", is_active=True, created_at=datetime.now(), updated_at=datetime.now(),
            email="hr@test.com",
        )

        with patch("app.api.v1.endpoints.candidates.LetterGenerationService") as MockGenService, \
             patch("app.api.v1.endpoints.candidates.CandidateService") as MockCandidateService, \
             patch("app.api.v1.endpoints.candidates.get_service_db"), \
             patch("app.api.v1.endpoints.candidates.DirectoryService"), \
             patch("app.api.v1.endpoints.candidates.UserService"), \
             patch("app.api.v1.endpoints.candidates.EmailService"):

            fake_path = f"{TENANT_A}/candidates/{CANDIDATE_ID}/offer_20260101_000000.docx"
            MockGenService.return_value.generate_for_candidate.return_value = fake_path

            fake_candidate = MagicMock()
            fake_candidate.account_manager_id = None
            fake_candidate.hr_owner_id = None
            fake_candidate.location_id = fake_user.location_id
            fake_candidate.id = CANDIDATE_ID
            fake_candidate.full_name = "Test Candidate"
            fake_candidate.client_name = "Test Client"
            MockCandidateService.return_value.release_offer.return_value = fake_candidate

            release_offer(CANDIDATE_ID, fake_user, context=None, ctc_structure_id=None)

            # release_offer must be called WITH the storage path that generation produced.
            call_kwargs = MockCandidateService.return_value.release_offer.call_args.kwargs
            assert call_kwargs["offer_letter_path"] == fake_path
