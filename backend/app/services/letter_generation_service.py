"""
Letter Generation Service — orchestrates Milestone 5's actual document
production: resolves a candidate's data + the tenant's active template
+ (if needed) a CTC structure, compiles a real .docx via
document_generator.py, uploads it to Supabase Storage, and returns the
storage path.

This is intentionally a thin coordination layer — all the actual
compilation logic lives in document_generator.py (pure, easily testable
with plain dicts) and ctc_engine.py (already tested extensively). This
service's only job is fetching the right rows and bytes, and writing
the result back.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.core.config import get_settings
from app.db.client import get_service_db, safe_data
from app.models.candidate_context import LetterGenerationContext
from app.services.ctc_engine import LineItemInput, evaluate_structure
from app.services.ctc_structure_service import CTCStructureService
from app.services.document_generator import generate_docx
from app.services.letter_template_service import LetterTemplateService
from app.services.placeholder_resolver import build_placeholder_data


class LetterGenerationService:
    def __init__(self) -> None:
        self._db = get_service_db()
        self._settings = get_settings()

    def generate_for_candidate(
        self,
        candidate_id: UUID,
        letter_type: str,
        tenant_id: UUID,
        context: LetterGenerationContext,
        ctc_structure_id: UUID | None = None,
        role: str = "hr",
        location_id: UUID | None = None,
    ) -> str:
        """
        Generates a letter for a candidate and returns the Supabase
        Storage path it was uploaded to. Raises ValueError for anything
        that should surface as a 400 to the caller (no active template,
        candidate not found, missing CTC structure when required).
        """
        candidate_result = (
            self._db.table("candidates").select("*").eq("id", str(candidate_id))
            .eq("tenant_id", str(tenant_id)).maybe_single().execute()
        )
        candidate_data = safe_data(candidate_result)
        if not candidate_data:
            raise ValueError("Candidate not found")

        template = LetterTemplateService().get_active_template(letter_type, tenant_id)
        if template is None:
            raise ValueError(f"No active '{letter_type}' letter template configured for this company")

        tenant_result = self._db.table("tenants").select("name").eq("id", str(tenant_id)).maybe_single().execute()
        tenant_data = safe_data(tenant_result)
        company_name = tenant_data["name"] if tenant_data else ""

        placeholder_data = build_placeholder_data(candidate_data, context, company_name)

        ctc_computed_items = None
        if ctc_structure_id:
            structure = CTCStructureService().get_structure(ctc_structure_id, tenant_id, role, location_id)
            if structure is None:
                raise ValueError("CTC structure not found")
            line_item_inputs = [
                LineItemInput(
                    key=i.key, label=i.label, section=i.section, formula=i.formula,
                    guided_type=i.guided_type, guided_params=i.guided_params,
                    display_text=i.display_text, is_subtotal=i.is_subtotal,
                    spacer_after=i.spacer_after, order=i.item_order,
                )
                for i in structure.line_items
            ]
            annual_ctc = (
                context.revised_ctc_override
                if context.revised_ctc_override is not None
                else candidate_data.get("proposed_ctc") or 0
            )
            ctc_computed_items = evaluate_structure(
                line_item_inputs, annual_ctc=annual_ctc, location=context.location or "",
                pf_type=candidate_data.get("pf_type") or "standard",
            )

        branding_result = (
            self._db.table("tenant_branding").select("*").eq("tenant_id", str(tenant_id))
            .maybe_single().execute()
        )
        branding_data = safe_data(branding_result)
        logo_bytes = None
        signature_bytes = None
        if branding_data:
            if branding_data.get("logo_storage_path"):
                logo_bytes = self._download(branding_data["logo_storage_path"])
            if branding_data.get("signature_storage_path"):
                signature_bytes = self._download(branding_data["signature_storage_path"])

        # Merge the template's custom placeholder defaults UNDER the caller's
        # own context.extra, so the admin's fallback default is used unless
        # this specific generation explicitly overrides it.
        merged_data = {**template.custom_placeholder_defaults, **placeholder_data}

        docx_bytes = generate_docx(
            blocks=template.blocks,
            placeholder_data=merged_data,
            mandatory_placeholders=template.mandatory_placeholders,
            ctc_computed_items=ctc_computed_items,
            logo_bytes=logo_bytes,
            signature_bytes=signature_bytes,
            letter_type=letter_type,
        )

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        storage_path = f"{tenant_id}/candidates/{candidate_id}/{letter_type}_{timestamp}.docx"
        self._db.storage.from_(self._settings.storage_bucket).upload(
            storage_path, docx_bytes,
            {"content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
        )
        return storage_path

    def _download(self, storage_path: str) -> bytes | None:
        try:
            return self._db.storage.from_(self._settings.storage_bucket).download(storage_path)
        except Exception:
            return None
