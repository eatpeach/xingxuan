from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.core.deps import get_db, get_current_user
from app.core.config import settings as app_settings
from app.models.user import User
from app.models.customer import Customer
from app.models.supplier import Supplier
from app.models.inquiry import Inquiry, InquiryItem, InquiryAttachment
from app.models.dispatch import Dispatch
from app.models.supplier_quote import SupplierQuote
from app.schemas.inquiry import InquiryIn, InquiryOut, DispatchIn, DispatchOut
from app.schemas.common import Page, Msg
from app.services.numbering import next_inquiry_no
from app.services.op_log import log
from app.utils.token import gen_token
from app.utils.storage import save_upload

router = APIRouter(prefix="/inquiries", tags=["inquiries"])


@router.get("", response_model=Page[InquiryOut])
def list_inquiries(
    keyword: str = "",
    status: str = "",
    customer_id: int | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Inquiry)
    if keyword:
        kw = f"%{keyword}%"
        q = q.filter(or_(Inquiry.no.like(kw), Inquiry.title.like(kw)))
    if status:
        q = q.filter(Inquiry.status == status)
    if customer_id:
        q = q.filter(Inquiry.customer_id == customer_id)
    total = q.count()
    items = q.order_by(Inquiry.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return Page[InquiryOut](items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=InquiryOut)
def create_inquiry(body: InquiryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not db.get(Customer, body.customer_id):
        raise HTTPException(400, "客户不存在")
    inq = Inquiry(
        no=next_inquiry_no(db),
        customer_id=body.customer_id,
        title=body.title,
        deadline=body.deadline,
        remark=body.remark,
        status="draft",
        created_by=user.id,
    )
    db.add(inq)
    db.flush()
    for idx, it in enumerate(body.items, start=1):
        db.add(InquiryItem(
            inquiry_id=inq.id,
            line_no=it.line_no or idx,
            product_name=it.product_name,
            spec=it.spec,
            unit=it.unit,
            qty=it.qty,
            target_price=it.target_price,
            remark=it.remark,
        ))
    log(db, entity="inquiry", entity_id=inq.id, action="create", user_id=user.id, detail=inq.no)
    db.commit()
    db.refresh(inq)
    return inq


@router.get("/{iid}", response_model=InquiryOut)
def get_inquiry(iid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(Inquiry, iid)
    if not obj:
        raise HTTPException(404, "询价单不存在")
    return obj


@router.put("/{iid}", response_model=InquiryOut)
def update_inquiry(iid: int, body: InquiryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    obj = db.get(Inquiry, iid)
    if not obj:
        raise HTTPException(404, "询价单不存在")
    if obj.status not in ("draft", "to_dispatch"):
        raise HTTPException(400, "当前状态不允许修改")
    obj.customer_id = body.customer_id
    obj.title = body.title
    obj.deadline = body.deadline
    obj.remark = body.remark
    # 简化：清空旧明细重建
    for it in list(obj.items):
        db.delete(it)
    db.flush()
    for idx, it in enumerate(body.items, start=1):
        db.add(InquiryItem(
            inquiry_id=obj.id,
            line_no=it.line_no or idx,
            product_name=it.product_name,
            spec=it.spec,
            unit=it.unit,
            qty=it.qty,
            target_price=it.target_price,
            remark=it.remark,
        ))
    log(db, entity="inquiry", entity_id=obj.id, action="update", user_id=user.id)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{iid}", response_model=Msg)
def delete_inquiry(iid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(Inquiry, iid)
    if not obj:
        raise HTTPException(404, "询价单不存在")
    db.delete(obj)
    db.commit()
    return Msg()


@router.post("/{iid}/attachments")
def upload_attachment(iid: int, file: UploadFile = File(...), db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    inq = db.get(Inquiry, iid)
    if not inq:
        raise HTTPException(404, "询价单不存在")
    rel, size = save_upload(file, "inquiry")
    att = InquiryAttachment(inquiry_id=iid, filename=file.filename, file_path=rel, size=size)
    db.add(att)
    db.commit()
    db.refresh(att)
    return {"id": att.id, "filename": att.filename, "file_path": att.file_path, "size": att.size}


# ---------- 派单 ----------

@router.post("/{iid}/dispatch", response_model=list[DispatchOut])
def dispatch_inquiry(iid: int, body: DispatchIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    inq = db.get(Inquiry, iid)
    if not inq:
        raise HTTPException(404, "询价单不存在")
    if not inq.items:
        raise HTTPException(400, "询价单无明细，无法派单")

    existing = {d.supplier_id for d in db.query(Dispatch).filter(Dispatch.inquiry_id == iid).all()}
    created: list[Dispatch] = []
    for sid in body.supplier_ids:
        if sid in existing:
            continue
        if not db.get(Supplier, sid):
            continue
        d = Dispatch(
            inquiry_id=iid,
            supplier_id=sid,
            token=gen_token(),
            token_expire_at=datetime.utcnow() + timedelta(days=body.expire_days),
            status="sent",
            sent_at=datetime.utcnow(),
        )
        db.add(d)
        db.flush()
        created.append(d)

    if inq.status in ("draft", "to_dispatch"):
        inq.status = "dispatching"

    log(db, entity="inquiry", entity_id=iid, action="dispatch", user_id=user.id,
        detail=f"派给 {len(created)} 个供应商")
    db.commit()
    for d in created:
        db.refresh(d)
    return created


@router.get("/{iid}/dispatches", response_model=list[DispatchOut])
def list_dispatches(iid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Dispatch).filter(Dispatch.inquiry_id == iid).order_by(Dispatch.id.asc()).all()


@router.get("/{iid}/share-links")
def share_links(iid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """返回每个供应商的填报链接，方便复制发送（微信/邮件等）"""
    rows = db.query(Dispatch).filter(Dispatch.inquiry_id == iid).all()
    base = app_settings.PUBLIC_BASE_URL.rstrip("/")
    out = []
    for d in rows:
        sup = db.get(Supplier, d.supplier_id)
        out.append({
            "dispatch_id": d.id,
            "supplier_id": d.supplier_id,
            "supplier_name": sup.name if sup else "",
            "url": f"{base}/p/quote/{d.token}",
            "expire_at": d.token_expire_at,
            "status": d.status,
        })
    return out


# ---------- 对比视图 ----------

@router.get("/{iid}/compare")
def compare_view(iid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    inq = db.get(Inquiry, iid)
    if not inq:
        raise HTTPException(404, "询价单不存在")
    quotes = (
        db.query(SupplierQuote)
        .filter(SupplierQuote.inquiry_id == iid, SupplierQuote.status.in_(("submitted", "adopted")))
        .all()
    )
    suppliers = {s.id: s for s in db.query(Supplier).all()}

    rows = []
    for it in sorted(inq.items, key=lambda x: x.line_no):
        line = {
            "inquiry_item_id": it.id,
            "line_no": it.line_no,
            "product_name": it.product_name,
            "spec": it.spec,
            "qty": float(it.qty),
            "unit": it.unit,
            "target_price": float(it.target_price) if it.target_price is not None else None,
            "offers": [],
        }
        for q in quotes:
            for qi in q.items:
                if qi.inquiry_item_id == it.id:
                    sup = suppliers.get(q.supplier_id)
                    line["offers"].append({
                        "supplier_quote_item_id": qi.id,
                        "supplier_quote_id": q.id,
                        "supplier_id": q.supplier_id,
                        "supplier_name": sup.name if sup else "",
                        "brand": qi.brand,
                        "model": qi.model,
                        "spec": qi.spec,
                        "supplier_price": float(qi.supplier_price),
                        "lead_time": qi.lead_time,
                        "remark": qi.remark,
                    })
        rows.append(line)
    return {"inquiry_id": iid, "rows": rows}
