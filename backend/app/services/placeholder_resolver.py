"""
Placeholder Resolver.

Builds the {{placeholder}} -> value map for a given candidate, ported
directly from the desktop app's template_engine.py (already validated
against real iBridge letters). Two things carry over unchanged because
they were hard-won:

  1. Indian digit grouping (12,00,000 not 1,200,000) — Western `,.2f`
     grouping is simply wrong for this audience.
  2. `amount_in_words` is the ONLY function anywhere allowed to turn a
     CTC number into words, fed only by the resolved CTC value — this is
     what fixed the original "Hike Letter CTC-in-words" bug where the
     revised amount could silently pick up the current CTC's words
     instead of its own.
"""

from __future__ import annotations

from datetime import date, datetime

from num2words import num2words

from app.models.candidate_context import LetterGenerationContext


def format_inr(amount: float | None, decimals: int = 0) -> str:
    """Indian digit grouping: last 3 digits, then groups of 2
    (2400000 -> "24,00,000"), not Western grouping (2,400,000)."""
    if amount is None:
        amount = 0
    negative = amount < 0
    amount = abs(amount)
    whole = int(round(amount))
    decimal_part = ""
    if decimals > 0:
        decimal_part = f".{round(amount - whole, decimals):.{decimals}f}".split(".")[1]

    s = str(whole)
    if len(s) <= 3:
        grouped = s
    else:
        last_three = s[-3:]
        rest = s[:-3]
        parts = []
        while len(rest) > 2:
            parts.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            parts.insert(0, rest)
        grouped = ",".join(parts) + "," + last_three

    result = grouped + (f".{decimal_part}" if decimal_part else "")
    return f"-{result}" if negative else result


def amount_in_words(amount: float | None) -> str:
    """Rupee amount in words, Indian numbering style — the only function
    allowed to convert a CTC number to words, always fed by the caller's
    own resolved value (never a different field)."""
    if amount is None or amount <= 0:
        return "Rupees Zero Only"
    whole = int(round(amount))
    words = num2words(whole, lang="en_IN").replace(",", "")
    words = " ".join(w.capitalize() for w in words.split(" "))
    return f"Rupees {words} Only"


def format_date(value: str | date | None, fmt: str = "%d %B %Y") -> str:
    """ISO date -> display format, e.g. '4 May 2026' (no leading zero,
    built manually rather than relying on strftime's non-portable
    no-padding flags which differ between Linux/Mac and Windows)."""
    if not value:
        return ""
    if isinstance(value, str):
        try:
            parsed = datetime.strptime(value.strip(), "%Y-%m-%d").date()
        except ValueError:
            return value
    else:
        parsed = value

    if fmt == "%d %B %Y":
        return f"{parsed.day} {parsed.strftime('%B %Y')}"
    return parsed.strftime(fmt)


def build_placeholder_data(
    candidate_data: dict, context: LetterGenerationContext, company_name: str,
) -> dict[str, str]:
    """
    Build the full placeholder -> value map. `candidate_data` is a plain
    dict (candidate OR employee row shape — both have the same field
    names for the fields this function reads) so this works whether
    generation is for a still-in-pipeline candidate or a converted
    employee, without needing two near-identical functions.
    """
    current_ctc = candidate_data.get("proposed_ctc") or candidate_data.get("current_ctc") or 0
    revised_ctc = (
        context.revised_ctc_override
        if context.revised_ctc_override is not None
        else candidate_data.get("revised_ctc", current_ctc)
    )

    data = {
        "employee_name": candidate_data.get("full_name", ""),
        "employee_code": candidate_data.get("employee_id", "") or "",
        "email": candidate_data.get("email", ""),
        "phone": candidate_data.get("phone") or "",
        "department": candidate_data.get("department") or "",
        "designation": candidate_data.get("designation") or "",
        "client": candidate_data.get("client_name", ""),
        "manager": candidate_data.get("manager") or "",
        "recruiter": candidate_data.get("recruiter_name") or "",
        "doj": format_date(candidate_data.get("confirmed_doj") or candidate_data.get("expected_doj")),
        "status": candidate_data.get("stage", ""),
        "company_name": company_name,
        "today_date": format_date(date.today().isoformat()),

        "current_ctc": format_inr(current_ctc),
        "current_ctc_in_words": amount_in_words(current_ctc),
        "revised_ctc": format_inr(revised_ctc),
        "revised_ctc_in_words": amount_in_words(revised_ctc),

        "effective_date": format_date(context.effective_date),
        "new_designation": context.new_designation or "",
        "last_working_day": format_date(context.last_working_day),
        "confirmation_date": format_date(context.confirmation_date),
        "reason": context.reason or "",

        "location": context.location or candidate_data.get("work_location") or "",
        "ref_no": context.ref_no or "",
        "offer_ref_date": format_date(context.offer_ref_date),
        "period_from": format_date(context.period_from),
        "period_to": format_date(context.period_to),
    }
    data.update(context.extra)
    return data
