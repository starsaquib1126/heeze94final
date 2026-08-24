"""
CTC Formula Engine.

Ported from the desktop app's ctc_engine.py (already validated against
iBridge's real Excel workbook and real letters) and extended with a
guided-builder layer: an admin picks a common component type (Basic,
HRA, Employer PF, Professional Tax, ...) and fills in simple parameters
instead of typing a formula; this module translates that into the same
formula string the raw/custom path would produce, so both paths are
evaluated by exactly one engine.

SAFETY: formulas are never passed to eval(). They're parsed with
Python's ast module and walked against a strict allow-list of node
types. Anything else — attribute access, function calls outside the
whitelist, imports, comprehensions — is rejected before evaluation.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field

_PERCENT_LITERAL = re.compile(r"(\d+(?:\.\d+)?)\s*%")

_ALLOWED_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod, ast.Pow, ast.USub, ast.UAdd)
_ALLOWED_COMPARE = (ast.Eq, ast.NotEq, ast.Gt, ast.GtE, ast.Lt, ast.LtE)
_ALLOWED_BOOLOPS = (ast.And, ast.Or)


class FormulaError(ValueError):
    """Raised for an invalid, unsafe, or unresolvable formula."""


class CircularReferenceError(FormulaError):
    pass


def _call_if(cond, a, b):
    return a if cond else b


def _call_min(*args):
    return min(args)


def _call_max(*args):
    return max(args)


def _call_round(value, ndigits=0):
    return round(value, int(ndigits))


_ALLOWED_FUNCTIONS = {"IF": _call_if, "MIN": _call_min, "MAX": _call_max, "ROUND": _call_round}


def _preprocess_formula(formula: str) -> str:
    """Convert Excel-style percent literals ('12%') into plain division."""
    return _PERCENT_LITERAL.sub(r"(\1/100)", formula)


class _SafeEvaluator(ast.NodeVisitor):
    """Walks a parsed formula's AST and computes its value, rejecting any
    node type not on the explicit allow-list."""

    def __init__(self, context: dict) -> None:
        self.context = context

    def visit(self, node):
        method = "visit_" + node.__class__.__name__
        visitor = getattr(self, method, None)
        if visitor is None:
            raise FormulaError(f"Unsupported expression: {node.__class__.__name__}")
        return visitor(node)

    def visit_Expression(self, node):
        return self.visit(node.body)

    def visit_Constant(self, node):
        if isinstance(node.value, (int, float, str, bool)):
            return node.value
        raise FormulaError(f"Unsupported constant type: {type(node.value)}")

    def visit_Name(self, node):
        try:
            return self.context[node.id]
        except KeyError:
            raise FormulaError(f"Unknown reference: '{node.id}'")

    def visit_BinOp(self, node):
        if not isinstance(node.op, _ALLOWED_BINOPS):
            raise FormulaError(f"Operator not allowed: {node.op.__class__.__name__}")
        left = self.visit(node.left)
        right = self.visit(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            if right == 0:
                raise FormulaError("Division by zero")
            return left / right
        if isinstance(node.op, ast.Mod):
            return left % right
        if isinstance(node.op, ast.Pow):
            return left ** right
        raise FormulaError("Unreachable operator branch")

    def visit_UnaryOp(self, node):
        operand = self.visit(node.operand)
        if isinstance(node.op, ast.USub):
            return -operand
        if isinstance(node.op, ast.UAdd):
            return operand
        raise FormulaError(f"Unary operator not allowed: {node.op.__class__.__name__}")

    def visit_Compare(self, node):
        left = self.visit(node.left)
        for op, comparator in zip(node.ops, node.comparators):
            if not isinstance(op, _ALLOWED_COMPARE):
                raise FormulaError(f"Comparison not allowed: {op.__class__.__name__}")
            right = self.visit(comparator)
            result = {
                ast.Eq: lambda a, b: a == b, ast.NotEq: lambda a, b: a != b,
                ast.Gt: lambda a, b: a > b, ast.GtE: lambda a, b: a >= b,
                ast.Lt: lambda a, b: a < b, ast.LtE: lambda a, b: a <= b,
            }[type(op)](left, right)
            if not result:
                return False
            left = right
        return True

    def visit_BoolOp(self, node):
        if not isinstance(node.op, _ALLOWED_BOOLOPS):
            raise FormulaError("Boolean operator not allowed")
        values = [self.visit(v) for v in node.values]
        return all(values) if isinstance(node.op, ast.And) else any(values)

    def visit_IfExp(self, node):
        return self.visit(node.body) if self.visit(node.test) else self.visit(node.orelse)

    def visit_Call(self, node):
        if not isinstance(node.func, ast.Name) or node.func.id not in _ALLOWED_FUNCTIONS:
            raise FormulaError("Only IF(), MIN(), MAX(), ROUND() are allowed as function calls")
        if node.keywords:
            raise FormulaError("Keyword arguments are not allowed in formulas")
        args = [self.visit(a) for a in node.args]
        return _ALLOWED_FUNCTIONS[node.func.id](*args)


def evaluate_formula(formula: str, context: dict) -> float | str:
    """Safely evaluate a single formula string against a resolved context dict."""
    try:
        processed = _preprocess_formula(formula)
        tree = ast.parse(processed, mode="eval")
    except SyntaxError as exc:
        raise FormulaError(f"Invalid formula syntax: {exc}") from exc
    return _SafeEvaluator(context).visit(tree)


# ---------------------------------------------------------------------- #
# Guided builder: translate a component type + simple params into a
# formula string, so both the guided and raw/custom paths are evaluated
# by the exact same engine above.
# ---------------------------------------------------------------------- #
def guided_params_to_formula(guided_type: str, params: dict) -> str:
    """
    Translate a guided-builder component into a formula string.

    `guided_type` decides which shape `params` is expected to have —
    there's no separate/duplicate "type" key inside `params` itself,
    since having the same information in two places is exactly the kind
    of thing that's easy to forget to keep in sync (a caller could pass
    guided_type="percent_of" with params missing its own "type" field
    and get a confusing "Unknown guided component type: None" instead
    of the real error).

    Supported shapes:
      percent_of:  {"base": "basic_monthly", "percent": 40}
      flat:        {"amount": 1800}
      slab:        {"compare_to": "monthly_ctc",
                     "slabs": [{"max": 15000, "value": 0}, {"min": 15001, "value": 200}]}
    """
    if guided_type == "percent_of":
        base = params["base"]
        percent = params["percent"]
        return f"{base} * {percent}%"

    if guided_type == "flat":
        return str(params["amount"])

    if guided_type == "slab":
        compare_to = params.get("compare_to", "monthly_ctc")
        slabs = params["slabs"]
        # Build nested IF() calls with the HIGHEST threshold as the
        # OUTERMOST check — IF() short-circuits on the first true
        # condition, so if a lower threshold were checked first, it
        # would incorrectly catch values that actually belong to a
        # higher slab (e.g. checking ">= 15001" before ">= 20001" would
        # return the 15001 slab's value even for an amount that's really
        # in the 20001 slab, since 15001's condition is already true).
        sorted_slabs = sorted(slabs, key=lambda s: s.get("min", 0))
        expr = str(sorted_slabs[0]["value"])  # fallback: lowest slab's value
        for slab in sorted_slabs[1:]:
            if "min" in slab:
                expr = f"IF({compare_to} >= {slab['min']}, {slab['value']}, {expr})"
            elif "max" in slab:
                expr = f"IF({compare_to} <= {slab['max']}, {slab['value']}, {expr})"
        return expr

    raise FormulaError(f"Unknown guided component type: {guided_type}")


# ---------------------------------------------------------------------- #
# Structure evaluation
# ---------------------------------------------------------------------- #
@dataclass
class LineItemInput:
    key: str
    label: str
    section: str
    formula: str | None = None
    guided_type: str | None = None
    guided_params: dict | None = None
    display_text: str = ""
    is_subtotal: bool = False
    spacer_after: bool | None = None
    order: int = 0

    def __post_init__(self):
        if self.spacer_after is None:
            self.spacer_after = self.is_subtotal

    def resolved_formula(self) -> str | None:
        """Formula to evaluate — either the raw one, or translated from guided params."""
        if self.formula:
            return self.formula
        if self.guided_type and self.guided_type != "custom" and self.guided_params:
            return guided_params_to_formula(self.guided_type, self.guided_params)
        return None


@dataclass
class ComputedLineItem:
    label: str
    section: str
    yearly: float | str
    monthly: float | str
    is_subtotal: bool = False
    spacer_after: bool = False


def evaluate_structure(
    line_items: list[LineItemInput], annual_ctc: float, location: str = "", pf_type: str = "standard",
) -> list[ComputedLineItem]:
    """
    Evaluate every line item for a given Annual CTC, Location, and PF
    type, resolving cross-references between line items regardless of
    their declared order. Formulas are written in monthly terms; yearly
    is always monthly * 12.

    pf_type: "standard" (capped at ₹1,800 once salary crosses the
    threshold — the statutory default), "max" (full 12%, no cap — some
    employees are offered this as a choice), or "none" (PF excluded
    from CTC entirely, selected by the Account Manager on the offer
    request for cases where PF genuinely doesn't apply).
    """
    base_context: dict = {
        "annual_ctc": annual_ctc,
        "monthly_ctc": annual_ctc / 12,
        "location": location,
        "pf_type": pf_type,
    }

    resolved: dict[str, float] = {}
    resolving: set[str] = set()
    items_by_key = {item.key: item for item in line_items if item.resolved_formula() is not None}

    def resolve(key: str) -> float:
        if key in resolved:
            return resolved[key]
        if key in base_context:
            return base_context[key]
        if key not in items_by_key:
            raise FormulaError(f"Unknown reference: '{key}'")
        if key in resolving:
            raise CircularReferenceError(f"Circular reference detected while resolving '{key}'")
        resolving.add(key)

        class _LazyContext(dict):
            def __missing__(self, name):
                return resolve(name)

        ctx = _LazyContext(base_context)
        try:
            value = evaluate_formula(items_by_key[key].resolved_formula(), ctx)
        except CircularReferenceError:
            raise  # preserve the specific type and message from the nested resolve() call
        except FormulaError as exc:
            item = items_by_key[key]
            raise FormulaError(
                f"Line item '{item.label}' (key: {item.key}) has an invalid formula "
                f"({item.resolved_formula()!r}): {exc}"
            ) from exc
        resolving.discard(key)
        resolved[key] = value
        return value

    results: list[ComputedLineItem] = []
    for item in sorted(line_items, key=lambda i: i.order):
        formula = item.resolved_formula()
        if formula is None:
            results.append(ComputedLineItem(
                label=item.label, section=item.section,
                yearly=item.display_text or "-", monthly=item.display_text or "-",
                is_subtotal=item.is_subtotal, spacer_after=item.spacer_after,
            ))
            continue
        monthly_value = resolve(item.key)
        yearly_value = monthly_value * 12
        results.append(ComputedLineItem(
            label=item.label, section=item.section,
            yearly=round(yearly_value, 2), monthly=round(monthly_value, 2),
            is_subtotal=item.is_subtotal, spacer_after=item.spacer_after,
        ))
    return results
