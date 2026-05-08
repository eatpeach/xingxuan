from sqlalchemy import String, Integer, ForeignKey, Text, Numeric, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from decimal import Decimal
from app.db.base import Base, TimestampMixin


# 询价单状态
INQUIRY_STATUS = ("draft", "to_dispatch", "dispatching", "quoted", "delivered", "won", "closed")


class Inquiry(Base, TimestampMixin):
    __tablename__ = "inquiries"

    id: Mapped[int] = mapped_column(primary_key=True)
    no: Mapped[str] = mapped_column(String(32), unique=True, index=True)  # XQ20260508001
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(16), default="draft")
    deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    remark: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    items: Mapped[list["InquiryItem"]] = relationship(back_populates="inquiry", cascade="all, delete-orphan")
    attachments: Mapped[list["InquiryAttachment"]] = relationship(back_populates="inquiry", cascade="all, delete-orphan")


class InquiryItem(Base):
    __tablename__ = "inquiry_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    inquiry_id: Mapped[int] = mapped_column(ForeignKey("inquiries.id", ondelete="CASCADE"), index=True)
    line_no: Mapped[int] = mapped_column(Integer, default=1)
    product_name: Mapped[str] = mapped_column(String(255))
    spec: Mapped[str] = mapped_column(String(255), default="")
    unit: Mapped[str] = mapped_column(String(16), default="件")
    qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("1"))
    target_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    remark: Mapped[str] = mapped_column(String(255), default="")

    inquiry: Mapped["Inquiry"] = relationship(back_populates="items")


class InquiryAttachment(Base, TimestampMixin):
    __tablename__ = "inquiry_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    inquiry_id: Mapped[int] = mapped_column(ForeignKey("inquiries.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(500))
    size: Mapped[int] = mapped_column(Integer, default=0)

    inquiry: Mapped["Inquiry"] = relationship(back_populates="attachments")
