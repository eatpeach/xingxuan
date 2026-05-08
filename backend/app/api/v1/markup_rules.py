from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.markup_rule import MarkupRule, RULE_TYPES
from app.schemas.common import Msg
from pydantic import BaseModel
from decimal import Decimal

router = APIRouter(prefix="/markup-rules", tags=["markup-rules"])


class MarkupRuleIn(BaseModel):
    name: str
    type: str
    value: Decimal | None = None
    payload: dict | None = None
    is_default: bool = False
    remark: str = ""


class MarkupRuleOut(MarkupRuleIn):
    id: int

    class Config:
        from_attributes = True


@router.get("", response_model=list[MarkupRuleOut])
def list_rules(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(MarkupRule).order_by(MarkupRule.id.desc()).all()


@router.post("", response_model=MarkupRuleOut)
def create_rule(body: MarkupRuleIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if body.type not in RULE_TYPES:
        raise HTTPException(400, "未知策略类型")
    if body.is_default:
        db.query(MarkupRule).filter(MarkupRule.is_default == True).update({"is_default": False})
    obj = MarkupRule(**body.model_dump(), created_by=user.id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{rid}", response_model=MarkupRuleOut)
def update_rule(rid: int, body: MarkupRuleIn, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(MarkupRule, rid)
    if not obj:
        raise HTTPException(404, "策略不存在")
    if body.is_default:
        db.query(MarkupRule).filter(MarkupRule.is_default == True, MarkupRule.id != rid).update({"is_default": False})
    for k, v in body.model_dump().items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{rid}", response_model=Msg)
def delete_rule(rid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(MarkupRule, rid)
    if not obj:
        raise HTTPException(404, "策略不存在")
    db.delete(obj)
    db.commit()
    return Msg()
