from sqlalchemy import String, Integer, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, TimestampMixin


class Supplier(Base, TimestampMixin):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    contact: Mapped[str] = mapped_column(String(64), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    email: Mapped[str] = mapped_column(String(128), default="")
    category: Mapped[str] = mapped_column(String(64), default="")  # 瓷砖/木地板/卫浴 等
    rating: Mapped[int] = mapped_column(Integer, default=0)        # 0-5
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    remark: Mapped[str] = mapped_column(Text, default="")
