"""
LetterGenerationContext — the letter-type-specific extra fields collected
at generation time (e.g. Hike Letter needs an effective date, Relieving
Letter needs a last working day). Ported directly from the desktop app's
LetterContext, unchanged in shape.
"""

from __future__ import annotations

from pydantic import BaseModel


class LetterGenerationContext(BaseModel):
    effective_date: str | None = None        # hike / promotion effective date (ISO)
    new_designation: str | None = None       # promotion letter
    last_working_day: str | None = None      # relieving / experience letter
    confirmation_date: str | None = None     # confirmation letter
    reason: str | None = None                # warning / appreciation letter
    revised_ctc_override: float | None = None  # if set, wins over the candidate/employee's revised_ctc

    location: str | None = None              # place of work (also drives CTC PT slab)
    ref_no: str | None = None                # appointment letter reference number
    offer_ref_date: str | None = None        # appointment letter's "further to our offer dated ..."
    period_from: str | None = None           # relieving/experience letter: employment start (ISO)
    period_to: str | None = None             # relieving/experience letter: employment end (ISO)

    extra: dict[str, str] = {}               # custom placeholder overrides (from template's custom_placeholder_defaults)
