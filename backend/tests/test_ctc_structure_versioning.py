"""
Tests for CTCStructureService's versioning and clone logic (Milestone 4).

The versioning rule is the one most worth protecting with tests: editing
an already-used structure must NEVER mutate the existing row — it has to
create a new version and mark the old one not-current, so a historical
offer's CTC breakup stays tied to the formula that actually produced it,
even after the policy changes later.
"""

from __future__ import annotations

from unittest.mock import MagicMock, call
from uuid import uuid4

import pytest

from app.models.user import CTCLineItemCreate, CTCStructureCreate
from app.services.ctc_structure_service import CTCStructureService

TENANT_A = uuid4()
LOCATION_A1 = uuid4()
LOCATION_A2 = uuid4()
CREATED_BY = uuid4()


def _service() -> tuple[CTCStructureService, MagicMock]:
    svc = CTCStructureService.__new__(CTCStructureService)
    mock_db = MagicMock()
    svc._db = mock_db
    return svc, mock_db


def _structure_row(structure_id, **overrides) -> dict:
    row = {
        "id": str(structure_id),
        "tenant_id": str(TENANT_A),
        "location_id": str(LOCATION_A1),
        "name": "CTC with PF",
        "version": 1,
        "is_current": True,
        "cloned_from_id": None,
        "created_at": "2026-01-01T00:00:00",
    }
    row.update(overrides)
    return row


def test_create_structure_starts_at_version_1() -> None:
    svc, mock_db = _service()
    structure_id = uuid4()
    mock_db.table.return_value.insert.return_value.execute.return_value.data = [
        _structure_row(structure_id, version=1, is_current=True)
    ]
    mock_db.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value.data = []

    result = svc.create_structure(
        CTCStructureCreate(name="CTC with PF", location_id=LOCATION_A1, line_items=[]),
        tenant_id=TENANT_A, role="super_user", location_id=None, created_by=CREATED_BY,
    )

    assert result.version == 1
    assert result.is_current is True


def test_update_structure_marks_old_version_not_current_and_creates_new_one() -> None:
    """The core versioning guarantee: an edit must produce TWO database
    operations — an UPDATE that flips the old row's is_current to False,
    and a separate INSERT for the new version — never a single UPDATE
    that mutates the original row in place."""
    svc, mock_db = _service()
    structure_id = uuid4()
    existing_row = _structure_row(structure_id, version=1, is_current=True)

    # get_structure() (called internally to load the existing structure)
    select_chain = mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value
    select_chain.maybe_single.return_value.execute.return_value.data = existing_row
    mock_db.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value.data = []

    new_version_row = _structure_row(uuid4(), version=2, is_current=True, cloned_from_id=str(structure_id))
    mock_db.table.return_value.insert.return_value.execute.return_value.data = [new_version_row]

    result = svc.update_structure(
        structure_id,
        CTCStructureCreate(name="CTC with PF", location_id=LOCATION_A1, line_items=[]),
        tenant_id=TENANT_A, role="super_user", location_id=None, created_by=CREATED_BY,
    )

    # An UPDATE must have been issued to mark the OLD structure not-current.
    update_call = mock_db.table.return_value.update.call_args
    assert update_call is not None, "update_structure must UPDATE the old row's is_current flag"
    assert update_call.args[0] == {"is_current": False}

    # The result must be a NEW row (version 2), not the mutated original.
    assert result.version == 2
    assert result.is_current is True


def test_update_structure_raises_for_nonexistent_structure() -> None:
    svc, mock_db = _service()
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value.data = None

    with pytest.raises(ValueError, match="not found"):
        svc.update_structure(
            uuid4(),
            CTCStructureCreate(name="X", location_id=LOCATION_A1, line_items=[]),
            tenant_id=TENANT_A, role="super_user", location_id=None, created_by=CREATED_BY,
        )


def test_hr_cannot_create_structure_for_a_different_location() -> None:
    """HR at location A1 must not be able to create a structure for A2,
    even though both locations are in the same tenant."""
    svc, _ = _service()
    with pytest.raises(ValueError, match="own location"):
        svc.create_structure(
            CTCStructureCreate(name="X", location_id=LOCATION_A2, line_items=[]),
            tenant_id=TENANT_A, role="hr", location_id=LOCATION_A1, created_by=CREATED_BY,
        )


def test_clone_structure_copies_line_items_with_a_new_structure_id() -> None:
    svc, mock_db = _service()
    source_id = uuid4()
    source_row = _structure_row(source_id)

    select_chain = mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value
    select_chain.maybe_single.return_value.execute.return_value.data = source_row

    source_line_items = [
        {"id": str(uuid4()), "structure_id": str(source_id), "key": "basic_monthly",
         "label": "Basic", "section": "Earnings", "guided_type": "percent_of",
         "formula": None, "guided_params": {"base": "monthly_ctc", "percent": 50},
         "display_text": "", "is_subtotal": False, "spacer_after": False, "item_order": 1},
    ]
    mock_db.table.return_value.select.return_value.eq.return_value.order.return_value \
        .execute.return_value.data = source_line_items

    new_structure_id = uuid4()
    new_row = _structure_row(new_structure_id, location_id=str(LOCATION_A2), name="CTC with PF (Bengaluru)")
    mock_db.table.return_value.insert.return_value.execute.return_value.data = [new_row]

    result = svc.clone_structure(
        source_id, "CTC with PF (Bengaluru)", LOCATION_A2,
        tenant_id=TENANT_A, role="super_user", location_id=None, created_by=CREATED_BY,
    )

    assert result.name == "CTC with PF (Bengaluru)"
    assert str(result.location_id) == str(LOCATION_A2)

    # A line item must have been inserted for the NEW structure, not the source.
    insert_calls = mock_db.table.return_value.insert.call_args_list
    line_item_inserts = [c for c in insert_calls if c.args[0].get("key") == "basic_monthly"]
    assert len(line_item_inserts) == 1
    assert line_item_inserts[0].args[0]["structure_id"] == str(new_row["id"])


def test_duplicate_line_item_keys_are_rejected() -> None:
    svc, mock_db = _service()
    structure_id = str(uuid4())

    with pytest.raises(ValueError, match="unique"):
        svc._insert_line_items(structure_id, [
            CTCLineItemCreate(key="basic_monthly", label="Basic V1", section="Earnings"),
            CTCLineItemCreate(key="basic_monthly", label="Basic V2", section="Earnings"),
        ])
