from sqlalchemy import String, ForeignKey, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, TimestampMixin


class OpLog(Base, TimestampMixin):
    """操作日志：谁在什么时候对哪个实体做了什么"""
    __tablename__ = "op_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    actor_label: Mapped[str] = mapped_column(String(64), default="")  # 没登录的供应商等场景
    entity: Mapped[str] = mapped_column(String(32), index=True)        # inquiry/customer_quote/...
    entity_id: Mapped[int] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(32))                    # create/update/dispatch/...
    detail: Mapped[str] = mapped_column(Text, default="")
