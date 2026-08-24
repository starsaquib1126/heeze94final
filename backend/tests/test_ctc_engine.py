"""
Tests for the CTC formula engine (Milestone 4).

Covers three things:
1. Formula safety — malicious input must never execute.
2. Guided-builder-to-formula translation for each component type.
3. A specific regression: the slab translator originally built its
   nested IF() chain with the wrong threshold ordering, which meant a
   HIGH value (e.g. a monthly CTC well above every slab) could
   incorrectly match a LOWER slab's condition instead of the correct
   highest one — because IF() short-circuits on the first true
   condition, and the lower threshold's condition is also technically
   true for a high value. This silently produced the wrong Professional
   Tax deduction for anyone above the second-highest slab. Caught by
   testing a real high-CTC case, not just the boundary values.
"""

from __future__ import annotations

import pytest

from app.services.ctc_engine import (
    CircularReferenceError,
    FormulaError,
    LineItemInput,
    evaluate_formula,
    evaluate_structure,
    guided_params_to_formula,
)

MALICIOUS_FORMULAS = [
    "__import__('os').system('echo pwned')",
    "open('/etc/passwd').read()",
    "[x for x in range(10)]",
    "().__class__.__bases__[0]",
    "lambda: 1",
    "1; import os",
    "eval('1+1')",
]


@pytest.mark.parametrize("formula", MALICIOUS_FORMULAS)
def test_malicious_formulas_are_rejected(formula: str) -> None:
    with pytest.raises((FormulaError, SyntaxError)):
        evaluate_formula(formula, {"x": 100})


def test_division_by_zero_is_rejected() -> None:
    with pytest.raises(FormulaError, match="[Dd]ivision by zero"):
        evaluate_formula("100 / x", {"x": 0})


def test_circular_reference_is_detected_not_infinite_looped() -> None:
    items = [
        LineItemInput(key="a", label="A", section="Test", formula="b + 1", order=1),
        LineItemInput(key="b", label="B", section="Test", formula="a + 1", order=2),
    ]
    with pytest.raises(CircularReferenceError):
        evaluate_structure(items, annual_ctc=1200000)


class TestGuidedTranslation:
    def test_percent_of(self) -> None:
        formula = guided_params_to_formula("percent_of", {"base": "basic_monthly", "percent": 40})
        assert formula == "basic_monthly * 40%"

    def test_flat(self) -> None:
        formula = guided_params_to_formula("flat", {"amount": 1800})
        assert formula == "1800"

    def test_unknown_type_raises(self) -> None:
        with pytest.raises(FormulaError, match="Unknown guided component type"):
            guided_params_to_formula("not_a_real_type", {})

    def test_guided_type_parameter_is_authoritative_not_a_duplicate_key(self) -> None:
        """
        Regression test for the first bug found in this module: the
        function used to look for `params["type"]` instead of using the
        `guided_type` argument it was already given, so a caller who
        (reasonably) didn't duplicate the type inside params got a
        confusing "Unknown guided component type: None" instead of a
        correct result.
        """
        formula = guided_params_to_formula("percent_of", {"base": "monthly_ctc", "percent": 50})
        assert formula == "monthly_ctc * 50%"


class TestSlabBoundaries:
    """
    The exact bug: a monthly CTC of 200,000 (well above the top slab's
    threshold of 20,001) was incorrectly evaluating to the SECOND slab's
    value (150) instead of the top slab's value (200), because the
    nested IF() chain checked the lower threshold before the higher one.
    """

    SLAB_PARAMS = {
        "compare_to": "monthly_ctc",
        "slabs": [
            {"max": 15000, "value": 0},
            {"min": 15001, "max": 20000, "value": 150},
            {"min": 20001, "value": 200},
        ],
    }

    @pytest.mark.parametrize("monthly_ctc,expected", [
        (10_000, 0),
        (15_000, 0),
        (15_001, 150),
        (20_000, 150),
        (20_001, 200),
        (200_000, 200),   # the case that exposed the original bug
        (1_000_000, 200),  # far above every threshold - must still hit the top slab
    ])
    def test_slab_resolves_to_the_correct_bracket(self, monthly_ctc: float, expected: float) -> None:
        item = LineItemInput(
            key="pt", label="Professional Tax", section="Deductions", order=1,
            guided_type="slab", guided_params=self.SLAB_PARAMS,
        )
        result = evaluate_structure([item], annual_ctc=monthly_ctc * 12)
        assert result[0].monthly == expected

    def test_slab_order_in_input_does_not_matter(self) -> None:
        """The slabs list isn't required to already be sorted - the
        translator must sort it itself, not assume caller ordering."""
        shuffled_params = {
            "compare_to": "monthly_ctc",
            "slabs": [
                {"min": 20001, "value": 200},
                {"max": 15000, "value": 0},
                {"min": 15001, "max": 20000, "value": 150},
            ],
        }
        item = LineItemInput(
            key="pt", label="PT", section="Deductions", order=1,
            guided_type="slab", guided_params=shuffled_params,
        )
        result = evaluate_structure([item], annual_ctc=200_000 * 12)
        assert result[0].monthly == 200


