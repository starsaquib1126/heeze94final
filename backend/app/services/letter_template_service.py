"""
Letter Template Service — Milestone 4 (block editor content, not yet
compiled to .docx — that's Milestone 5's job once actual generation
exists).

Templates are stored as a JSON array of blocks: Heading, Paragraph
(with inline placeholder chips), BulletList, NumberedList, CtcTable
marker, and Signature. See docs/block-schema.md for the exact shape
each block type must have.

Placeholder scanning walks the blocks looking for `{{placeholder}}`
tokens inside paragraph text (however they got there — a chip renders
as this exact text in the stored block) so the editor's "mark
mandatory" review step can show the admin everything the letter
actually references, without the admin having to remember to list them
separately.
"""

from __future__ import annotations

import re
from uuid import UUID

from app.db.client import get_service_db, safe_data
from app.models.user import LetterTemplate, LetterTemplateCreate

_PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")

# Placeholders every template can resolve without any admin configuration —
# used to tell the editor which detected placeholders are "recognized"
# (auto-filled from employee/candidate data) vs. custom ones that need a
# mandatory flag or a default value.
KNOWN_PLACEHOLDERS = {
    "employee_name", "employee_code", "email", "phone", "department", "designation",
    "client", "manager", "recruiter", "doj", "status", "company_name", "today_date",
    "current_ctc", "current_ctc_in_words", "revised_ctc", "revised_ctc_in_words",
    "effective_date", "new_designation", "last_working_day", "confirmation_date", "reason",
    "location", "ref_no", "offer_ref_date", "period_from", "period_to",
    "ctc_breakup_table",  # special marker, not a text placeholder, but scanned the same way
}


def extract_placeholders(blocks: list[dict]) -> set[str]:
    """
    Walk every block's text content and collect every `{{placeholder}}`
    token found. Handles Paragraph blocks (text may be split across
    multiple "runs" for bold/italic spans) and List blocks (one entry
    per list item) — Heading, CtcTable, and Signature blocks either have
    no free text or are handled as fixed special cases, not scanned.
    """
    found: set[str] = set()

    def scan_text(text: str) -> None:
        found.update(_PLACEHOLDER_PATTERN.findall(text))

    for block in blocks:
        block_type = block.get("type")
        if block_type in ("paragraph", "heading"):
            for run in block.get("runs", []):
                scan_text(run.get("text", ""))
        elif block_type in ("bulletList", "numberedList"):
            for item in block.get("items", []):
                for run in item.get("runs", []):
                    scan_text(run.get("text", ""))
        elif block_type == "ctcTable":
            found.add("ctc_breakup_table")
        # signature and spacer blocks have no scannable text

    return found


