from sqlalchemy import String, Integer, ForeignKey, Numeric, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from decimal import Decimal
from app.db.base import Base, TimestampMixin


SUPPLIER_QUOTE_STATUS = ("draft", "submitted", "adopted", "void")


class SupplierQuote(Base, TimestampMixin):
    __tablename__ = "supplier_quotes"

    id: Mapped[int] = mapped_column(primary_key=True)
    no: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    dispatch_id: Mapped[int] = mapped_column(ForeignKey("dispatches.id", ondelete="CASCADE"), index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), index=True)
    inquiry_id: Mapped[int] = mapped_column(ForeignKey("inquiries.id", ondelete="CASCADE"), index=True)
    total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    valid_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    attachment_path: Mapped[str] = mapped_column(String(500), default="")
    remark: Mapped[str] = mapped_column(Text, default="")

    items: Mapped[list["SupplierQuoteItem"]] = relationship(back_populates="quote", cascade="all, delete-orphan")


class SupplierQuoteItem(Base):
    __tablename__ = "supplier_quote_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    quote_id: Mapped[int] = mapped_column(ForeignKey("supplier_quotes.id", ondelete="CASCADE"), index=True)
    inquiry_item_id: Mapped[int] = mapped_column(ForeignKey("inquiry_items.id"), index=True)
    brand: Mapped[str] = mapped_column(String(128), default="")
    model: Mapped[str] = mapped_column(String(128), default="")
    spec: Mapped[str] = mapped_column(String(255), default="")
    supplier_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("1"))
    unit: Mapped[str] = mapped_column(String(16), default="件")
    lead_time: Mapped[str] = mapped_column(String(64), default="")  # 货期 文本
    remark: Mapped[str] = mapped_column(String(255), default="")

    quote: Mapped["SupplierQuote"] = relationship(back_populates="items")
