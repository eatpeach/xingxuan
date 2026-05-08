"""加价计算

输入：每行 cost_price + qty + 可选 sell_price_override + 可选 category；策略 dict
输出：补全 sell_price 和 markup_amount，并算总价
"""
from decimal import Decimal, ROUND_HALF_UP
from dataclasses import dataclass


@dataclass
class CalcLine:
    inquiry_item_id: int
    cost_price: Decimal
    qty: Decimal
    category: str = ""
    sell_price_override: Decimal | None = None
    sell_price: Decimal = Decimal("0")
    markup_amount: Decimal = Decimal("0")


def _q(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _stepped_pct(amount: Decimal, ladders: list[dict]) -> Decimal:
    """ladders: [{lt: 100, pct: 30}, {lt: 1000, pct: 20}, {pct: 10}]"""
    for lvl in ladders:
        lt = lvl.get("lt")
        if lt is None or amount < Decimal(str(lt)):
            return Decimal(str(lvl.get("pct", 0)))
    return Decimal("0")


def apply_markup(lines: list[CalcLine], strategy: dict) -> Decimal:
    """就地修改 lines.sell_price/markup_amount，返回总价。"""
    s_type = strategy.get("type", "flat_pct")
    s_value = Decimal(str(strategy.get("value", 0))) if strategy.get("value") is not None else Decimal("0")
    payload = strategy.get("payload") or {}

    total = Decimal("0")
    for ln in lines:
        if ln.sell_price_override is not None:
            sell = ln.sell_price_override
        elif s_type == "flat_pct":
            sell = ln.cost_price * (Decimal("1") + s_value / Decimal("100"))
        elif s_type == "per_item_pct":
            pct = Decimal(str(payload.get(str(ln.inquiry_item_id), 0)))
            sell = ln.cost_price * (Decimal("1") + pct / Decimal("100"))
        elif s_type == "per_item_fixed":
            add = Decimal(str(payload.get(str(ln.inquiry_item_id), 0)))
            sell = ln.cost_price + add
        elif s_type == "category_pct":
            pct = Decimal(str(payload.get(ln.category, 0)))
            sell = ln.cost_price * (Decimal("1") + pct / Decimal("100"))
        elif s_type == "stepped":
            pct = _stepped_pct(ln.cost_price, payload.get("ladders", []))
            sell = ln.cost_price * (Decimal("1") + pct / Decimal("100"))
        else:
            sell = ln.cost_price

        ln.sell_price = _q(sell)
        ln.markup_amount = _q(ln.sell_price - ln.cost_price)
        total += ln.sell_price * ln.qty

    return _q(total)
