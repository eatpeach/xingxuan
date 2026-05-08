from sqlalchemy import String, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, TimestampMixin


class Customer(Base, TimestampMixin):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    company: Mapped[str] = mapped_column(String(255), default="")
    phone: Mapped[str] = mapped_column(String(32), default="", index=True)
    email: Mapped[str] = mapped_column(String(128), default="")
    wechat: Mapped[str] = mapped_column(String(64), default="")
    address: Mapped[str] = mapped_column(String(255), default="")
    source: Mapped[str] = mapped_column(String(32), default="")  # 来源
    sales_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    remark: Mapped[str] = mapped_column(Text, default="")