class LetterTemplateService:
    def __init__(self) -> None:
        self._db = get_service_db()

    def list_templates(self, tenant_id: UUID) -> list[LetterTemplate]:
        """
        Templates are tenant-wide (shared across all of a tenant's
        locations, per the design decision that branding/content only
        varies per client, not per location) — no location scoping here,
        unlike candidates and CTC structures.
        """
        result = (
            self._db.table("letter_templates")
            .select("*")
            .eq("tenant_id", str(tenant_id))
            .order("letter_type")
            .execute()
        )
        return [LetterTemplate(**row) for row in result.data]

    def get_template(self, template_id: UUID, tenant_id: UUID) -> LetterTemplate | None:
        result = (
            self._db.table("letter_templates")
            .select("*")
            .eq("id", str(template_id))
            .eq("tenant_id", str(tenant_id))
            .maybe_single()
            .execute()
        )
        result_data = safe_data(result)
        return LetterTemplate(**result_data) if result_data else None

    def get_active_template(self, letter_type: str, tenant_id: UUID) -> LetterTemplate | None:
        result = (
            self._db.table("letter_templates")
            .select("*")
            .eq("letter_type", letter_type)
            .eq("tenant_id", str(tenant_id))
            .eq("is_active", True)
            .maybe_single()
            .execute()
        )
        result_data = safe_data(result)
        return LetterTemplate(**result_data) if result_data else None

    def create_template(
        self, data: LetterTemplateCreate, tenant_id: UUID, created_by: UUID,
    ) -> LetterTemplate:
        """
        Validates that every mandatory placeholder the admin flagged is
        actually referenced somewhere in the blocks — flagging a
        placeholder as mandatory that the letter never uses would be a
        silent no-op that looks like it did something.
        """
        found = extract_placeholders(data.blocks)
        unreferenced_mandatory = set(data.mandatory_placeholders) - found
        if unreferenced_mandatory:
            raise ValueError(
                f"These placeholders were marked mandatory but aren't used anywhere in "
                f"the letter content: {', '.join(sorted(unreferenced_mandatory))}"
            )

        # Only one active template per (letter_type, tenant) — creating a
        # new one deactivates any existing active template of the same type,
        # mirroring how the desktop app's Template Manager worked.
        self._db.table("letter_templates").update({"is_active": False}) \
            .eq("tenant_id", str(tenant_id)).eq("letter_type", data.letter_type) \
            .eq("is_active", True).execute()

        result = (
            self._db.table("letter_templates")
            .insert({
                "tenant_id": str(tenant_id),
                "letter_type": data.letter_type,
                "name": data.name,
                "blocks": data.blocks,
                "mandatory_placeholders": data.mandatory_placeholders,
                "custom_placeholder_defaults": data.custom_placeholder_defaults,
                "is_active": True,
                "version": 1,
                "created_by": str(created_by),
            })
            .execute()
        )
        return LetterTemplate(**result.data[0])

    def scan_placeholders(self, blocks: list[dict]) -> dict[str, list[str]]:
        """Used by the editor's "review before saving" step — splits
        whatever placeholders are in the content into recognized
        (auto-filled) vs custom (need a default or a mandatory flag)."""
        found = extract_placeholders(blocks)
        return {
            "recognized": sorted(found & KNOWN_PLACEHOLDERS),
            "custom": sorted(found - KNOWN_PLACEHOLDERS),
        }

    def set_active(self, template_id: UUID, tenant_id: UUID) -> LetterTemplate:
        """Revert to a previous version — deactivates whatever's currently
        active for that letter_type and activates this one instead."""
        target = self.get_template(template_id, tenant_id)
        if target is None:
            raise ValueError("Template not found")

        self._db.table("letter_templates").update({"is_active": False}) \
            .eq("tenant_id", str(tenant_id)).eq("letter_type", target.letter_type).execute()
        self._db.table("letter_templates").update({"is_active": True}) \
            .eq("id", str(template_id)).eq("tenant_id", str(tenant_id)).execute()

        return self.get_template(template_id, tenant_id)

    def delete_template(self, template_id: UUID, tenant_id: UUID) -> None:
        self._db.table("letter_templates").delete() \
            .eq("id", str(template_id)).eq("tenant_id", str(tenant_id)).execute()


class BrandingService:
    """Logo + signature — one set per tenant, per the design decision
    that these don't vary by location."""

    def __init__(self) -> None:
        self._db = get_service_db()

    def get_branding(self, tenant_id: UUID) -> dict:
        result = (
            self._db.table("tenant_branding")
            .select("*")
            .eq("tenant_id", str(tenant_id))
            .maybe_single()
            .execute()
        )
        # `.maybe_single().execute()` returns None outright (not an object
        # with `.data = None`) on the currently deployed library version,
        # when zero rows match — the exact real-world case of a tenant
        # that has never uploaded branding before. `result.data` alone
        # would crash with AttributeError here.
        data = safe_data(result)
        return data or {"tenant_id": str(tenant_id), "logo_storage_path": None, "signature_storage_path": None}

    def set_logo_path(self, tenant_id: UUID, storage_path: str) -> None:
        self._upsert(tenant_id, {"logo_storage_path": storage_path})

    def set_signature_path(self, tenant_id: UUID, storage_path: str) -> None:
        self._upsert(tenant_id, {"signature_storage_path": storage_path})

    def _upsert(self, tenant_id: UUID, fields: dict) -> None:
        existing = (
            self._db.table("tenant_branding")
            .select("tenant_id")
            .eq("tenant_id", str(tenant_id))
            .maybe_single()
            .execute()
        )
        existing_data = safe_data(existing)
        if existing_data:
            self._db.table("tenant_branding").update(fields).eq("tenant_id", str(tenant_id)).execute()
        else:
            self._db.table("tenant_branding").insert({"tenant_id": str(tenant_id), **fields}).execute()
