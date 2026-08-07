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
│   │   ├── Quotes.tsx             # 客户报价（菜单页已下线，组件被商机详情复用）
│   │   ├── Orders.tsx             # 订单履约（菜单页已下线，组件被商机详情复用）
│   │   ├── QuotePrint.tsx         # 报价单打印页 /quotes/:id/print（doc-* 版式 + 三语）
│   │   ├── InvoicePrint.tsx       # 发票打印页 /quotes/:id/invoice（同版式体系）
│   │   ├── printI18n.ts           # 打印页三语文案（中/EN/Bahasa），缺翻译回落中文
│   │   ├── BannerManager.tsx      # 首页轮播图管理（设置→管理横幅）
│   │   ├── shelf/                 # 对外电子货架（/ 首页、/c/:name 分类、/item/:id 详情）
│   │   ├── VendorPortal.tsx       # 供应商门户（/vendor，商品管理+Excel导入）
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

### 后端（重要：本机没有 PHP）

用户的 Mac **没有 php / brew / docker**。`frontend/vite.config.ts` 已把 `/api` 和 `/storage`
代理到生产 `https://www.xingxuan.cc`，所以本地 `npm run dev` 看到的就是线上数据。

后果：
- PHP 改动**无法本地 lint / 运行**。改完只能做静态自查（括号配平、
  PDO 占位符数 = execute 参数数——这是最常翻车的点），部署后在线上验证
- 涉及写库的后端改动，提醒用户先在一条测试数据上过一遍

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


---

## 近期迭代交接（2026-07 ~ 2026-08）

以下是最近两周的大改，接手前先扫一遍，避免按旧认知改坏。

### A. 商机详情 = 4 步工作流（核心变化）

商机详情（Inquiries.tsx 内 InquiryDetail）现在是 Steps 驱动的 4 步：

1. **供应商报价**：明细 / 派单 / 供应商报价列表（链接提交 + 代录入统一展示，
   行可展开看明细，行尾「编辑」回填后修改）。已有报价后「代录入报价」收成文字链接
2. **对客报价**：`InquiryCompare` 以 **embedded 模式内嵌**（props: inquiryId/embedded/onGenerated），
   下方是当前报价表。**生成新报价会删除旧报价**（buildCustomerQuote 内实现），
   但已开票或已生成订单的旧报价保留——orders.quote_id 是 ON DELETE CASCADE，
   删了会连带订单/合同/收款/返佣
3. **收款**：开收据 / 开发票（选收款主体+账户）
4. **交付流程**：收货信息 / 排期 / 预计交付 / 备注

「客户报价」「订单履约」**独立菜单页已下线**，但 Quotes.tsx / Orders.tsx 的组件
（QuoteDetail / OrderDetail / IssueInvoiceButton 等）被详情页 import 复用，别删文件。

### B. 对比页（InquiryCompare）现状

- 默认加价策略 = **不加价**（none，售价=成本价）；none 由 applyMarkup 的 else 分支天然支持
- 货币符号跟商机（compareInquiry 返回 currency），不再写死 ¥
- 成本价输入框带千位分隔符；行小计旁 ⓘ 悬浮显示本行利润
- 「客户可见品牌」列已删除，show_brand 恒为 1
- 工具栏控件全部 antd + inline-flex 对齐；ProFormSelect 脱离 Form 时
  initialValue 不生效（会显示"请选择"），**要用受控 antd Select**

### C. 收款主体 / 账户（开发票体系）

- 表：`payment_entities`（抬头：名称/NPWP/地址/电话/logo/公章）
  → `payment_accounts`（银行/账户名/账号/支行/SWIFT/币种/收款码/默认/启停），
  同主体同币种唯一默认，事务内互斥
- 管理入口：系统设置 → 「收款主体 / 账户」Tab（仅 admin）
- 开票：弹窗选主体+账户，issueInvoice 接 account_id，把主体+账户**快照**进
  customer_quotes 的 invoice_entity_* / invoice_bank_* 列——之后改设置不影响已开发票
- 付款凭证上传早已存在（payments.voucher_path + Orders.tsx 的 VoucherUpload），别重复造

### D. 打印页版式（QuotePrint / InvoicePrint）

- 两页共用 doc-* 类名体系：顶部灰底带（左 logo+公司名 gap 10px / 右 28px 大标题）、
  左客户块 + 右日期列（doc-info-row）、明细表（数字列 .num 右对齐 tabular-nums、
  .center 居中）、右侧合计组、三栏页脚
- 三语：printI18n.ts（cn/en/id），Segmented 切换存 localStorage；
  中文大写金额仅 中文+CNY 显示；发票底部双语条款不随切换（存对儿数据）
- **改版式的正确姿势**：把 printStyles/styles 模板串抽成 css + 静态 mock html，
  headless Chrome 截图看效果再回写（scratchpad 里迭代，别盲改）

### E. 对外货架 / Banner

- 轮播图**数据库驱动**（banners 表），后台「设置→管理横幅」维护；
  内置图源在 frontend/src/assets/shelf-*.png，由
  scripts/data-fixes/seed_shelf_banners.php 复制进 backend/storage/banner/ 并落库
  （幂等；记录已存在时仍覆盖图片文件 = 换图手段）
- **deploy.sh 已含 seed 步骤**，所以换图只需：本地替换 assets 图 → build → push → 服务器 bash deploy.sh
- shelfBanners 接口给图片 URL 带 ?v=<filemtime>（storage 有 30 天强缓存，同名换图靠它破缓存）
- 分类图标映射 CAT_ICONS 按 MRO 13 大类名精确匹配，改分类名要同步改
- 供应商 Excel 导入（vendorImportProductsExcel）支持「图片链接」列自动下载入库；
  模板见会话产物，表头按 aliasMap 包含式匹配，images 别名必须排在 name 前
  （name 的别名含「商品」会抢先匹配「商品图片」）

### F. 数据操作规范

- 一律 PHP 脚本放 scripts/data-fixes/，幂等 + 无参 dry-run + --apply 真执行
- 脚本里显式 `PRAGMA foreign_keys = ON`（SQLite 默认关，不开则级联删除不生效留孤儿）
- 级联链：customer_quotes → orders → contracts/payments/commissions，删报价前先想清楚

### G. 高频踩坑（新增）

- **浏览器缓存**：index.html 是 no-cache 没问题，但用户长开的旧标签页不会自己刷新；
  "改了没生效"先对比线上 bundle hash（curl index.html 里的 assets/index-*.js）
  和线上包内是否含新字符串，再下结论
- **ProFormSelect / ProForm 组件**脱离 Form 上下文：initialValue、value 顶层 prop
  都不生效，受控要放 fieldProps
- **InputNumber 千位分隔符**统一写法：formatter 正则 + parser 去逗号返回 Number
- 用户消息可能有错别字/语音输入（如"前卫风格福"=千位分隔符），按业务上下文猜，
  猜不准再问
