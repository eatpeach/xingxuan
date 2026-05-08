from sqlalchemy import String, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(64), default="")
    role: Mapped[str] = mapped_column(String(16), default="sales")  # admin / sales / operator
    phone: Mapped[str] = mapped_column(String(32), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
