"""
Candidate Service.

Started as a read-only service backing the HR dashboard and tracker
(Milestone 2); now also owns the one write operation added in
Milestone 3 — releasing an offer. Every read method takes the caller's
role and location explicitly and scopes the query accordingly:
  - Super User: sees every candidate in their tenant, across all locations
  - HR: sees only candidates at their own location

This mirrors the same manual-scoping pattern already used in
`directory_service.py` and `admin.py`, rather than introducing a second,
RLS-enforced data-access path — consistency with the rest of the
codebase matters more here than defense-in-depth from a second
enforcement layer, since every query in this file is covered by a
dedicated scoping test (see `tests/test_candidate_scoping.py`).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from uuid import UUID

from app.db.client import get_service_db, safe_data
from app.models.user import Candidate, CandidateEvent, NotificationLogEntry

# Stages that count as "still in the pipeline" for dashboard stage-breakdown
# purposes — excludes terminal states (rejected, exited) from the headline count.
ACTIVE_STAGES = ("requested", "offered", "revised", "joined", "id_assigned", "active")


class CandidateService:
    def __init__(self) -> None:
        self._db = get_service_db()

    def _scope(self, query, tenant_id: UUID, role: str, location_id: UUID | None):
        """Apply the tenant + (if HR) location filter every query needs."""
        query = query.eq("tenant_id", str(tenant_id))
        if role == "hr":
            if location_id is None:
                # An HR profile with no location_id is a data-integrity problem,
                # not a "sees nothing" edge case — fail loudly rather than
                # silently returning an empty list that looks like "no candidates".
                raise ValueError("HR user has no location_id assigned — cannot scope query")
            query = query.eq("location_id", str(location_id))
        return query

    # ------------------------------------------------------------------ #
    # List / detail
    # ------------------------------------------------------------------ #
    def list_candidates(
        self,
        tenant_id: UUID,
        role: str,
        location_id: UUID | None,
        stage: str | None = None,
        search: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        recruiter_id: UUID | None = None,
        account_manager_id: UUID | None = None,
        limit: int = 100,
    ) -> list[Candidate]:
        query = self._db.table("candidates").select("*")
        query = self._scope(query, tenant_id, role, location_id)

        if stage:
            query = query.eq("stage", stage)
        if search:
            # Search across name, email, and client — the fields an HR
            # would actually type into a search box while scanning the tracker.
            like = f"%{search.strip()}%"
            query = query.or_(
                f"full_name.ilike.{like},email.ilike.{like},client_name.ilike.{like}"
            )
        # Date range, recruiter, and Account Manager filters exist mainly for
        # the Excel export — the incentive/reporting use case explicitly
        # called for filtering rather than a full unfiltered dump every time.
        if date_from:
            query = query.gte("request_date", date_from)
        if date_to:
            query = query.lte("request_date", date_to)
        if recruiter_id:
            query = query.eq("recruiter_id", str(recruiter_id))
        if account_manager_id:
            query = query.eq("account_manager_id", str(account_manager_id))

        result = query.order("request_date", desc=True).limit(limit).execute()
        return [Candidate(**row) for row in result.data]

    def get_candidate(
        self, candidate_id: UUID, tenant_id: UUID, role: str, location_id: UUID | None
    ) -> Candidate | None:
        query = self._db.table("candidates").select("*").eq("id", str(candidate_id))
        query = self._scope(query, tenant_id, role, location_id)
        result = query.maybe_single().execute()
        result_data = safe_data(result)
        return Candidate(**result_data) if result_data else None

    def get_candidate_events(
        self, candidate_id: UUID, tenant_id: UUID, role: str, location_id: UUID | None
    ) -> list[CandidateEvent]:
        """
        Returns the append-only event history for one candidate. Access is
        still scoped: an HR user can't fetch another location's candidate's
        events just by guessing a candidate_id, even though this queries
        `candidate_events` directly rather than `candidates` — so we verify
        the candidate itself is visible to this caller first.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            return []

        result = (
            self._db.table("candidate_events")
            .select("*")
            .eq("candidate_id", str(candidate_id))
            .order("created_at", desc=True)
            .execute()
        )
        return [CandidateEvent(**row) for row in result.data]

    def get_notification_log(
        self, candidate_id: UUID, tenant_id: UUID, role: str, location_id: UUID | None
    ) -> list[NotificationLogEntry]:
        """
        Every email actually sent for this candidate — proof of delivery
        (or failure) for "did the Account Manager actually get notified
        about this?" questions. Same visibility check as
        get_candidate_events: confirm the candidate itself is visible to
        this caller before returning anything about it.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            return []

        result = (
            self._db.table("notification_log")
            .select("*")
            .eq("candidate_id", str(candidate_id))
            .order("sent_at", desc=True)
            .execute()
        )
        return [NotificationLogEntry(**row) for row in result.data]

    # ------------------------------------------------------------------ #
    # Dashboard
    # ------------------------------------------------------------------ #
    def get_stage_counts(
        self, tenant_id: UUID, role: str, location_id: UUID | None
    ) -> dict[str, int]:
        """Count of candidates per stage, for the dashboard's stat cards."""
        query = self._db.table("candidates").select("stage")
        query = self._scope(query, tenant_id, role, location_id)
        result = query.execute()

        counts: dict[str, int] = {}
        for row in result.data:
            counts[row["stage"]] = counts.get(row["stage"], 0) + 1
        return counts

    def get_analytics(
        self, tenant_id: UUID, role: str, location_id: UUID | None,
        date_from: str | None = None, date_to: str | None = None,
    ) -> dict:
        """
        Headline recruiting metrics — requests raised, offers released,
        joinings, rejections, and the offer→joining conversion rate.

        Computed directly from fields already on each candidate record
        (offer_released_at, confirmed_doj, stage) rather than a separate
        events aggregation — a candidate who's since moved past "joined"
        (into active, resigned, even exited) still correctly counts as
        both an offer released AND a joining, since those timestamps/
        stage-progressions persist regardless of where they are now.
        """
        query = self._db.table("candidates").select(
            "stage, offer_released_at, confirmed_doj, request_date"
        )
        query = self._scope(query, tenant_id, role, location_id)
        if date_from:
            query = query.gte("request_date", date_from)
        if date_to:
            query = query.lte("request_date", date_to)
        rows = query.execute().data

        requests_raised = len(rows)
        offers_released = sum(1 for r in rows if r["offer_released_at"])
        # Deliberately NOT reusing ACTIVE_STAGES here — that set includes
        # 'requested' and 'offered', which haven't joined at all. This is
        # its own, narrower set: stages meaning the candidate genuinely
        # progressed past joining, regardless of whether they're still
        # with the company now.
        joined_or_beyond = ("joined", "id_assigned", "active", "resigned", "exited")
        joined = sum(1 for r in rows if r["confirmed_doj"] or r["stage"] in joined_or_beyond)
        rejected = sum(1 for r in rows if r["stage"] == "rejected")

        offer_to_joining_rate = round((joined / offers_released) * 100, 1) if offers_released else None

        return {
            "requests_raised": requests_raised,
            "offers_released": offers_released,
            "joined": joined,
            "rejected": rejected,
            "offer_to_joining_rate": offer_to_joining_rate,
        }

    def get_upcoming_joinings(
        self,
        tenant_id: UUID,
        role: str,
        location_id: UUID | None,
        lookahead_days: int = 7,
    ) -> list[Candidate]:
        """
        Candidates expected to join within the lookahead window who haven't
        joined yet — the dashboard's "Upcoming Joinings" section. Uses
        `expected_doj` (set at request time) rather than `confirmed_doj`
        (only set once joining is actually confirmed in Milestone 6), since
        this is meant to give HR advance visibility, not just same-day.
        """
        today = date.today()
        horizon = today + timedelta(days=lookahead_days)

        query = (
            self._db.table("candidates")
            .select("*")
            .in_("stage", ("requested", "offered", "revised"))
            .gte("expected_doj", today.isoformat())
            .lte("expected_doj", horizon.isoformat())
        )
        query = self._scope(query, tenant_id, role, location_id)
        result = query.order("expected_doj").execute()
        return [Candidate(**row) for row in result.data]

    def get_joining_today(
        self, tenant_id: UUID, role: str, location_id: UUID | None
    ) -> list[Candidate]:
        """Candidates whose expected_doj is today — what the DOJ notification is about."""
        today = date.today().isoformat()
        query = (
            self._db.table("candidates")
            .select("*")
            .in_("stage", ("requested", "offered", "revised"))
            .eq("expected_doj", today)
        )
        query = self._scope(query, tenant_id, role, location_id)
        result = query.execute()
        return [Candidate(**row) for row in result.data]

    # ------------------------------------------------------------------ #
    # Offer release (Milestone 3) — the one write path in this service
    # ------------------------------------------------------------------ #
    def release_offer(
        self,
        candidate_id: UUID,
        tenant_id: UUID,
        role: str,
        location_id: UUID | None,
        released_by_user_id: UUID,
        offer_letter_path: str | None = None,
    ) -> Candidate:
        """
        Transition a candidate from 'requested' to 'offered'.

        Deliberately narrow for Milestone 3: only the initial release is
        handled here. Revising an already-released offer is a distinct
        capability (Milestone 7 — "Hike letter + revise offer") with its
        own rules about what "revised" means for the tracker, so this
        method refuses to touch a candidate that isn't still in
        'requested' rather than silently reinterpreting a re-release as
        a revision.

        `offer_letter_path` (added in Milestone 5, optional so existing
        callers/tests that predate real document generation still work)
        is the Supabase Storage path of the actual generated document.

        Raises:
            ValueError: candidate not found / not visible to this caller,
                        or not currently in the 'requested' stage.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            raise ValueError("Candidate not found")
        if candidate.stage != "requested":
            raise ValueError(
                f"Cannot release an offer for a candidate in stage '{candidate.stage}' — "
                f"only 'requested' candidates can have their first offer released. "
                f"(Revising an already-released offer is a separate action.)"
            )

        now = datetime.now().isoformat()
        update_fields = {"stage": "offered", "offer_released_at": now}
        if offer_letter_path:
            update_fields["offer_letter_path"] = offer_letter_path

        result = (
            self._db.table("candidates")
            .update(update_fields)
            .eq("id", str(candidate_id))
            .eq("tenant_id", str(tenant_id))
            .execute()
        )
        updated = Candidate(**result.data[0])

        self._db.table("candidate_events").insert({
            "candidate_id": str(candidate_id),
            "tenant_id": str(tenant_id),
            "event_type": "offer_released",
            "performed_by": str(released_by_user_id),
            "details": {"client_name": candidate.client_name},
        }).execute()

        return updated

    # ------------------------------------------------------------------ #
    # Joining flow (Milestone 7)
    # ------------------------------------------------------------------ #
    def confirm_joining(
        self,
        candidate_id: UUID,
        confirmed_doj: str,
        tenant_id: UUID,
        role: str,
        location_id: UUID | None,
        performed_by: UUID,
    ) -> Candidate:
        """
        Mark a candidate as having actually joined. Only valid from
        'offered' or 'revised' — a candidate can't be confirmed as
        joined before an offer even went out.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            raise ValueError("Candidate not found")
        if candidate.stage not in ("offered", "revised"):
            raise ValueError(
                f"Cannot confirm joining for a candidate in stage '{candidate.stage}' — "
                f"an offer must be released first."
            )

        result = (
            self._db.table("candidates")
            .update({"stage": "joined", "confirmed_doj": confirmed_doj})
            .eq("id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .execute()
        )
        updated = Candidate(**result.data[0])

        self._db.table("candidate_events").insert({
            "candidate_id": str(candidate_id), "tenant_id": str(tenant_id),
            "event_type": "joining_confirmed", "performed_by": str(performed_by),
            "details": {"confirmed_doj": confirmed_doj},
        }).execute()

        return updated

    def assign_employee_id(
        self,
        candidate_id: UUID,
        tenant_id: UUID,
        role: str,
        location_id: UUID | None,
        performed_by: UUID,
        manual_code: str | None = None,
    ) -> Candidate:
        """
        Assign the candidate's Employee ID. Only valid from 'joined'.

        Default path: atomically pull the next number from this tenant's
        shared cross-location sequence (see `increment_employee_id()` in
        the schema — a single Postgres function guarantees no two
        locations can ever be handed the same number, even calling this
        at the exact same instant) and format it as "IB-<number>" — no
        location code embedded in the ID itself.

        `manual_code`, if given, overrides the auto-assignment entirely —
        per the explicit design requirement that this stays a human
        decision with an editable suggestion, not a forced automatic
        value. A manually-entered code still has to be unique.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            raise ValueError("Candidate not found")
        if candidate.stage != "joined":
            raise ValueError(
                f"Cannot assign an Employee ID for a candidate in stage '{candidate.stage}' — "
                f"joining must be confirmed first."
            )

        if manual_code:
            code = manual_code.strip().upper()
            existing = (
                self._db.table("candidates").select("id")
                .eq("tenant_id", str(tenant_id)).eq("employee_id", code)
                .maybe_single().execute()
            )
            if safe_data(existing):
                raise ValueError(f"Employee ID '{code}' is already in use.")
            is_auto = False
        else:
            rpc_result = self._db.rpc("increment_employee_id", {"p_tenant_id": str(tenant_id)}).execute()
            next_number = rpc_result.data
            code = f"IB-{next_number}"
            is_auto = True

        result = (
            self._db.table("candidates")
            .update({"stage": "id_assigned", "employee_id": code, "employee_id_auto": is_auto})
            .eq("id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .execute()
        )
        updated = Candidate(**result.data[0])

        self._db.table("candidate_events").insert({
            "candidate_id": str(candidate_id), "tenant_id": str(tenant_id),
            "event_type": "employee_id_assigned", "performed_by": str(performed_by),
            "details": {"employee_id": code, "auto_assigned": is_auto},
        }).execute()

        return updated

    def release_appointment(
        self,
        candidate_id: UUID,
        tenant_id: UUID,
        role: str,
        location_id: UUID | None,
        performed_by: UUID,
        appointment_letter_path: str,
    ) -> Candidate:
        """
        Release the Appointment Letter and transition to 'active' — the
        point a candidate becomes a real employee, per the designed
        workflow ("once appointment letter is shared it then should move
        to master data"). Only valid from 'id_assigned', for the same
        reason release_offer only accepts 'requested': the Employee ID
        has to exist before an appointment letter referencing it can
        make sense.

        Like release_offer, the caller (the API endpoint) generates the
        actual document BEFORE calling this — this method only performs
        the state transition once a real `appointment_letter_path`
        already exists, keeping the same fail-closed guarantee.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            raise ValueError("Candidate not found")
        if candidate.stage != "id_assigned":
            raise ValueError(
                f"Cannot release the appointment letter for a candidate in stage "
                f"'{candidate.stage}' — an Employee ID must be assigned first."
            )

        now = datetime.now().isoformat()
        result = (
            self._db.table("candidates")
            .update({
                "stage": "active",
                "appointment_released_at": now,
                "appointment_letter_path": appointment_letter_path,
            })
            .eq("id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .execute()
        )
        updated = Candidate(**result.data[0])

        self._db.table("candidate_events").insert({
            "candidate_id": str(candidate_id), "tenant_id": str(tenant_id),
            "event_type": "appointment_released", "performed_by": str(performed_by),
            "details": {"employee_id": candidate.employee_id},
        }).execute()

        return updated

    def create_document_request_token(self, candidate_id: UUID, tenant_id: UUID) -> str:
        """
        Creates a one-time link for the candidate to submit their own
        documents — sent right after the Appointment Letter, per the
        designed workflow. The token itself is generated by the database
        (see `document_request_tokens.token`'s DEFAULT in the schema, a
        cryptographically random value) — this method never invents one
        in application code.
        """
        result = self._db.table("document_request_tokens").insert({
            "tenant_id": str(tenant_id), "candidate_id": str(candidate_id),
        }).execute()
        token = result.data[0]["token"]

        self._db.table("candidate_events").insert({
            "candidate_id": str(candidate_id), "tenant_id": str(tenant_id),
            "event_type": "documents_link_sent", "performed_by": None,
            "details": {},
        }).execute()
        self._db.table("candidates").update({"documents_link_sent_at": datetime.now().isoformat()}) \
            .eq("id", str(candidate_id)).eq("tenant_id", str(tenant_id)).execute()

        return token

    # ------------------------------------------------------------------ #
    # Exit flow (Milestone 8)
    # ------------------------------------------------------------------ #
    def log_resignation(
        self,
        candidate_id: UUID,
        resignation_date: str,
        last_working_day: str,
        tenant_id: UUID,
        role: str,
        location_id: UUID | None,
        performed_by: UUID,
    ) -> Candidate:
        """
        Log a resignation or layoff. Only valid from 'active' — an exit
        can't be logged for someone who was never actually active.
        The LWD intimation email itself is sent by the caller (the API
        endpoint), same division of responsibility as release_offer:
        this method only performs the state transition and event log.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            raise ValueError("Candidate not found")
        if candidate.stage != "active":
            raise ValueError(
                f"Cannot log a resignation for a candidate in stage '{candidate.stage}' — "
                f"only an active employee can resign or be laid off."
            )

        result = (
            self._db.table("candidates")
            .update({
                "stage": "resigned",
                "resignation_date": resignation_date,
                "last_working_day": last_working_day,
            })
            .eq("id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .execute()
        )
        updated = Candidate(**result.data[0])

        self._db.table("candidate_events").insert({
            "candidate_id": str(candidate_id), "tenant_id": str(tenant_id),
            "event_type": "resignation_logged", "performed_by": str(performed_by),
            "details": {"resignation_date": resignation_date, "last_working_day": last_working_day},
        }).execute()
        self._db.table("candidate_events").insert({
            "candidate_id": str(candidate_id), "tenant_id": str(tenant_id),
            "event_type": "lwd_set", "performed_by": str(performed_by),
            "details": {"last_working_day": last_working_day},
        }).execute()

        return updated

    def mark_clearance_received(
        self,
        candidate_id: UUID,
        clearance_date: str,
        tenant_id: UUID,
        role: str,
        location_id: UUID | None,
        performed_by: UUID,
    ) -> Candidate:
        """
        Records that the Client has confirmed clearance — a manual
        checkbox HR ticks based on being told separately (not something
        this system verifies on its own). This is the gate
        `release_relieving` checks before allowing the relieving letter
        to go out. Only valid from 'resigned'.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            raise ValueError("Candidate not found")
        if candidate.stage != "resigned":
            raise ValueError(
                f"Cannot mark clearance for a candidate in stage '{candidate.stage}' — "
                f"a resignation must be logged first."
            )

        result = (
            self._db.table("candidates")
            .update({"clearance_received": True, "clearance_date": clearance_date})
            .eq("id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .execute()
        )
        updated = Candidate(**result.data[0])

        self._db.table("candidate_events").insert({
            "candidate_id": str(candidate_id), "tenant_id": str(tenant_id),
            "event_type": "clearance_received", "performed_by": str(performed_by),
            "details": {"clearance_date": clearance_date},
        }).execute()

        return updated

    def release_relieving(
        self,
        candidate_id: UUID,
        tenant_id: UUID,
        role: str,
        location_id: UUID | None,
        performed_by: UUID,
        relieving_letter_path: str,
    ) -> Candidate:
        """
        Release the Relieving Letter and move to the terminal 'exited'
        stage. Gated on `clearance_received` — per the designed workflow,
        clearance from the Client has to come in BEFORE the letter is
        released, not just before this method is called; the check
        itself lives here rather than only in the API layer, so no
        future caller can bypass it by skipping a UI step.

        Same fail-closed division as release_offer/release_appointment:
        the caller generates the document first and only calls this once
        it has a real path — but the clearance check happens here,
        independent of that, since clearance is a business rule about
        readiness to release, not a fact about whether generation itself
        succeeded.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            raise ValueError("Candidate not found")
        if candidate.stage != "resigned":
            raise ValueError(
                f"Cannot release the relieving letter for a candidate in stage "
                f"'{candidate.stage}' — a resignation must be logged first."
            )
        if not candidate.clearance_received:
            raise ValueError(
                "Cannot release the relieving letter — clearance has not been received "
                "from the Client yet. Mark clearance received first."
            )

        now = datetime.now().isoformat()
        result = (
            self._db.table("candidates")
            .update({
                "stage": "exited",
                "relieving_released_at": now,
                "relieving_letter_path": relieving_letter_path,
            })
            .eq("id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .execute()
        )
        updated = Candidate(**result.data[0])

        self._db.table("candidate_events").insert({
            "candidate_id": str(candidate_id), "tenant_id": str(tenant_id),
            "event_type": "relieving_released", "performed_by": str(performed_by),
            "details": {"employee_id": candidate.employee_id},
        }).execute()

        return updated

    def get_pending_relieving_reminders(
        self, tenant_id: UUID, reminder_days: int = 20
    ) -> list[Candidate]:
        """
        Candidates whose Last Working Day was at least `reminder_days`
        ago, still in 'resigned' (relieving letter not yet released) —
        what the scheduled reminder job checks daily. Tenant-wide (no
        role/location scoping) since this is called from a background
        job, not on behalf of any particular logged-in user.
        """
        from datetime import date, timedelta
        cutoff = (date.today() - timedelta(days=reminder_days)).isoformat()

        result = (
            self._db.table("candidates")
            .select("*")
            .eq("tenant_id", str(tenant_id))
            .eq("stage", "resigned")
            .lte("last_working_day", cutoff)
            .execute()
        )
        return [Candidate(**row) for row in result.data]

    # ------------------------------------------------------------------ #
    # Revise offer (Milestone 9)
    # ------------------------------------------------------------------ #
    def revise_offer(
        self,
        candidate_id: UUID,
        tenant_id: UUID,
        role: str,
        location_id: UUID | None,
        performed_by: UUID,
        offer_letter_path: str,
        proposed_ctc: float | None = None,
        expected_doj: str | None = None,
        designation: str | None = None,
        department: str | None = None,
        work_location: str | None = None,
    ) -> Candidate:
        """
        Revise an already-released offer. Valid from 'offered' or
        'revised' itself (a revision can be revised again) — per the
        explicit design decision, this OVERWRITES the candidate's
        current terms and tags the record "Revised" rather than keeping
        separate old/new versions, unlike CTC structures (which are
        versioned) or hike letters (which are an append-only log). Only
        the fields actually provided are changed; anything left as None
        keeps its current value.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            raise ValueError("Candidate not found")
        if candidate.stage not in ("offered", "revised"):
            raise ValueError(
                f"Cannot revise an offer for a candidate in stage '{candidate.stage}' — "
                f"an offer must already have been released."
            )

        now = datetime.now().isoformat()
        update_fields: dict = {
            "stage": "revised", "is_revised": True,
            "offer_released_at": now, "offer_letter_path": offer_letter_path,
        }
        if proposed_ctc is not None:
            update_fields["proposed_ctc"] = proposed_ctc
        if expected_doj is not None:
            update_fields["expected_doj"] = expected_doj
        if designation is not None:
            update_fields["designation"] = designation
        if department is not None:
            update_fields["department"] = department
        if work_location is not None:
            update_fields["work_location"] = work_location

        result = (
            self._db.table("candidates")
            .update(update_fields)
            .eq("id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .execute()
        )
        updated = Candidate(**result.data[0])

        self._db.table("candidate_events").insert({
            "candidate_id": str(candidate_id), "tenant_id": str(tenant_id),
            "event_type": "offer_revised", "performed_by": str(performed_by),
            "details": {k: v for k, v in {
                "proposed_ctc": proposed_ctc, "expected_doj": expected_doj,
                "designation": designation, "department": department,
                "work_location": work_location,
            }.items() if v is not None},
        }).execute()

        return updated

    # ------------------------------------------------------------------ #
    # Direct HR actions on requests (edit, delete, create, reject)
    # ------------------------------------------------------------------ #
    def update_candidate(
        self, candidate_id: UUID, tenant_id: UUID, role: str, location_id: UUID | None,
        updates: dict,
    ) -> Candidate:
        """
        Edit a request's own details. Only valid from 'requested' — once
        an offer has gone out, changing terms goes through revise_offer
        instead, which has its own overwrite-and-tag-"Revised" semantics
        and re-generates the actual letter. Editing here never touches a
        letter that's already been sent.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            raise ValueError("Candidate not found")
        if candidate.stage != "requested":
            raise ValueError(
                f"Cannot edit a candidate in stage '{candidate.stage}' — only requests "
                f"still in 'requested' stage can be edited directly. Once an offer is "
                f"released, use Revise Offer instead."
            )
        if not updates:
            return candidate

        result = (
            self._db.table("candidates").update(updates)
            .eq("id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .execute()
        )
        return Candidate(**result.data[0])

    def delete_candidate(
        self, candidate_id: UUID, tenant_id: UUID, role: str, location_id: UUID | None,
    ) -> None:
        """
        Permanently removes a request. Only valid from 'requested' — once
        anything real has happened (an offer went out, a document was
        generated), deleting the record would destroy genuine history;
        reject_offer is the right action for an offer that didn't work
        out, not deletion.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            raise ValueError("Candidate not found")
        if candidate.stage != "requested":
            raise ValueError(
                f"Cannot delete a candidate in stage '{candidate.stage}' — only requests "
                f"still in 'requested' stage can be deleted. Use Reject for an offer that "
                f"didn't work out, to keep the record as history."
            )
        self._db.table("candidates").delete() \
            .eq("id", str(candidate_id)).eq("tenant_id", str(tenant_id)).execute()

    def create_candidate_direct(
        self, data, tenant_id: UUID, location_id: UUID, created_by: UUID,
    ) -> Candidate:
        """
        HR creating a request directly — bypassing the public Account
        Manager form for internal hires, walk-ins, or anything with no
        external AM involved. Automatically owned by the HR who created
        it (hr_owner_id), same as a routed public request would be.
        """
        insert_data = {
            "tenant_id": str(tenant_id), "location_id": str(location_id),
            "hr_owner_id": str(created_by),
            "account_manager_id": str(data.account_manager_id) if data.account_manager_id else None,
            "recruiter_id": str(data.recruiter_id) if data.recruiter_id else None,
            "client_name": data.client_name, "full_name": data.full_name, "email": data.email,
            "phone": data.phone, "designation": data.designation, "department": data.department,
            "work_location": data.work_location,
            "proposed_ctc": data.proposed_ctc,
            "expected_doj": data.expected_doj.isoformat() if data.expected_doj else None,
            "pf_type": data.pf_type,
        }
        result = self._db.table("candidates").insert(insert_data).execute()
        candidate_row = result.data[0]

        self._db.table("candidate_events").insert({
            "candidate_id": candidate_row["id"], "tenant_id": str(tenant_id),
            "event_type": "request_raised", "performed_by": str(created_by),
            "details": {"source": "hr_direct"},
        }).execute()

        return Candidate(**candidate_row)

    def reject_offer(
        self, candidate_id: UUID, tenant_id: UUID, role: str, location_id: UUID | None,
        performed_by: UUID, reason: str | None = None,
    ) -> Candidate:
        """
        Revoke/decline an already-released offer — the candidate turned
        it down, or it was released in error. Only valid from 'offered'
        or 'revised'; moves to the terminal 'rejected' stage. Unlike
        delete_candidate, this preserves the full history of what was
        offered — appropriate once a real letter has actually gone out.
        """
        candidate = self.get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            raise ValueError("Candidate not found")
        if candidate.stage not in ("offered", "revised"):
            raise ValueError(
                f"Cannot reject a candidate in stage '{candidate.stage}' — only an "
                f"already-released offer ('offered' or 'revised') can be rejected."
            )

        result = (
            self._db.table("candidates").update({"stage": "rejected"})
            .eq("id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .execute()
        )
        updated = Candidate(**result.data[0])

        self._db.table("candidate_events").insert({
            "candidate_id": str(candidate_id), "tenant_id": str(tenant_id),
            "event_type": "rejected", "performed_by": str(performed_by),
            "details": {"reason": reason} if reason else {},
        }).execute()

        return updated
