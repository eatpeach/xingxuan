from sqlalchemy import String, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
from app.db.base import Base, TimestampMixin


# 派单状态
DISPATCH_STATUS = ("pending", "sent", "responded", "expired", "void")


class Dispatch(Base, TimestampMixin):
    """一询多供：一条 = 把某询价单派给某个供应商"""
    __tablename__ = "dispatches"
    __table_args__ = (UniqueConstraint("inquiry_id", "supplier_id", name="uq_dispatch_inquiry_supplier"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    inquiry_id: Mapped[int] = mapped_column(ForeignKey("inquiries.id", ondelete="CASCADE"), index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # 供应商无账号填报凭证
    token_expire_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
