from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.core.deps import get_db, get_current_user
from app.models.supplier import Supplier
from app.models.user import User
from app.schemas.supplier import SupplierIn, SupplierOut
from app.schemas.common import Page, Msg

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@router.get("", response_model=Page[SupplierOut])
def list_suppliers(
    keyword: str = "",
    category: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Supplier)
    if keyword:
        kw = f"%{keyword}%"
        q = q.filter(or_(Supplier.name.like(kw), Supplier.contact.like(kw), Supplier.phone.like(kw)))
    if category:
        q = q.filter(Supplier.category == category)
    total = q.count()
    items = q.order_by(Supplier.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return Page[SupplierOut](items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=SupplierOut)
def create_supplier(body: SupplierIn, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = Supplier(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/{sid}", response_model=SupplierOut)
def get_supplier(sid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(Supplier, sid)
    if not obj:
        raise HTTPException(404, "供应商不存在")
    return obj


@router.put("/{sid}", response_model=SupplierOut)
def update_supplier(sid: int, body: SupplierIn, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(Supplier, sid)
    if not obj:
        raise HTTPException(404, "供应商不存在")
    for k, v in body.model_dump().items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{sid}", response_model=Msg)
def delete_supplier(sid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(Supplier, sid)
    if not obj:
        raise HTTPException(404, "供应商不存在")
    db.delete(obj)
    db.commit()
    return Msg()
