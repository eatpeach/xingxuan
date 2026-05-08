from sqlalchemy import String, Integer, ForeignKey, Numeric, DateTime, Text, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from decimal import Decimal
from app.db.base import Base, TimestampMixin


CUSTOMER_QUOTE_STATUS = ("draft", "to_review", "sent", "confirmed", "expired")


class CustomerQuote(Base, TimestampMixin):
    __tablename__ = "customer_quotes"

    id: Mapped[int] = mapped_column(primary_key=True)
    no: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    inquiry_id: Mapped[int] = mapped_column(ForeignKey("inquiries.id", ondelete="CASCADE"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    # 加价策略快照（落库便于历史回溯）
    markup_strategy: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    valid_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    exported_pdf_path: Mapped[str] = mapped_column(String(500), default="")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    remark: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    items: Mapped[list["CustomerQuoteItem"]] = relationship(back_populates="quote", cascade="all, delete-orphan")


class CustomerQuoteItem(Base):
    __tablename__ = "customer_quote_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    quote_id: Mapped[int] = mapped_column(ForeignKey("customer_quotes.id", ondelete="CASCADE"), index=True)
    inquiry_item_id: Mapped[int] = mapped_column(ForeignKey("inquiry_items.id"), index=True)
    source_supplier_quote_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("supplier_quote_items.id"), nullable=True
    )
    # 给客户展示的字段（可与供应商不同 / 可隐藏）
    show_brand: Mapped[bool] = mapped_column(Boolean, default=False)
    brand_display: Mapped[str] = mapped_column(String(128), default="")
    model_display: Mapped[str] = mapped_column(String(128), default="")
    product_name: Mapped[str] = mapped_column(String(255), default="")
    spec: Mapped[str] = mapped_column(String(255), default="")
    unit: Mapped[str] = mapped_column(String(16), default="件")
    qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("1"))
    cost_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))   # 来自供应商
    sell_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))   # 加价后
    markup_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    remark: Mapped[str] = mapped_column(String(255), default="")

    quote: Mapped["CustomerQuote"] = relationship(back_populates="items")