def test_full_structure_ties_out_to_the_input_annual_ctc() -> None:
    """
    End-to-end sanity check using guided components exclusively (no raw
    formulas) - Total Earnings + Employer PF must sum to exactly the
    Annual CTC that was put in, which is the real correctness property
    a CTC breakup has to satisfy regardless of the specific percentages
    a given tenant configures.
    """
    items = [
        LineItemInput(key="basic_monthly", label="Basic Salary", section="Earnings", order=1,
                       guided_type="percent_of", guided_params={"base": "monthly_ctc", "percent": 50}),
        LineItemInput(key="hra_monthly", label="HRA", section="Earnings", order=2,
                       guided_type="percent_of", guided_params={"base": "basic_monthly", "percent": 40}),
        LineItemInput(key="bonus_monthly", label="Bonus", section="Earnings", order=3,
                       guided_type="percent_of", guided_params={"base": "basic_monthly", "percent": 8.33}),
        LineItemInput(key="employer_pf_monthly", label="Employer PF (B)", section="Earnings", order=6,
                       formula="IF((monthly_ctc - hra_monthly) > 15000, 1800, (monthly_ctc - hra_monthly) * 12%)",
                       spacer_after=True),
        LineItemInput(key="special_allowance_monthly", label="Special Allowance", section="Earnings", order=4,
                       formula="(monthly_ctc - employer_pf_monthly) - (basic_monthly + hra_monthly + bonus_monthly)"),
        LineItemInput(key="total_earnings_monthly", label="Total Earnings (A)", section="Earnings", order=5,
                       formula="basic_monthly + hra_monthly + bonus_monthly + special_allowance_monthly",
                       is_subtotal=True),
        LineItemInput(key="total_ctc_monthly", label="Total CTC (A+B)", section="Earnings", order=7,
                       formula="total_earnings_monthly + employer_pf_monthly", is_subtotal=True),
    ]
    for annual_ctc in (1_200_000, 2_200_000, 2_400_000, 850_000):
        results = evaluate_structure(items, annual_ctc=annual_ctc, location="Hyderabad")
        by_label = {r.label: r for r in results}
        assert abs(by_label["Total CTC (A+B)"].yearly - annual_ctc) < 1, (
            f"Structure did not tie out to input CTC {annual_ctc}"
        )


def test_formula_error_includes_which_item_and_formula_failed() -> None:
    """
    Regression test: a real-world error hit in production just said
    "Invalid formula syntax: invalid syntax (<unknown>, line 1)" with no
    indication of which line item was actually broken, across a
    structure with many items — effectively unusable for the person
    trying to fix it. The error now names the specific item's label,
    key, and the exact broken formula string.
    """
    items = [
        LineItemInput(key="basic_monthly", label="Basic Salary", section="Earnings", order=1,
                       guided_type="percent_of", guided_params={"base": "monthly_ctc", "percent": 50}),
        LineItemInput(key="broken_item", label="Something Broken", section="Earnings", order=2,
                       guided_type="custom", formula="monthly_ctc *"),
    ]
    with pytest.raises(FormulaError) as exc_info:
        evaluate_structure(items, annual_ctc=1200000)
    message = str(exc_info.value)
    assert "Something Broken" in message
    assert "broken_item" in message


def test_circular_reference_error_type_is_preserved_not_rewrapped() -> None:
    """The item-context wrapping added for regular formula errors must
    not swallow CircularReferenceError's specific type or message."""
    items = [
        LineItemInput(key="a", label="A", section="Test", formula="b + 1", order=1),
        LineItemInput(key="b", label="B", section="Test", formula="a + 1", order=2),
    ]
    with pytest.raises(CircularReferenceError):
        evaluate_structure(items, annual_ctc=1200000)


