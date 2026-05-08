from pydantic import BaseModel
from datetime import datetime


class SupplierIn(BaseModel):
    name: str
    contact: str = ""
    phone: str = ""
    email: str = ""
    category: str = ""
    rating: int = 0
    is_active: bool = True
    remark: str = ""


class SupplierOut(SupplierIn):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
