from sqlalchemy import String, Numeric, JSON, Boolean, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from decimal import Decimal
from app.db.base import Base, TimestampMixin


# 加价策略类型：
#   flat_pct        整单按百分比
#   per_item_pct    按单品百分比（payload: {item_id: pct}）
#   per_item_fixed  按单品加固定金额（payload: {item_id: amount}）
#   category_pct    按品类百分比（payload: {category: pct}）
#   stepped         阶梯（payload: [{lt: 100, pct: 30}, {lt: 1000, pct: 20}]）
RULE_TYPES = ("flat_pct", "per_item_pct", "per_item_fixed", "category_pct", "stepped")


class MarkupRule(Base, TimestampMixin):
    __tablename__ = "markup_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    type: Mapped[str] = mapped_column(String(32))
    value: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    remark: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
