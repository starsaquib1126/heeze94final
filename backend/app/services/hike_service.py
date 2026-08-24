"""
Hike Letter Service.

Hikes are their own append-only log, not a candidate stage transition —
per the tracker design decision from earlier discussion: an employee
can receive multiple hikes over their tenure, which can't live as a
single field on the candidate row the way "Offer" or "Appointment" can
(those genuinely only happen once). The candidate's stage stays
'active' across any number of hikes.

"Current CTC" for a candidate is derived, not stored on the candidate
row itself: it's the revised_ctc of their most recent hike, or their
original proposed_ctc if they've never had one. This is what
`get_current_ctc` computes, and it's what the NEXT hike's `previous_ctc`
comes from — never something the caller has to track or supply
themselves, which would risk drifting out of sync with reality.
"""

from __future__ import annotations

from uuid import UUID

from app.db.client import get_service_db, safe_data
from app.models.user import HikeLetter


class HikeService:
    def __init__(self) -> None:
        self._db = get_service_db()

    def get_current_ctc(self, candidate_id: UUID, tenant_id: UUID) -> float:
        """
        The CTC any new hike should treat as "previous" — the most
        recent hike's revised_ctc if one exists, otherwise the
        candidate's original proposed_ctc.
        """
        latest_hike = (
            self._db.table("hike_letters").select("revised_ctc")
            .eq("candidate_id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .order("released_at", desc=True).limit(1).execute()
        )
        if latest_hike.data:
            return float(latest_hike.data[0]["revised_ctc"])

        candidate = (
            self._db.table("candidates").select("proposed_ctc")
            .eq("id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .maybe_single().execute()
        )
        candidate_data = safe_data(candidate)
        if not candidate_data or candidate_data.get("proposed_ctc") is None:
            raise ValueError("Candidate has no CTC on record to base a hike on")
        return float(candidate_data["proposed_ctc"])

    def release_hike(
        self,
        candidate_id: UUID,
        tenant_id: UUID,
        revised_ctc: float,
        effective_date: str,
        released_by: UUID,
        letter_path: str,
    ) -> HikeLetter:
        """
        Records a hike. `previous_ctc` is always computed by this method
        from the candidate's actual current CTC (see get_current_ctc) —
        never passed in by the caller — so it can't drift out of sync
        with what the candidate's CTC genuinely was immediately before
        this hike.
        """
        previous_ctc = self.get_current_ctc(candidate_id, tenant_id)

        result = self._db.table("hike_letters").insert({
            "tenant_id": str(tenant_id),
            "candidate_id": str(candidate_id),
            "previous_ctc": previous_ctc,
            "revised_ctc": revised_ctc,
            "effective_date": effective_date,
            "letter_path": letter_path,
            "released_by": str(released_by),
        }).execute()
        hike = HikeLetter(**result.data[0])

        self._db.table("candidate_events").insert({
            "candidate_id": str(candidate_id), "tenant_id": str(tenant_id),
            "event_type": "hike_released", "performed_by": str(released_by),
            "details": {
                "previous_ctc": previous_ctc, "revised_ctc": revised_ctc,
                "effective_date": effective_date,
            },
        }).execute()

        return hike

    def get_hike_history(self, candidate_id: UUID, tenant_id: UUID) -> list[HikeLetter]:
        result = (
            self._db.table("hike_letters").select("*")
            .eq("candidate_id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .order("released_at", desc=True).execute()
        )
        return [HikeLetter(**row) for row in result.data]
