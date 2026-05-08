from datetime import datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.dispatch import Dispatch
from app.models.supplier_quote import SupplierQuote, SupplierQuoteItem
from app.schemas.quote import SupplierQuoteOut
from app.schemas.common import Page, Msg
from app.services.op_log import log

router = APIRouter(prefix="/supplier-quotes", tags=["supplier-quotes"])


@router.get("", response_model=Page[SupplierQuoteOut])
def list_quotes(
    inquiry_id: int | None = None,
    supplier_id: int | None = None,
    status: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(SupplierQuote)
    if inquiry_id:
        q = q.filter(SupplierQuote.inquiry_id == inquiry_id)
    if supplier_id:
        q = q.filter(SupplierQuote.supplier_id == supplier_id)
    if status:
        q = q.filter(SupplierQuote.status == status)
    total = q.count()
    items = q.order_by(SupplierQuote.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return Page[SupplierQuoteOut](items=items, total=total, page=page, page_size=page_size)


@router.get("/{qid}", response_model=SupplierQuoteOut)
def get_quote(qid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(SupplierQuote, qid)
    if not obj:
        raise HTTPException(404, "报价单不存在")
    return obj


@router.post("/{qid}/adopt", response_model=SupplierQuoteOut)
def adopt_quote(qid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    obj = db.get(SupplierQuote, qid)
    if not obj:
        raise HTTPException(404, "报价单不存在")
    obj.status = "adopted"
    log(db, entity="supplier_quote", entity_id=qid, action="adopt", user_id=user.id)
    db.commit()
    db.refresh(obj)
    return obj


@router.post("/{qid}/void", response_model=SupplierQuoteOut)
def void_quote(qid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    obj = db.get(SupplierQuote, qid)
    if not obj:
        raise HTTPException(404, "报价单不存在")
    obj.status = "void"
    log(db, entity="supplier_quote", entity_id=qid, action="void", user_id=user.id)
    db.commit()
    db.refresh(obj)
    return obj
