"""
Letter Template & Branding endpoints (Milestone 4).

Templates and branding are tenant-wide (not location-scoped) — HR at
any location can view them, but only Super User can create/edit, since
these define what the whole company's letters look like, not something
one location should be able to change unilaterally.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.auth import CurrentUser, SuperUser
from app.models.user import LetterTemplate, LetterTemplateCreate, TenantBranding
from app.services.letter_template_service import BrandingService, LetterTemplateService

router = APIRouter(tags=["letter-templates"])


class PlaceholderScanRequest(BaseModel):
    blocks: list[dict]


@router.get("/letter-templates", response_model=list[LetterTemplate])
def list_letter_templates(user: CurrentUser) -> list[LetterTemplate]:
    return LetterTemplateService().list_templates(user.tenant_id)


@router.get("/letter-templates/{template_id}", response_model=LetterTemplate)
def get_letter_template(template_id: UUID, user: CurrentUser) -> LetterTemplate:
    template = LetterTemplateService().get_template(template_id, user.tenant_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.post("/letter-templates/scan-placeholders")
def scan_placeholders(data: PlaceholderScanRequest, user: CurrentUser) -> dict:
    """Called by the editor's "review before saving" step to show which
    placeholders were used and split them into recognized vs custom."""
    return LetterTemplateService().scan_placeholders(data.blocks)


@router.post("/letter-templates", response_model=LetterTemplate, status_code=201)
def create_letter_template(data: LetterTemplateCreate, user: SuperUser) -> LetterTemplate:
    try:
        return LetterTemplateService().create_template(data, user.tenant_id, created_by=user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/letter-templates/{template_id}/activate", response_model=LetterTemplate)
def activate_letter_template(template_id: UUID, user: SuperUser) -> LetterTemplate:
    try:
        return LetterTemplateService().set_active(template_id, user.tenant_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/letter-templates/{template_id}", status_code=204)
def delete_letter_template(template_id: UUID, user: SuperUser) -> None:
    LetterTemplateService().delete_template(template_id, user.tenant_id)


@router.get("/branding", response_model=dict)
def get_branding(user: CurrentUser) -> dict:
    return BrandingService().get_branding(user.tenant_id)


@router.post("/branding/logo")
async def upload_logo(user: SuperUser, file: UploadFile = File(...)) -> dict:
    path = await _upload_branding_asset(user.tenant_id, file, "logo")
    BrandingService().set_logo_path(user.tenant_id, path)
    return {"logo_storage_path": path}


@router.post("/branding/signature")
async def upload_signature(user: SuperUser, file: UploadFile = File(...)) -> dict:
    path = await _upload_branding_asset(user.tenant_id, file, "signature")
    BrandingService().set_signature_path(user.tenant_id, path)
    return {"signature_storage_path": path}


async def _upload_branding_asset(tenant_id: UUID, file: UploadFile, kind: str) -> str:
    if file.content_type not in ("image/png", "image/jpeg"):
        raise HTTPException(status_code=400, detail="Logo and signature must be PNG or JPEG images")

    from app.db.client import get_service_db
    from app.core.config import get_settings

    settings = get_settings()
    db = get_service_db()
    extension = "png" if file.content_type == "image/png" else "jpg"
    storage_path = f"{tenant_id}/branding/{kind}.{extension}"

    contents = await file.read()
    db.storage.from_(settings.storage_bucket).upload(
        storage_path, contents, {"content-type": file.content_type, "upsert": "true"},
    )
    return storage_path
