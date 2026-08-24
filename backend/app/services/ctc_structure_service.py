"""
CTC Structure Service — Milestone 4.

Owns the database side of the CTC Structure Builder: creating/versioning
structures, cloning across locations, and evaluating a structure against
a sample CTC for the live-test panel.

Versioning rule, as designed: editing an already-used structure never
overwrites it — it creates a new version and marks it `is_current`,
leaving old versions in place so historical offers stay tied to the
formula that was actually in effect when they were issued.
"""

from __future__ import annotations

from uuid import UUID

from app.db.client import get_service_db, safe_data
from app.models.user import CTCLineItem, CTCLineItemCreate, CTCStructure, CTCStructureCreate
from app.services.ctc_engine import ComputedLineItem, LineItemInput, evaluate_structure


class CTCStructureService:
    def __init__(self) -> None:
        self._db = get_service_db()

    # ------------------------------------------------------------------ #
    def _scope_to_location(self, query, tenant_id: UUID, role: str, location_id: UUID | None):
        """Same access rule as candidates: Super User sees every location
        in the tenant, HR sees only their own."""
        query = query.eq("tenant_id", str(tenant_id))
        if role == "hr":
            if location_id is None:
                raise ValueError("HR user has no location_id assigned — cannot scope query")
            query = query.eq("location_id", str(location_id))
        return query

    def list_structures(
        self, tenant_id: UUID, role: str, location_id: UUID | None,
        location_filter: UUID | None = None,
    ) -> list[CTCStructure]:
        """Lists only the CURRENT version of each structure — old versions
        are reachable via get_structure() by ID for historical reference,
        but never show up in the main list."""
        query = self._db.table("ctc_structures").select("*").eq("is_current", True)
        query = self._scope_to_location(query, tenant_id, role, location_id)
        if location_filter:
            query = query.eq("location_id", str(location_filter))
        result = query.order("name").execute()
        return [self._hydrate(row) for row in result.data]

    def get_structure(
        self, structure_id: UUID, tenant_id: UUID, role: str, location_id: UUID | None
    ) -> CTCStructure | None:
        query = self._db.table("ctc_structures").select("*").eq("id", str(structure_id))
        query = self._scope_to_location(query, tenant_id, role, location_id)
        result = query.maybe_single().execute()
        result_data = safe_data(result)
        return self._hydrate(result_data) if result_data else None

    def _hydrate(self, row: dict) -> CTCStructure:
        items_result = (
            self._db.table("ctc_line_items")
            .select("*")
            .eq("structure_id", row["id"])
            .order("item_order")
            .execute()
        )
        line_items = [CTCLineItem(**item) for item in items_result.data]
        return CTCStructure(**row, line_items=line_items)

    # ------------------------------------------------------------------ #
    # Create / version / clone
    # ------------------------------------------------------------------ #
    def create_structure(
        self, data: CTCStructureCreate, tenant_id: UUID, role: str, location_id: UUID | None,
        created_by: UUID,
    ) -> CTCStructure:
        """Create a brand-new structure (version 1) for a location."""
        # HR can only create structures for their own location; Super User can
        # create for any location in the tenant.
        if role == "hr" and location_id != data.location_id:
            raise ValueError("HR can only create CTC structures for their own location")

        struct_result = (
            self._db.table("ctc_structures")
            .insert({
                "tenant_id": str(tenant_id),
                "location_id": str(data.location_id),
                "name": data.name,
                "version": 1,
                "is_current": True,
                "created_by": str(created_by),
            })
            .execute()
        )
        structure_row = struct_result.data[0]
        self._insert_line_items(structure_row["id"], data.line_items)
        return self._hydrate(structure_row)

    def update_structure(
        self, structure_id: UUID, data: CTCStructureCreate,
        tenant_id: UUID, role: str, location_id: UUID | None, created_by: UUID,
    ) -> CTCStructure:
        """
        "Editing" a structure never mutates the existing row — it creates
        a new version, marks the old one not-current, and the new one
        current. This is what keeps a historical offer's CTC breakup tied
        to the formula that produced it, even after the policy changes.
        """
        existing = self.get_structure(structure_id, tenant_id, role, location_id)
        if existing is None:
            raise ValueError("CTC structure not found")
        if role == "hr" and location_id != existing.location_id:
            raise ValueError("HR can only edit CTC structures for their own location")

        self._db.table("ctc_structures").update({"is_current": False}) \
            .eq("id", str(structure_id)).eq("tenant_id", str(tenant_id)).execute()

        new_version_result = (
            self._db.table("ctc_structures")
            .insert({
                "tenant_id": str(tenant_id),
                "location_id": str(existing.location_id),
                "name": data.name,
                "version": existing.version + 1,
                "is_current": True,
                "cloned_from_id": str(structure_id),
                "created_by": str(created_by),
            })
            .execute()
        )
        new_row = new_version_result.data[0]
        self._insert_line_items(new_row["id"], data.line_items)
        return self._hydrate(new_row)

    def clone_structure(
        self, structure_id: UUID, new_name: str, target_location_id: UUID,
        tenant_id: UUID, role: str, location_id: UUID | None, created_by: UUID,
    ) -> CTCStructure:
        """
        Clone an existing structure (any version) as the starting point
        for a new one — typically used to carry "Basic = 50% of CTC,
        HRA = 40% of Basic, ..." across to a new location, with only the
        location-specific piece (e.g. Professional Tax slabs) needing to
        actually change afterward.
        """
        source = self.get_structure(structure_id, tenant_id, role, location_id)
        if source is None:
            raise ValueError("Source CTC structure not found")
        if role == "hr" and location_id != target_location_id:
            raise ValueError("HR can only clone CTC structures into their own location")

        new_struct_result = (
            self._db.table("ctc_structures")
            .insert({
                "tenant_id": str(tenant_id),
                "location_id": str(target_location_id),
                "name": new_name,
                "version": 1,
                "is_current": True,
                "cloned_from_id": str(structure_id),
                "created_by": str(created_by),
            })
            .execute()
        )
        new_row = new_struct_result.data[0]

        cloned_items = [
            CTCLineItemCreate(
                key=item.key, label=item.label, section=item.section,
                guided_type=item.guided_type, formula=item.formula,
                guided_params=item.guided_params, display_text=item.display_text,
                is_subtotal=item.is_subtotal, spacer_after=item.spacer_after,
                item_order=item.item_order,
            )
            for item in source.line_items
        ]
        self._insert_line_items(new_row["id"], cloned_items)
        return self._hydrate(new_row)

    def _insert_line_items(self, structure_id: str, items: list[CTCLineItemCreate]) -> None:
        keys = [item.key for item in items]
        if len(keys) != len(set(keys)):
            raise ValueError("Line item keys must be unique within a structure")

        for item in items:
            self._db.table("ctc_line_items").insert({
                "structure_id": structure_id,
                "key": item.key,
                "label": item.label,
                "section": item.section,
                "guided_type": item.guided_type,
                "formula": item.formula,
                "guided_params": item.guided_params,
                "display_text": item.display_text,
                "is_subtotal": item.is_subtotal,
                "spacer_after": item.spacer_after if item.spacer_after is not None else item.is_subtotal,
                "item_order": item.item_order,
            }).execute()

    # ------------------------------------------------------------------ #
    # Evaluation (live-test panel)
    # ------------------------------------------------------------------ #
    def evaluate(
        self, structure_id: UUID, annual_ctc: float, location: str, pf_type: str,
        tenant_id: UUID, role: str, location_id: UUID | None,
    ) -> list[ComputedLineItem]:
        structure = self.get_structure(structure_id, tenant_id, role, location_id)
        if structure is None:
            raise ValueError("CTC structure not found")

        line_item_inputs = [
            LineItemInput(
                key=item.key, label=item.label, section=item.section,
                formula=item.formula, guided_type=item.guided_type,
                guided_params=item.guided_params, display_text=item.display_text,
                is_subtotal=item.is_subtotal, spacer_after=item.spacer_after,
                order=item.item_order,
            )
            for item in structure.line_items
        ]
        return evaluate_structure(line_item_inputs, annual_ctc=annual_ctc, location=location, pf_type=pf_type)
