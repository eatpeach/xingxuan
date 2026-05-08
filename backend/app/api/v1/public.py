"""公开接口：供应商凭 token 提交报价；客户公开询价表单"""
from datetime import datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.deps import get_db
from app.models.dispatch import Dispatch
from app.models.supplier import Supplier
from app.models.inquiry import Inquiry
from app.models.supplier_quote import SupplierQuote, SupplierQuoteItem
from app.schemas.quote import SupplierQuoteIn, SupplierQuoteOut
from app.services.numbering import next_supplier_quote_no
from app.services.op_log import log

router = APIRouter(prefix="/public", tags=["public"])


def _load_dispatch(db: Session, token: str) -> Dispatch:
    d = db.query(Dispatch).filter(Dispatch.token == token).first()
    if not d:
        raise HTTPException(404, "链接无效")
    if d.token_expire_at and d.token_expire_at < datetime.utcnow():
        raise HTTPException(410, "链接已过期")
    if d.status == "void":
        raise HTTPException(410, "链接已作废")
    return d


@router.get("/quote/{token}")
def get_inquiry_for_supplier(token: str, db: Session = Depends(get_db)):
    """供应商打开链接：返回询价单 + 明细 + 已提交报价（可继续编辑）"""
    d = _load_dispatch(db, token)
    inq = db.get(Inquiry, d.inquiry_id)
    sup = db.get(Supplier, d.supplier_id)
    existing = (
        db.query(SupplierQuote)
        .filter(SupplierQuote.dispatch_id == d.id)
        .order_by(SupplierQuote.id.desc())
        .first()
    )
    return {
        "supplier": {"id": sup.id, "name": sup.name} if sup else None,
        "inquiry": {
            "id": inq.id,
            "no": inq.no,
            "title": inq.title,
            "remark": inq.remark,
            "deadline": inq.deadline,
            "items": [
                {
                    "id": it.id,
                    "line_no": it.line_no,
                    "product_name": it.product_name,
                    "spec": it.spec,
                    "unit": it.unit,
                    "qty": float(it.qty),
                    "remark": it.remark,
                }
                for it in sorted(inq.items, key=lambda x: x.line_no)
            ],
        },
        "existing_quote": (
            {
                "id": existing.id,
                "no": existing.no,
                "status": existing.status,
                "remark": existing.remark,
                "valid_until": existing.valid_until,
                "items": [
                    {
                        "inquiry_item_id": qi.inquiry_item_id,
                        "brand": qi.brand,
                        "model": qi.model,
                        "spec": qi.spec,
                        "supplier_price": float(qi.supplier_price),
                        "qty": float(qi.qty),
                        "unit": qi.unit,
                        "lead_time": qi.lead_time,
                        "remark": qi.remark,
                    }
                    for qi in existing.items
                ],
            }
            if existing
            else None
        ),
    }


@router.post("/quote/{token}/submit", response_model=SupplierQuoteOut)
def submit_quote(token: str, body: SupplierQuoteIn, db: Session = Depends(get_db)):
    d = _load_dispatch(db, token)
    inq_item_ids = {it.id for it in db.get(Inquiry, d.inquiry_id).items}

    # 同一 dispatch 已有报价则覆盖（删旧建新，保号）
    old = (
        db.query(SupplierQuote)
        .filter(SupplierQuote.dispatch_id == d.id, SupplierQuote.status != "adopted")
        .first()
    )
    if old:
        no = old.no
        db.delete(old)
        db.flush()
    else:
        no = next_supplier_quote_no(db)

    total = Decimal("0")
    quote = SupplierQuote(
        no=no,
        dispatch_id=d.id,
        supplier_id=d.supplier_id,
        inquiry_id=d.inquiry_id,
        status="submitted",
        remark=body.remark,
        valid_until=body.valid_until,
    )
    db.add(quote)
    db.flush()

    for it in body.items:
        if it.inquiry_item_id not in inq_item_ids:
            continue
        line_total = it.supplier_price * it.qty
        total += line_total
        db.add(SupplierQuoteItem(
            quote_id=quote.id,
            inquiry_item_id=it.inquiry_item_id,
            brand=it.brand,
            model=it.model,
            spec=it.spec,
            supplier_price=it.supplier_price,
            qty=it.qty,
            unit=it.unit,
            lead_time=it.lead_time,
            remark=it.remark,
        ))

    quote.total = total
    d.status = "responded"
    d.responded_at = datetime.utcnow()

    inq = db.get(Inquiry, d.inquiry_id)
    # 是否所有派单都已回报
    pending = db.query(Dispatch).filter(
        Dispatch.inquiry_id == inq.id,
        Dispatch.status.in_(("pending", "sent")),
    ).count()
    if pending == 0 and inq.status == "dispatching":
        inq.status = "quoted"

    log(db, entity="supplier_quote", entity_id=quote.id, action="submit",
        actor_label=f"supplier:{d.supplier_id}", detail=quote.no)
    db.commit()
    db.refresh(quote)
    return quote
