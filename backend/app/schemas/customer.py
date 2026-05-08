from pydantic import BaseModel
from datetime import datetime


class CustomerIn(BaseModel):
    name: str
    company: str = ""
    phone: str = ""
    email: str = ""
    wechat: str = ""
    address: str = ""
    source: str = ""
    sales_id: int | None = None
    remark: str = ""


class CustomerOut(CustomerIn):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
