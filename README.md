# 星选建材 · 客户/询价/报价管理系统

建材中介后台：客户提交询价 → 派单给多个供应商 → 收齐供应商报价 → 选行加价生成对外报价 → 发送给客户。

后端 **PHP 8 + PDO + SQLite (WAL)**（无框架，BantuCRM 同款风格），前端 Vite + React 18 + Ant Design Pro 组件。

## 目录

```
xingxuan/
├── backend/                       # PHP 后端
│   ├── config/database.php        # 数据库 + 建表 + 种子数据
│   ├── includes/helpers.php       # 通用工具（鉴权 / 号生成 / 加价 / 日志 ...）
│   ├── api/handler.php            # 单入口路由分发（?action=xxx）
│   ├── api/handlers/*.php         # 各业务 action 实现
│   ├── data/                      # SQLite 数据库（运行时生成）
│   ├── storage/                   # 上传附件 / 导出
│   ├── index.php                  # php -S 入口（首页 + API 转发）
│   └── .htaccess                  # Apache rewrite
└── frontend/                      # 管理后台
    ├── src/api.ts                 # axios 封装：api.get/post(action, params)
    └── src/pages/                 # 登录、工作台、客户、供应商、询价、报价、设置
```

## 启动

### 后端（任选其一）

**A. PHP 内置服务器**（开发最快）：

```bash
cd backend
php -S 127.0.0.1:8000              # 首次访问会自动建库 + 默认 admin/admin123
```

**B. Apache / Nginx**：把 `backend/` 部署成站点根目录，确保支持 `.htaccess`（或对应 nginx rewrite），data/ 和 storage/ 给 PHP 写权限。

> 要求 **PHP 8.0+**（用了 `str_starts_with` 等内置函数）和 **SQLite 3.24+**（`ON CONFLICT`）。

### 前端

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173
```

Vite 已把 `/api` 反代到 `127.0.0.1:8000`，所以前后端同时跑就能登录。

默认账号：`admin / admin123`。**首次登录后请到「系统设置」改密码**（密码修改 action 待加）。

## 业务流程

1. **客户管理**：录入客户基本信息（姓名 / 公司 / 电话 / 来源 / 备注）。
2. **新建询价**：选客户、批量录入产品明细（每行 `产品名 | 规格 | 数量 | 单位`）。
3. **派单（一询多供）**：勾选多个供应商 → 系统给每家生成一个 token 链接（`/p/quote/{token}`），复制给供应商让他直接填报价（**不需要账号**）。
4. **供应商填报**：供应商在公开链接里逐行填 brand / model / 单价 / 货期。
5. **对比 + 生成客户报价**：调 `compareInquiry` 拿到行 × 供应商对照矩阵，前端勾选每行用哪家 → 选加价策略 → `buildCustomerQuote` 自动算价 + 落库。
6. **发送 / 成交**：报价单生成后导出 PDF（待接）发给客户，标记发送 / 已成交。

## 加价策略（`includes/helpers.php` `applyMarkup`）

| type | 说明 | 数据 |
|---|---|---|
| `flat_pct` | 整单百分比 | `value: 15` |
| `per_item_pct` | 按单品百分比 | `payload: {inquiry_item_id: pct}` |
| `per_item_fixed` | 按单品加固定金额 | `payload: {inquiry_item_id: amount}` |
| `category_pct` | 按品类百分比 | `payload: {category: pct}` |
| `stepped` | 按成本价梯度 | `payload: {ladders: [{lt: 100, pct: 30}, ...]}` |

可保存为模板（`listMarkupRules` / `createMarkupRule`），下次直接选用。

## 系统设置

`system_settings` 表，KV 存储，前端「系统设置」页可视化切换：

- `hide_supplier_brand_default`：客户报价单**默认隐藏供应商品牌型号**（开关默认开启）。每行客户报价仍可手动覆盖展示。
- `company_name`：对外公司抬头（PDF 用）
- `pdf_logo_path`：报价单 PDF logo
- `default_markup_pct`：默认整单加价百分比
- `default_quote_valid_days`：默认报价有效天数

仅 `admin` 角色可写。

## API

所有请求都走单入口：`GET/POST /api/handler.php?action=xxx`，需要登录的带 `Authorization: Bearer <token>`。

公开（无需登录）：`login` · `publicGetInquiry` · `publicSubmitQuote`

后台：

| 模块 | actions |
|---|---|
| 鉴权 | `login` `me` |
| 客户 | `listCustomers` `getCustomer` `createCustomer` `updateCustomer` `deleteCustomer` |
| 供应商 | `listSuppliers` `getSupplier` `createSupplier` `updateSupplier` `deleteSupplier` |
| 询价 | `listInquiries` `getInquiry` `createInquiry` `updateInquiry` `deleteInquiry` `dispatchInquiry` `listDispatches` `shareLinks` `compareInquiry` `uploadInquiryAttachment` |
| 供应商报价 | `listSupplierQuotes` `getSupplierQuote` `adoptSupplierQuote` `voidSupplierQuote` |
| 客户报价 | `listCustomerQuotes` `getCustomerQuote` `buildCustomerQuote` `sendCustomerQuote` `deleteCustomerQuote` |
| 设置 | `listSettings` `updateSetting` |
| 加价规则 | `listMarkupRules` `createMarkupRule` `updateMarkupRule` `deleteMarkupRule` |
| 工作台 | `dashboardOverview` |

## 后续 TODO

- 报价单 PDF 渲染（dompdf 或用 wkhtmltopdf）
- 客户公开询价 H5 表单
- 微信 / 邮件通知
- 供应商 Excel 报价批量导入
- OSS 替换本地 storage（接口集中在 `inquiry.php` 的上传部分，改成调用阿里云 OSS SDK 即可，参考 BantuCRM `includes/oss.php`）
