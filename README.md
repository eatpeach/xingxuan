# 星选建材 · 客户/询价/报价管理系统

一个建材中介平台后台：客户提交询价 → 派单给多个供应商 → 收齐供应商报价 → 选行加价生成对外报价 → 发送给客户。

后端 FastAPI + SQLAlchemy 2.0 + SQLite，前端 Vite + React 18 + Ant Design Pro 组件。

## 目录

```
xingxuan/
├── backend/        # Python 后端
│   ├── app/        # FastAPI 应用
│   ├── alembic/    # 迁移
│   ├── data/       # SQLite 文件（运行时生成）
│   ├── storage/    # 上传附件 / 导出文件
│   └── scripts/    # 初始化脚本
└── frontend/       # AntD Pro 风格管理后台
```

## 第一次启动

### 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .              # 或 pip install -r requirements 类似依赖见 pyproject
cp .env.example .env

# 初始化数据库 + 默认管理员 + 默认设置
python scripts/init_db.py

# 起服务
uvicorn app.main:app --reload --port 8000
```

> **要求 Python 3.10+**（用了 `int | None` 这类 PEP 604 写法）。当前机器是 3.8，需要先装新版本：去 https://www.python.org/downloads/macos/ 下 3.11 或 3.12 的官方 pkg 装上。

默认账号：`admin / admin123`，登录后请到「系统设置」修改。

### 前端

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173
```

Vite dev server 已配好把 `/api` 和 `/public` 反代到 `127.0.0.1:8000`，所以前后端同时跑就能登录。

## 业务流程

1. **客户管理**：录入客户基本信息（姓名 / 公司 / 电话 / 来源 / 备注）。
2. **新建询价**：在询价管理选客户、批量录入产品明细（每行一个：`产品名 | 规格 | 数量 | 单位`）。
3. **派单（一询多供）**：在询价详情勾选多个供应商，系统给每家生成一个 token 链接（`/p/quote/{token}`），复制给供应商让他直接填报价（不需要账号）。
4. **供应商填报**：供应商在公开链接里按行填 brand / model / 单价 / 货期。
5. **对比 + 生成客户报价**：调用 `GET /api/v1/inquiries/{id}/compare` 拿到行 × 供应商对照矩阵，前端勾选每行用哪家的 → 选加价策略（整单 % / 单品 % / 单品固定金额 / 阶梯） → 调 `POST /api/v1/customer-quotes/build` 生成客户报价单。
6. **发送 / 成交**：报价单生成后导出 PDF（待接 WeasyPrint）发给客户，标记发送 / 已成交。

## 加价策略

后端 `app/services/markup.py` 支持：

| 类型 | 说明 | 数据 |
|---|---|---|
| `flat_pct` | 整单百分比 | `value: 15` |
| `per_item_pct` | 按单品百分比 | `payload: {inquiry_item_id: pct}` |
| `per_item_fixed` | 按单品加固定金额 | `payload: {inquiry_item_id: amount}` |
| `category_pct` | 按品类百分比 | `payload: {category: pct}` |
| `stepped` | 阶梯（按成本价梯度） | `payload: {ladders: [{lt: 100, pct: 30}, ...]}` |

策略可保存为模板（`/api/v1/markup-rules`），下次直接选用。

## 系统设置（后台开关）

`/api/v1/settings`，需要 admin 角色才能写：

- `hide_supplier_brand_default`：客户报价单**默认是否隐藏供应商品牌型号**（按你确认开启）。每行客户报价仍可手动覆盖展示。
- `company_name`：对外公司抬头（PDF 用）
- `pdf_logo_path`：报价单 PDF logo
- `default_markup_pct`：默认整单加价百分比
- `default_quote_valid_days`：默认报价有效天数

前端在「系统设置」页面有可视化开关。

## 关键 API

公开（无需登录）：
- `GET  /public/quote/{token}`：供应商打开链接，看到询价单 + 待填行
- `POST /public/quote/{token}/submit`：供应商提交报价

后台（需 Bearer token）：
- `POST /api/v1/auth/login`
- `GET/POST/PUT/DELETE /api/v1/customers`
- `GET/POST/PUT/DELETE /api/v1/suppliers`
- `GET/POST/PUT/DELETE /api/v1/inquiries`
- `POST /api/v1/inquiries/{id}/dispatch`
- `GET  /api/v1/inquiries/{id}/compare`
- `GET  /api/v1/inquiries/{id}/share-links`
- `POST /api/v1/customer-quotes/build`
- `POST /api/v1/customer-quotes/{id}/send`
- `GET  /api/v1/dashboard/overview`
- `GET/PUT /api/v1/settings`
- `GET/POST/PUT/DELETE /api/v1/markup-rules`

完整文档：启动后访问 http://localhost:8000/docs（FastAPI 自动 OpenAPI）。

## 后续 TODO（已留接口，下版做）

- 报价单 PDF 渲染（WeasyPrint + Jinja 模板）
- 客户公开询价 H5 表单（让客户自助提交）
- 微信 / 邮件通知
- 供应商 Excel 报价批量导入
- OSS 替换本地 storage（接口已抽好 `app/utils/storage.py`，改实现即可）
