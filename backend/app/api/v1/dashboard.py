from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.customer import Customer
from app.models.inquiry import Inquiry
from app.models.dispatch import Dispatch
from app.models.customer_quote import CustomerQuote

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/overview")
def overview(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return {
        "customers": db.query(func.count(Customer.id)).scalar() or 0,
        "inquiries_total": db.query(func.count(Inquiry.id)).scalar() or 0,
        "inquiries_pending": db.query(func.count(Inquiry.id))
            .filter(Inquiry.status.in_(("draft", "to_dispatch", "dispatching"))).scalar() or 0,
        "dispatch_pending_response": db.query(func.count(Dispatch.id))
            .filter(Dispatch.status.in_(("pending", "sent"))).scalar() or 0,
        "quotes_draft": db.query(func.count(CustomerQuote.id))
            .filter(CustomerQuote.status.in_(("draft", "to_review"))).scalar() or 0,
        "quotes_sent": db.query(func.count(CustomerQuote.id))
            .filter(CustomerQuote.status == "sent").scalar() or 0,
    }