class TestRealIBridgeSpreadsheetParity:
    """
    Verifies the full CTC structure (Earnings + Deductions) against real
    numbers — not just that the engine produces *some* number, but that
    it produces the *exact* numbers expected, for a standard Hyderabad
    case and a Karnataka/ESIC case.

    Professional Tax specifically: the reference spreadsheet
    (CTC_Calculations_-_2026-27.xlsx) had a salary-based slab formula,
    but that turned out not to be the actual rule in practice — confirmed
    directly: any offer/appointment released from Karnataka (Bengaluru)
    is PT-free, full stop; every other location is a flat ₹200/month,
    regardless of salary. Both the spreadsheet's two real examples happen
    to agree with either interpretation (their specific salary levels
    landed on the "matching" side of both rules), which is exactly why
    this needed a dedicated high-earning-Karnataka test to actually tell
    the two rules apart — see test_karnataka_pt_is_flat_zero_even_at_high_salary.

    This class is also the regression test for a real production bug:
    string equality comparison (`location == "Karnataka"`) had never
    actually been exercised by the formula engine until this real
    Professional Tax rule required it.
    """

    def _full_structure(self) -> list[LineItemInput]:
        return [
            LineItemInput(key="basic_monthly", label="Basic Salary", section="Earnings", order=1,
                           guided_type="percent_of", guided_params={"base": "monthly_ctc", "percent": 50}),
            LineItemInput(key="hra_monthly", label="HRA", section="Earnings", order=2,
                           guided_type="percent_of", guided_params={"base": "basic_monthly", "percent": 40}),
            LineItemInput(key="bonus_monthly", label="Statutory Bonus", section="Earnings", order=3,
                           guided_type="percent_of", guided_params={"base": "basic_monthly", "percent": 8.33}),
            LineItemInput(key="special_allowance_monthly", label="Special Allowance", section="Earnings", order=4,
                           formula="(monthly_ctc - employer_pf_monthly) - (basic_monthly + hra_monthly + bonus_monthly)"),
            LineItemInput(key="total_earnings_monthly", label="Total Earnings (A)", section="Earnings", order=5,
                           formula="basic_monthly + hra_monthly + bonus_monthly + special_allowance_monthly", is_subtotal=True),
            LineItemInput(key="employer_pf_monthly", label="Employer PF (B)", section="Earnings", order=6,
                           formula="IF((monthly_ctc - hra_monthly) > 15000, 1800, (monthly_ctc - hra_monthly) * 12%)", spacer_after=True),
            LineItemInput(key="total_ctc_monthly", label="Total CTC (A+B)", section="Earnings", order=7,
                           formula="total_earnings_monthly + employer_pf_monthly", is_subtotal=True),
            LineItemInput(key="employee_pf_monthly", label="Employee PF", section="Deductions", order=8,
                           formula="employer_pf_monthly"),
            LineItemInput(key="esic_monthly", label="ESIC", section="Deductions", order=9,
                           formula="IF(monthly_ctc > 21000, 0, total_earnings_monthly * 0.75%)"),
            LineItemInput(key="professional_tax_monthly", label="Professional Tax (PT)", section="Deductions", order=10,
                           formula='IF(location == "Karnataka", 0, 200)'),
            LineItemInput(key="total_deductions_monthly", label="Total Deductions (C)", section="Deductions", order=11,
                           formula="employee_pf_monthly + professional_tax_monthly + esic_monthly", is_subtotal=True),
            LineItemInput(key="net_salary_monthly", label="Net Salary (D)", section="Deductions", order=12,
                           formula="total_earnings_monthly - total_deductions_monthly", is_subtotal=True),
        ]

    def test_matches_real_spreadsheet_hyderabad_22_lakh(self) -> None:
        results = evaluate_structure(self._full_structure(), annual_ctc=2200000, location="Hyderabad")
        by_key = {r.label: r for r in results}
        assert by_key["Total CTC (A+B)"].yearly == 2200000
        assert by_key["Professional Tax (PT)"].monthly == 200
        assert by_key["ESIC"].monthly == 0
        assert by_key["Total Deductions (C)"].yearly == 24000
        assert by_key["Net Salary (D)"].yearly == 2154400

    def test_matches_real_spreadsheet_karnataka_2_5_lakh_with_esic(self) -> None:
        results = evaluate_structure(self._full_structure(), annual_ctc=250000, location="Karnataka")
        by_key = {r.label: r for r in results}
        assert by_key["Total CTC (A+B)"].yearly == 250000
        assert by_key["ESIC"].monthly == 142.75
        assert by_key["Professional Tax (PT)"].monthly == 0
        assert round(by_key["Net Salary (D)"].yearly, 0) == 205087

    def test_karnataka_pt_is_flat_zero_even_at_high_salary(self) -> None:
        """
        The discriminating case: at a high CTC, the spreadsheet's own
        slab formula would have charged ₹200 PT even for Karnataka
        (since earnings would clear its 25,000 threshold) — but the
        actual, confirmed rule is a flat 0 for Karnataka regardless of
        salary. This is the test that would have failed under the old
        (wrong) slab interpretation, proving the current formula
        implements the real rule, not a coincidence that happened to
        match the spreadsheet's own two examples.
        """
        results = evaluate_structure(self._full_structure(), annual_ctc=3600000, location="Karnataka")
        by_key = {r.label: r for r in results}
        assert by_key["Professional Tax (PT)"].monthly == 0

    def test_non_karnataka_pt_is_flat_200_even_at_low_salary(self) -> None:
        """The mirror case: Noida/Hyderabad/Mumbai are always ₹200,
        never graduated down to 150 or 0 at lower salaries — unlike the
        spreadsheet's own slab formula would have done."""
        results = evaluate_structure(self._full_structure(), annual_ctc=200000, location="Hyderabad")
        by_key = {r.label: r for r in results}
        assert by_key["Professional Tax (PT)"].monthly == 200

    def test_string_equality_comparison_works_in_formulas(self) -> None:
        """The specific capability the real PT rule depends on — never
        exercised before this real-world formula required it."""
        assert evaluate_formula('IF(location == "Karnataka", 1, 0)', {"location": "Karnataka"}) == 1
        assert evaluate_formula('IF(location == "Karnataka", 1, 0)', {"location": "Hyderabad"}) == 0


