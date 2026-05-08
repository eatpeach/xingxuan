from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, TimestampMixin


class SystemSetting(Base, TimestampMixin):
    """KV 形式的系统设置，支持后台开关。
    已用 key：
      hide_supplier_brand_default   报价对客户默认隐藏品牌型号 (true/false)
      company_name                  星选公司抬头
      pdf_logo_path                 报价单 PDF logo 路径
    """
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(String(255), default="")
