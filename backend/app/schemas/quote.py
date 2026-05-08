from pydantic import BaseModel
from datetime import datetime
from decimal import Decimal


class SupplierQuoteItemIn(BaseModel):
    inquiry_item_id: int
    brand: str = ""
    model: str = ""
    spec: str = ""
    supplier_price: Decimal = Decimal("0")
    qty: Decimal = Decimal("1")
    unit: str = "件"
    lead_time: str = ""
    remark: str = ""


class SupplierQuoteItemOut(SupplierQuoteItemIn):
    id: int

    class Config:
        from_attributes = True


class SupplierQuoteIn(BaseModel):
    valid_until: datetime | None = None
    remark: str = ""
    items: list[SupplierQuoteItemIn]


class SupplierQuoteOut(BaseModel):
    id: int
    no: str
    dispatch_id: int
    supplier_id: int
    inquiry_id: int
    total: Decimal
    valid_until: datetime | None
    status: str
    attachment_path: str
    remark: str
    items: list[SupplierQuoteItemOut] = []
    created_at: datetime

    class Config:
        from_attributes = True


# 客户报价相关
class MarkupStrategy(BaseModel):
    type: str  # flat_pct / per_item_pct / per_item_fixed / category_pct / stepped
    value: Decimal | None = None
    payload: dict | None = None


class CustomerQuoteItemBuild(BaseModel):
    inquiry_item_id: int
    source_supplier_quote_item_id: int | None = None
    show_brand: bool | None = None  # None = 走系统设置默认
    brand_display: str = ""
    model_display: str = ""
    product_name: str = ""
    spec: str = ""
    unit: str = "件"
    qty: Decimal | None = None
    cost_price: Decimal | None = None
    sell_price_override: Decimal | None = None
    remark: str = ""


class CustomerQuoteBuildIn(BaseModel):
    inquiry_id: int
    valid_until: datetime | None = None
    remark: str = ""
    markup: MarkupStrategy
    items: list[CustomerQuoteItemBuild]


class CustomerQuoteItemOut(BaseModel):
    id: int
    inquiry_item_id: int
    source_supplier_quote_item_id: int | None
    show_brand: bool
    brand_display: str
    model_display: str
    product_name: str
    spec: str
    unit: str
    qty: Decimal
    cost_price: Decimal
    sell_price: Decimal
    markup_amount: Decimal
    remark: str

    class Config:
        from_attributes = True


class CustomerQuoteOut(BaseModel):
    id: int
    no: str
    inquiry_id: int
    customer_id: int
    status: str
    markup_strategy: dict | None
    total: Decimal
    valid_until: datetime | None
    exported_pdf_path: str
    sent_at: datetime | None
    remark: str
    items: list[CustomerQuoteItemOut] = []
    created_at: datetime

    class Config:
        from_attributes = True
