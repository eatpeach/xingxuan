from pydantic import BaseModel
from datetime import datetime
from decimal import Decimal


class InquiryItemIn(BaseModel):
    line_no: int = 1
    product_name: str
    spec: str = ""
    unit: str = "件"
    qty: Decimal = Decimal("1")
    target_price: Decimal | None = None
    remark: str = ""


class InquiryItemOut(InquiryItemIn):
    id: int

    class Config:
        from_attributes = True


class InquiryIn(BaseModel):
    customer_id: int
    title: str = ""
    deadline: datetime | None = None
    remark: str = ""
    items: list[InquiryItemIn] = []


class InquiryOut(BaseModel):
    id: int
    no: str
    customer_id: int
    title: str
    status: str
    deadline: datetime | None
    remark: str
    created_by: int | None
    created_at: datetime
    updated_at: datetime
    items: list[InquiryItemOut] = []

    class Config:
        from_attributes = True


class DispatchIn(BaseModel):
    supplier_ids: list[int]
    expire_days: int = 7


class DispatchOut(BaseModel):
    id: int
    inquiry_id: int
    supplier_id: int
    token: str
    status: str
    sent_at: datetime | None
    responded_at: datetime | None
    token_expire_at: datetime | None

    class Config:
        from_attributes = True
