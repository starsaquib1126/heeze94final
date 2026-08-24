"""
CTC Structure Builder endpoints (Milestone 4).

Access rule, consistent with the rest of the app: Super User manages
structures for any location in their tenant; HR manages only their own
location's structures. Both can view; only Super User is expected to be
the primary author in practice, but HR isn't blocked from configuring
their own location's CTC policy if that's how a given tenant wants to
run things — the access model doesn't hard-code an assumption about who
actually does this work day to day.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.auth import CurrentUser
from app.models.user import CTCStructure, CTCStructureCreate
from app.services.ctc_engine import ComputedLineItem
from app.services.ctc_structure_service import CTCStructureService

router = APIRouter(prefix="/ctc-structures", tags=["ctc-structures"])


class CloneRequest(BaseModel):
    new_name: str
    target_location_id: UUID


class EvaluateRequest(BaseModel):
    annual_ctc: float
    location: str = ""
    pf_type: str = "standard"


@router.get("", response_model=list[CTCStructure])
def list_ctc_structures(
    user: CurrentUser,
    location_id: UUID | None = Query(None, description="Filter to one location"),
) -> list[CTCStructure]:
    return CTCStructureService().list_structures(
        tenant_id=user.tenant_id, role=user.role, location_id=user.location_id,
        location_filter=location_id,
    )


@router.get("/{structure_id}", response_model=CTCStructure)
def get_ctc_structure(structure_id: UUID, user: CurrentUser) -> CTCStructure:
    structure = CTCStructureService().get_structure(
        structure_id, user.tenant_id, user.role, user.location_id
    )
    if structure is None:
        raise HTTPException(status_code=404, detail="CTC structure not found")
    return structure


@router.post("", response_model=CTCStructure, status_code=201)
def create_ctc_structure(data: CTCStructureCreate, user: CurrentUser) -> CTCStructure:
    try:
        return CTCStructureService().create_structure(
            data, user.tenant_id, user.role, user.location_id, created_by=user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/{structure_id}", response_model=CTCStructure)
def update_ctc_structure(structure_id: UUID, data: CTCStructureCreate, user: CurrentUser) -> CTCStructure:
    """Creates a new version rather than mutating the existing one — see
    CTCStructureService.update_structure's docstring for why."""
    try:
        return CTCStructureService().update_structure(
            structure_id, data, user.tenant_id, user.role, user.location_id, created_by=user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{structure_id}/clone", response_model=CTCStructure, status_code=201)
def clone_ctc_structure(structure_id: UUID, data: CloneRequest, user: CurrentUser) -> CTCStructure:
    try:
        return CTCStructureService().clone_structure(
            structure_id, data.new_name, data.target_location_id,
            user.tenant_id, user.role, user.location_id, created_by=user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{structure_id}/evaluate", response_model=list[ComputedLineItem])
def evaluate_ctc_structure(structure_id: UUID, data: EvaluateRequest, user: CurrentUser) -> list[ComputedLineItem]:
    """Live-test panel: evaluate a structure against a sample Annual CTC
    and Location without generating any actual letter."""
    try:
        return CTCStructureService().evaluate(
            structure_id, data.annual_ctc, data.location, data.pf_type,
            user.tenant_id, user.role, user.location_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
