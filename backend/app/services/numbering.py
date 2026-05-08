from datetime import datetime
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models.inquiry import Inquiry
from app.models.supplier_quote import SupplierQuote
from app.models.customer_quote import CustomerQuote


def _next_no(db: Session, model, prefix: str) -> str:
    today = datetime.now().strftime("%Y%m%d")
    like = f"{prefix}{today}%"
    last = db.query(func.max(model.no)).filter(model.no.like(like)).scalar()
    seq = int(last[-3:]) + 1 if last else 1
    return f"{prefix}{today}{seq:03d}"


def next_inquiry_no(db: Session) -> str:
    return _next_no(db, Inquiry, "XQ")


def next_supplier_quote_no(db: Session) -> str:
    return _next_no(db, SupplierQuote, "GB")


def next_customer_quote_no(db: Session) -> str:
    return _next_no(db, CustomerQuote, "BJ")
