from sqlalchemy.orm import Session
from app.models.system_setting import SystemSetting

DEFAULTS: dict[str, tuple[str, str]] = {
    # key: (default_value, description)
    "hide_supplier_brand_default": ("true", "客户报价单默认隐藏供应商品牌型号"),
    "company_name": ("星选建材", "对外公司抬头"),
    "pdf_logo_path": ("", "报价单 PDF logo 文件路径（相对 storage）"),
    "default_markup_pct": ("15", "默认整单加价百分比"),
    "default_quote_valid_days": ("7", "默认报价单有效天数"),
}


def get_setting(db: Session, key: str, default: str | None = None) -> str:
    row = db.get(SystemSetting, key)
    if row:
        return row.value
    if key in DEFAULTS:
        return DEFAULTS[key][0]
    return default or ""


def get_bool(db: Session, key: str, default: bool = False) -> bool:
    val = get_setting(db, key, "true" if default else "false").strip().lower()
    return val in ("1", "true", "yes", "on")


def set_setting(db: Session, key: str, value: str) -> SystemSetting:
    row = db.get(SystemSetting, key)
    if not row:
        desc = DEFAULTS.get(key, ("", ""))[1]
        row = SystemSetting(key=key, value=value, description=desc)
        db.add(row)
    else:
        row.value = value
    db.flush()
    return row


def ensure_defaults(db: Session) -> None:
    for k, (v, desc) in DEFAULTS.items():
        if not db.get(SystemSetting, k):
            db.add(SystemSetting(key=k, value=v, description=desc))
    db.flush()
