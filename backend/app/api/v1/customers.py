from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.core.deps import get_db, get_current_user
from app.models.customer import Customer
from app.models.user import User
from app.schemas.customer import CustomerIn, CustomerOut
from app.schemas.common import Page, Msg

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=Page[CustomerOut])
def list_customers(
    keyword: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Customer)
    if keyword:
        kw = f"%{keyword}%"
        q = q.filter(or_(Customer.name.like(kw), Customer.phone.like(kw), Customer.company.like(kw)))
    total = q.count()
    items = q.order_by(Customer.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return Page[CustomerOut](items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=CustomerOut)
def create_customer(body: CustomerIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    obj = Customer(**body.model_dump())
    if obj.sales_id is None:
        obj.sales_id = user.id
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/{cid}", response_model=CustomerOut)
def get_customer(cid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(Customer, cid)
    if not obj:
        raise HTTPException(404, "客户不存在")
    return obj


@router.put("/{cid}", response_model=CustomerOut)
def update_customer(cid: int, body: CustomerIn, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(Customer, cid)
    if not obj:
        raise HTTPException(404, "客户不存在")
    for k, v in body.model_dump().items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{cid}", response_model=Msg)
def delete_customer(cid: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    obj = db.get(Customer, cid)
    if not obj:
        raise HTTPException(404, "客户不存在")
    db.delete(obj)
    db.commit()
    return Msg()