class TestPfTypeVariants:
    """
    Employer PF has three modes, selected by the Account Manager on the
    offer request (or HR, for direct creation): 'standard' (capped at
    ₹1,800 once salary crosses the threshold — the statutory default),
    'max' (full 12%, no cap — confirmed directly), and 'none' (PF
    excluded from CTC entirely, selected for cases where PF genuinely
    doesn't apply).
    """

    def _pf_formula(self) -> str:
        return ('IF(pf_type == "max", (monthly_ctc - hra_monthly) * 12%, '
                'IF(pf_type == "none", 0, '
                'IF((monthly_ctc - hra_monthly) > 15000, 1800, (monthly_ctc - hra_monthly) * 12%)))')

    def test_standard_pf_is_capped_at_1800_above_threshold(self) -> None:
        result = evaluate_formula(self._pf_formula(), {
            "pf_type": "standard", "monthly_ctc": 100000, "hra_monthly": 40000,
        })
        assert result == 1800

    def test_max_pf_is_full_12_percent_no_cap(self) -> None:
        result = evaluate_formula(self._pf_formula(), {
            "pf_type": "max", "monthly_ctc": 100000, "hra_monthly": 40000,
        })
        assert result == 7200.0  # 60000 * 12%, uncapped

    def test_none_pf_is_always_zero_regardless_of_salary(self) -> None:
        result = evaluate_formula(self._pf_formula(), {
            "pf_type": "none", "monthly_ctc": 500000, "hra_monthly": 200000,
        })
        assert result == 0

    def test_default_pf_type_behaves_as_standard(self) -> None:
        """evaluate_structure defaults pf_type to 'standard' when not
        explicitly passed — every pre-existing caller that doesn't know
        about pf_type yet must keep behaving exactly as before."""
        items = [
            LineItemInput(key="hra_monthly", label="HRA", section="Earnings", order=1, formula="40000"),
            LineItemInput(key="pf", label="PF", section="Earnings", order=2, formula=self._pf_formula()),
        ]
        results = evaluate_structure(items, annual_ctc=1200000)  # no pf_type passed
        pf_result = next(r for r in results if r.label == "PF")
        assert pf_result.monthly == 1800  # same as explicit 'standard'
