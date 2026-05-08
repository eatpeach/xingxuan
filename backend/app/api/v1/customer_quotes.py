from datetime import datetime, timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.inquiry import Inquiry, InquiryItem
from app.models.supplier_quote import SupplierQuoteItem
from app.models.customer_quote import CustomerQuote, CustomerQuoteItem
from app.schemas.quote import CustomerQuoteBuildIn, CustomerQuoteOut
from app.schemas.common import Page, Msg
from app.services.numbering import next_customer_quote_no
from app.services.markup import CalcLine, apply_markup
from app.services.settings import get_bool, get_setting
from app.services.op_log import log

router = APIRouter(prefix="/customer-quotes", tags=["customer-quotes"])


@router.get("", response_model=Page[CustomerQuoteOut])
def list_quotes(
    customer_id: int | None = None,
    inquiry_id: int | None = None,
    status: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(CustomerQuote)
    if customer_id:
        q = q.filter(CustomerQuote.customer_id == customer_id)
    if inquiry_id:
        q = q.filter(CustomerQuote.inquiry_id == inquiry_id)
    if status:
        q = q.filter(CustomerQuote.status == status)
    total = q.count()
    items = q.order_by(CustomerQuote.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return Page[CustomerQuoteOut](items=items, total=total, page=page, page_size=page_size)


@router.post("/build", response_model=CustomerQuoteOut)
def build_quote(body: CustomerQuoteBuildIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    inq = db.get(Inquiry, body.inquiry_id)
    if not inq:
        raise HTTPException(404, "询价单不存在")

    hide_default = get_bool(db, "hide_supplier_brand_default", True)

    # 准备计算行
    inq_item_map = {it.id: it for it in inq.items}
    src_map: dict[int, SupplierQuoteItem] = {}
    calc_lines: list[CalcLine] = []
    quote_items_data: list[dict] = []

    for li in body.items:
        inq_item = inq_item_map.get(li.inquiry_item_id)
        if not inq_item:
            raise HTTPException(400, f"明细 {li.inquiry_item_id} 不属于该询价单")
        src = None
        if li.source_supplier_quote_item_id:
            src = db.get(SupplierQuoteItem, li.source_supplier_quote_item_id)
            if src:
                src_map[li.inquiry_item_id] = src

        cost = li.cost_price if li.cost_price is not None else (src.supplier_price if src else Decimal("0"))
        qty = li.qty if li.qty is not None else inq_item.qty

        cl = CalcLine(
            inquiry_item_id=li.inquiry_item_id,
            cost_price=Decimal(cost),
            qty=Decimal(qty),
            sell_price_override=li.sell_price_override,
        )
        calc_lines.append(cl)

        show_brand = li.show_brand if li.show_brand is not None else (not hide_default)
        quote_items_data.append({
            "inquiry_item_id": li.inquiry_item_id,
            "source_supplier_quote_item_id": src.id if src else None,
            "show_brand": show_brand,
            "brand_display": li.brand_display or (src.brand if (src and show_brand) else ""),
            "model_display": li.model_display or (src.model if (src and show_brand) else ""),
            "product_name": li.product_name or inq_item.product_name,
            "spec": li.spec or inq_item.spec,
            "unit": li.unit or inq_item.unit,
            "qty": qty,
        })

    total = apply_markup(calc_lines, body.markup.model_dump())

    valid_until = body.valid_until
    if not valid_until:
        days = int(get_setting(db, "default_quote_valid_days", "7") or "7")
        valid_until = datetime.utcnow() + timedelta(days=days)

    cq = CustomerQuote(
        no=next_customer_quote_no(db),
        inquiry_id=inq.id,
        customer_id=inq.customer_id,
        status="draft",
        markup_strategy=body.markup.model_dump(),
        total=total,
        valid_until=valid_until,
        remark=body.remark,
        created_by=user.id,
    )
    db.add(cq)
    db.flush()

    for cl, qd in zip(calc_lines, quote_items_data):
        db.add(CustomerQuoteItem(
            quote_id=cq.id,
            **qd,
            cost_price=cl.cost_price,
            sell_price=cl.sell_price,
            markup_amount=cl.markup_amount,
        ))

    if inq.status in ("dispatching", "quoted"):
        inq.status = "quoted"

    log(db, entity="customer_quote", entity_id=cq.id, action="build", user_id=user.id, detail=cq.no)
    db.commit()
    db.refresh(cq)
    return cq


@router.get("/{qid}", response_model=CustomerQuoteOut)
def get_quote(qid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(CustomerQuote, qid)
    if not obj:
        raise HTTPException(404, "报价单不存在")
    return obj


@router.post("/{qid}/send", response_model=CustomerQuoteOut)
def send_quote(qid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    obj = db.get(CustomerQuote, qid)
    if not obj:
        raise HTTPException(404, "报价单不存在")
    obj.status = "sent"
    obj.sent_at = datetime.utcnow()
    inq = db.get(Inquiry, obj.inquiry_id)
    if inq and inq.status == "quoted":
        inq.status = "delivered"
    log(db, entity="customer_quote", entity_id=qid, action="send", user_id=user.id)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{qid}", response_model=Msg)
def delete_quote(qid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(CustomerQuote, qid)
    if not obj:
        raise HTTPException(404, "报价单不存在")
    if obj.status not in ("draft", "to_review"):
        raise HTTPException(400, "已发送或确认的报价不能删除")
    db.delete(obj)
    db.commit()
    return Msg()
