# 星选建材 · Claude Code 项目说明

> 这份文档是给 Claude Code 看的，方便接手这个项目的 AI 助手快速上手。

## 项目概述

**星选建材**是一个建材中介平台后台。流程：

1. 客户提交询价（产品 / 规格 / 数量）
2. 销售把询价单**派给多个供应商**（一询多供，token 链接）
3. 供应商通过链接填报报价（无需账号）
4. 销售在「对比页」选最优行 + 选加价策略 → 生成对外的客户报价单
5. 客户报价单可在浏览器打印为 PDF

## 技术栈

- **后端**：PHP 8.0+ + PDO + SQLite（WAL 模式），**无 composer / 无框架**，单入口 action-based 路由（参考宝塔同 server 上的 BantuCRM 风格）
- **前端**：Vite + React 18 + TypeScript + Ant Design Pro 组件（`@ant-design/pro-components`）+ axios + react-router-dom v6（BrowserRouter）
- **AI**：OpenAI gpt-4o-mini 用于解析客户的自由格式询价文本（系统设置里配 API key）
- **部署**：宝塔面板 + nginx，前端 dist 进 git 仓库（服务器 `git pull` 即生效，无需 npm install/build）

## 目录

```
xingxuan/
├── backend/                       # PHP 后端
│   ├── config/database.php        # SQLite 连接 + 建表 + migrate + seed
│   ├── includes/helpers.php       # 通用工具（鉴权 / 号生成 / 加价 / 日志 / 设置）
│   ├── api/handler.php            # 单入口 ?action=xxx 分发
│   ├── api/handlers/*.php         # 按业务拆分的 handler（auth/customer/supplier/inquiry/...）
│   ├── data/xingxuan.db           # SQLite，运行时生成
│   └── storage/                   # 上传附件、PDF 导出、logo
├── frontend/                      # 管理后台
│   ├── src/api.ts                 # axios 封装：api.get/post(action, params)
│   ├── src/App.tsx                # 路由：公开路由 + 管理后台
│   ├── src/pages/
│   │   ├── Customers.tsx
│   │   ├── Suppliers.tsx
│   │   ├── Inquiries.tsx          # 含派单 / 代录入 / AI 智能解析
│   │   ├── InquiryCompare.tsx     # 行 × 供应商对比 + 加价 + 实时算价
│   │   ├── Quotes.tsx             # 客户报价列表 + 详情 Drawer
│   │   ├── QuotePrint.tsx         # 报价单打印 PDF 页（路径 /quotes/:id/print）
│   │   ├── PublicQuote.tsx        # 供应商公开填报页（路径 /p/quote/:token）
│   │   ├── PublicInquiry.tsx      # 客户公开询价表单（路径 /p/inquiry）
│   │   ├── Settings.tsx
│   │   ├── Login.tsx
│   │   └── Dashboard.tsx
│   └── dist/                      # vite build 产物，**进 git**
└── deploy.sh                      # 服务器一键部署脚本
```

## 数据模型核心表

- `users` — 内部账号（admin / sales / operator）
- `customers` — 客户。**code 字段从 10001 起递增**，`short_name` 用于群名展示
- `suppliers` — 供应商通讯录（不是账号体系）
- `inquiries` + `inquiry_items` + `inquiry_attachments` — 询价单
- `dispatches` — 派单记录（一询多供，每条带 token）
- `supplier_quotes` + `supplier_quote_items` — 供应商报价
- `customer_quotes` + `customer_quote_items` — 对外客户报价（含加价策略快照）
- `markup_rules` — 加价策略模板（5 种 type）
- `system_settings` — KV 形式系统配置
- `op_logs` — 操作日志

## 关键约定

### 1. 一切走 action

前端发请求统一：`api.get('actionName', params)` 或 `api.post('actionName', params)`，对应到 backend `?action=actionName`。

### 2. 公开 action 白名单

