"""
Document Service — HR-facing viewing/download of candidate documents,
and the yearly ZIP archival job.

Per the explicit design decision, the yearly ZIP is a BACKUP, not a
replacement: originals stay individually viewable/downloadable in the
candidate's record forever. Archiving only ever adds a bundled copy
alongside them — it never removes or hides anything. `is_archived`
tracks whether a document has already been included in some year's
ZIP, purely so re-running the archive job doesn't re-bundle documents
that are already backed up.

Financial year convention: April to March (e.g. "2026-27" runs
1 Apr 2026 - 31 Mar 2027), matching the convention already used in
this project's CTC calculations.
"""

from __future__ import annotations

import zipfile
from datetime import date, datetime
from io import BytesIO
from uuid import UUID

from app.core.config import get_settings
from app.db.client import get_service_db, safe_data
from app.models.user import CandidateDocument


def financial_year_for_date(d: date) -> str:
    """April-March financial year label, e.g. 2026-04-15 -> '2026-27',
    2027-02-01 -> '2026-27', 2027-04-01 -> '2027-28'."""
    if d.month >= 4:
        start_year = d.year
    else:
        start_year = d.year - 1
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def previous_financial_year(today: date) -> str:
    """The FY that just ended, as of `today` — used by the archive job,
    which runs at the start of a new FY to bundle up the one that just
    closed."""
    current_fy_start = today.year if today.month >= 4 else today.year - 1
    previous_fy_start = current_fy_start - 1
    return f"{previous_fy_start}-{str(previous_fy_start + 1)[-2:]}"


class DocumentService:
    def __init__(self) -> None:
        self._db = get_service_db()
        self._settings = get_settings()

    # ------------------------------------------------------------------ #
    # HR-facing viewing
    # ------------------------------------------------------------------ #
    def list_documents(
        self, candidate_id: UUID, tenant_id: UUID, role: str, location_id: UUID | None,
    ) -> list[CandidateDocument]:
        """Same visibility rule as everything else candidate-scoped: the
        candidate itself must be visible to this caller first."""
        from app.services.candidate_service import CandidateService
        candidate = CandidateService().get_candidate(candidate_id, tenant_id, role, location_id)
        if candidate is None:
            return []

        result = (
            self._db.table("candidate_documents").select("*")
            .eq("candidate_id", str(candidate_id)).eq("tenant_id", str(tenant_id))
            .order("uploaded_at", desc=True).execute()
        )
        return [CandidateDocument(**row) for row in result.data]

    def get_download_url(
        self, document_id: UUID, tenant_id: UUID, role: str, location_id: UUID | None,
    ) -> str | None:
        doc_result = (
            self._db.table("candidate_documents").select("*")
            .eq("id", str(document_id)).eq("tenant_id", str(tenant_id))
            .maybe_single().execute()
        )
        doc_data = safe_data(doc_result)
        if not doc_data:
            return None

        from app.services.candidate_service import CandidateService
        candidate = CandidateService().get_candidate(
            UUID(doc_data["candidate_id"]), tenant_id, role, location_id
        )
        if candidate is None:
            return None  # document exists but caller can't see its candidate

        signed = self._db.storage.from_(self._settings.storage_bucket).create_signed_url(
            doc_data["storage_path"], 300
        )
        return signed.get("signedURL") or signed.get("signedUrl")

    # ------------------------------------------------------------------ #
    # Yearly archive (backup, not replacement — see module docstring)
    # ------------------------------------------------------------------ #
    def generate_yearly_archive(
        self, tenant_id: UUID, location_id: UUID, financial_year: str,
    ) -> str | None:
        """
        Bundles every not-yet-archived document belonging to candidates
        at this location, uploaded during `financial_year`, into one ZIP
        — uploaded to storage, originals left untouched. Returns the
        ZIP's storage path, or None if there was nothing to archive
        (e.g. re-running for a location/year with no pending documents).
        """
        candidates_result = (
            self._db.table("candidates").select("id")
            .eq("tenant_id", str(tenant_id)).eq("location_id", str(location_id)).execute()
        )
        candidate_ids = [row["id"] for row in candidates_result.data]
        if not candidate_ids:
            return None

        docs_result = (
            self._db.table("candidate_documents").select("*")
            .in_("candidate_id", candidate_ids)
            .eq("financial_year", financial_year).eq("is_archived", False)
            .execute()
        )
        documents = docs_result.data
        if not documents:
            return None

        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for doc in documents:
                try:
                    file_bytes = self._db.storage.from_(self._settings.storage_bucket).download(doc["storage_path"])
                    # Namespaced by candidate so files with the same name
                    # across different candidates don't collide inside the zip.
                    arcname = f"{doc['candidate_id']}/{doc['document_type']}_{doc['original_name']}"
                    zf.writestr(arcname, file_bytes)
                except Exception:
                    continue  # a single missing/corrupt file must not abort the whole archive

        timestamp = datetime.now().strftime("%Y%m%d")
        zip_storage_path = f"{tenant_id}/archives/{location_id}/{financial_year}_{timestamp}.zip"
        self._db.storage.from_(self._settings.storage_bucket).upload(
            zip_storage_path, zip_buffer.getvalue(), {"content-type": "application/zip"},
        )

        doc_ids = [doc["id"] for doc in documents]
        self._db.table("candidate_documents").update({
            "is_archived": True, "archived_zip_path": zip_storage_path,
        }).in_("id", doc_ids).execute()

        return zip_storage_path
