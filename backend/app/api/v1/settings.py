from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.deps import get_db, get_current_user, require_role
from app.models.user import User
from app.models.system_setting import SystemSetting
from app.schemas.setting import SettingItem, SettingUpdateIn
from app.services.settings import DEFAULTS, ensure_defaults

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=list[SettingItem])
def list_settings(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    ensure_defaults(db)
    db.commit()
    rows = db.query(SystemSetting).order_by(SystemSetting.key.asc()).all()
    return rows


@router.put("/{key}", response_model=SettingItem)
def update_setting(key: str, body: SettingUpdateIn, db: Session = Depends(get_db),
                   _: User = Depends(require_role("admin"))):
    if key not in DEFAULTS:
        raise HTTPException(400, "未知配置项")
    row = db.get(SystemSetting, key)
    if not row:
        row = SystemSetting(key=key, value=body.value, description=DEFAULTS[key][1])
        db.add(row)
    else:
        row.value = body.value
    db.commit()
    db.refresh(row)
    return row