`backend/api/handler.php` 顶部有 `$publicActions` 数组，白名单内的 action **不需要登录**。当前是：
- `login`
- `publicGetInquiry` / `publicSubmitQuote`（供应商凭 token 填报）
- `publicCreateInquiry`（客户公开询价表单）

加新公开 action 必须加白名单。

### 3. 数据库迁移

新加列要在 `config/database.php` 的 `migrate()` 函数里写 ALTER 兼容老库。这是为了**避免每次部署都要手工 sqlite3 改表**。

### 4. 系统设置自动补齐

`handle_listSettings` 会自动 `INSERT OR IGNORE` 补齐 `SETTING_KEYS` 里定义但 DB 里没有的项，所以新加设置项**只需要在 setting.php 改 SETTING_KEYS**，不需要手动 SQL。

### 5. 客户群名格式

`[公司抬头 编号] 简称` —— 如 `[星选建材 10001] 张总`。
- 公司抬头来自 `system_settings.company_name`
- 编号是 customers.code（10001 起，自动分配）
- 简称是 customers.short_name（留空则用 name）

### 6. 加价策略 5 种

后端 `app/services/markup.php` `applyMarkup()`：
- `flat_pct` — 整单 N%
- `per_item_pct` — 按行 N%（payload: {item_id: pct}）
- `per_item_fixed` — 按行加固定金额（payload: {item_id: amount}）
- `category_pct` — 按品类 N%
- `stepped` — 阶梯（按成本价梯度）

前端目前只暴露了前 3 种，4/5 通过 `markup-rules` API 用模板使用。

### 7. 报价 PDF

不依赖服务端 wkhtmltopdf / dompdf。前端做了打印优化的 HTML 页（`QuotePrint.tsx`），用户 Cmd+P → 「另存为 PDF」即可。Logo 路径来自 `system_settings.pdf_logo_path`（相对 `backend/storage/`）。

## 部署流程（生产）

服务器：阿里云 + 宝塔 + nginx + PHP 8.2 + SQLite，路径 `/www/wwwroot/www.xingxuan.cc`。

**每次部署**：
```bash
cd /www/wwwroot/www.xingxuan.cc && git pull
```

或一键脚本：
```bash
bash deploy.sh
```

**前端 dist 已进 git**，服务器**不需要装 Node**，不需要 build。

**后端 PHP 改动**：`git pull` 后即时生效，PHP-FPM 不需要重启。

**SQLite migration**：第一次访问任何 API 时 `database.php::initialize()` 会自动跑 migrate + seed。

## 本地开发

### 前端

```bash
cd frontend
npm install     # 第一次
npm run dev     # http://localhost:5173
```

### 后端

要么用宝塔本地装一套 PHP+SQLite 跑，要么直接调远端 API（vite proxy 改一下指生产即可）。

或者本地用 PHP 内置 server：
```bash
cd backend
php -S 127.0.0.1:8000
```

### 改完代码后

```bash
cd frontend && npm run build      # 生成 dist
cd ..
git add -A
git commit -m "..."
git push
# 服务器 git pull 即生效
```

## 协作偏好（重要）

如果你是新接手的 Claude Code 助手，遵循这些偏好：

- **中文沟通**，简洁，不啰嗦
- **改完默认直接 commit + push**，不用每次问
- **大改先提方案再动手**
- **别引入不存在的概念**（如"线索"、"商机阶段"等）
- **别列一堆问题让用户确认**，自己拍合理默认，用户不满意会自己改
- **AntD Drawer 内的 Modal** 必须 `zIndex=9999`（这是 AntD 的层级 bug）
- **加 SQL 字段前先 grep schema**，避免假设字段存在
- **`array_unique` / `array_filter` 后必须 `array_values()`**，否则 PDO execute 会报 column index out of range

## 当前生产部署

- 域名：`https://www.xingxuan.cc`
- 默认账号：`admin / admin123`（用户已改）
- GitHub：`https://github.com/eatpeach/xingxuan.git`
