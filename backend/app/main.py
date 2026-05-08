from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import (
    auth,
    customers,
    suppliers,
    inquiries,
    customer_quotes,
    supplier_quotes,
    settings as settings_api,
    markup_rules,
    public,
    dashboard,
)

app = FastAPI(title="星选建材后台 API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


# /api/v1/* —— 内部后台
for r in (
    auth.router,
    customers.router,
    suppliers.router,
    inquiries.router,
    customer_quotes.router,
    supplier_quotes.router,
    settings_api.router,
    markup_rules.router,
    dashboard.router,
):
    app.include_router(r, prefix="/api/v1")

# /public/* —— 无需登录
app.include_router(public.router)
