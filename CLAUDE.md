# 星选建材 · Claude Code 项目说明

> 这份文档是给 Claude Code 看的，方便接手这个项目的 AI 助手快速上手。

---

## 🔴 先读这条：本仓库是**公开**仓库

`github.com/eatpeach/xingxuan` **公开可见，且已由老板拍板长期保持公开**
（2026-08-09 定案，不再讨论转私有）。所以下面这条不是临时提醒，是**长期纪律**：

**绝不往仓库里写**——账号、密码、API key、服务器 IP / SSH 端口、内网地址、
客户与供应商真实资料、内部排期、其它项目的信息。

- 凭据只走即时消息，**用完即弃**，不落任何文件（含 commit message、代码注释、`tasks/` 任务单）
- 新增配置项前先问一句：**它进了公开仓库有没有问题**
- 需要交接的初始账号写「见部署交接」，不写具体值

已知在公开仓库里、**已决策不处理**的：`deploy.sh` 的服务器路径、
完整 DB schema 与业务逻辑（它们本来就是代码，删不掉）。

⚠️ **但注意：删掉文档里的账号 ≠ 账号不在仓库里了。**
`seed()` 会在没有 `admin` 用户时用**硬编码口令**建一个管理员账号，
`system_settings` 的种子默认值里也有真实银行账号和账户名——这些是**代码**，
不在本文档的处置范围内，已单独上报待决。加任何 seed 默认值前请想到这一点。

---

## 项目概述

**星选建材**是一个印尼建材中介平台，一套后台带三个对外门面。

**主链路（中介撮合）**：

1. 客户提交询价（产品 / 规格 / 数量），或销售代录入、AI 解析自由格式文本
2. 销售把询价单**派给多个供应商**（一询多供，每条派单带 token 链接）
3. 供应商通过链接填报报价（**无需账号**，凭 token）
4. 销售在「对比页」选最优行 + 选加价策略 → 生成对外的客户报价单
5. 报价单 → 订单 → 合同 / 收款 / 返佣，发票和报价单可导出 PDF

**除主链路外还有三块，都是核心功能**（早期文档完全没提，别当成边角料）：

- **电子货架**（`/`、`/c/:name`、`/item/:id`）：对外的公开商品展示站，无需登录，
  首页轮播图数据库驱动，访客可直接从货架发起询价
- **供应商门户**（`/vendor`）：供应商**有账号**，自助维护自己的商品（含 Excel 批量导入、
  AI 解析、图片链接自动下载）。与后台 `users` 是**两套隔离的鉴权**
- **商品库**（后台「商品库」）：供应商提报的商品在这里审核上架，上架后进电子货架

## 技术栈

- **后端**：PHP 8.0+ + PDO + SQLite（WAL 模式），**无 composer / 无框架**，
  单入口 action-based 路由（参考宝塔同 server 上的 BantuCRM 风格）
- **前端**：Vite + React 18 + TypeScript + Ant Design Pro 组件（`@ant-design/pro-components`）
  + axios + react-router-dom v6（BrowserRouter）
- **PDF**：前端 `html2canvas` + `jspdf`，纯浏览器端生成，服务端不装任何 PDF 组件
- **AI**：OpenAI，模型可在系统设置配（`ai.openai.model`，默认 `gpt-4o-mini`），
  用于解析客户自由格式询价文本、解析供应商报价、供应商门户批量解析商品
- **部署**：宝塔面板 + nginx，前端 dist **进 git 仓库**（服务器不需要 Node，不需要 build）

## 目录

```
xingxuan/
├── backend/                       # PHP 后端
│   ├── config/database.php        # SQLite 连接 + 建表(34 张) + migrate + seed
│   ├── includes/helpers.php       # 通用工具（鉴权 / 编号生成 / applyMarkup 加价 / 日志 / 设置）
│   ├── api/handler.php            # 单入口 ?action=xxx 分发 + 三层鉴权白名单
│   ├── api/handlers/*.php         # 23 个业务 handler，见下
│   ├── data/xingxuan.db           # SQLite，运行时生成
│   └── storage/                   # 上传附件、商品图、banner、logo、公章
├── frontend/
│   ├── src/api.ts                 # axios 封装：api.get/post(action, params)
│   ├── src/App.tsx                # 路由：后台 /admin/* + 货架 + 供应商门户 + 公开页 + 打印页
│   ├── src/roles.ts               # 角色定义 + 可授权模块 MODULES（菜单过滤/权限矩阵共用）
│   ├── src/theme.ts               # 主题色
│   ├── src/pages/
│   │   ├── Dashboard.tsx  Customers.tsx  Suppliers.tsx  Settings.tsx  Login.tsx
│   │   ├── Products.tsx           # 商品库（审核 / 上架 / 改价，02 号单的价格闸门在这条链上）
│   │   ├── CategoryManager.tsx    # 品类树管理（多级，parent_id 自引用）
│   │   ├── Channels.tsx           # 渠道管理
│   │   ├── ShortVideo.tsx         # 短视频矩阵（账号 / 素材 / 任务）
│   │   ├── Calendar.tsx           # 日历 / 日程 / 日记
│   │   ├── BannerManager.tsx      # 首页轮播图管理（设置→管理横幅）
│   │   ├── Inquiries.tsx          # 商机管理（含 4 步工作流 InquiryDetail，见「近期迭代交接」A 节）
│   │   ├── InquiryCompare.tsx     # 行 × 供应商对比 + 加价 + 实时算价（可 embedded 内嵌）
│   │   ├── Orders.tsx             # 订单履约（菜单页已下线，OrderDetail/ORDER_STATUS 被商机详情复用）
│   │   ├── Quotes.tsx             # ⚠ 已是死代码，全仓库零 import（详见「关键约定 8」）
│   │   ├── IssueInvoiceButton.tsx # 开票入口（选收款主体 + 账户）
│   │   ├── QuotePrint.tsx         # 报价单打印/导出页 /quotes/:id/print（q-* 版式 + 三语）
│   │   ├── InvoicePrint.tsx       # 发票打印/导出页 /quotes/:id/invoice（i-* 版式 + 三语）
│   │   ├── printI18n.ts           # 打印页三语文案（中/EN/Bahasa），缺翻译回落中文
│   │   ├── PublicQuote.tsx        # 供应商公开填报页 /p/quote/:token（凭 token，无账号）
│   │   ├── PublicInquiry.tsx      # 客户公开询价表单 /p/inquiry
│   │   ├── shelf/                 # 【对外电子货架】ShelfHome / ShelfCategory / ShelfProduct
│   │   │                          #   + ShelfChrome(外壳) / ProductCard / InquiryModal(货架发询价)
│   │   ├── VendorLogin.tsx        # 【供应商门户】登录
│   │   ├── VendorPortal.tsx       # 【供应商门户】商品自助管理
│   │   └── vendor/                #   ProductFormDrawer / ExcelImportModal / AiParseModal / types
│   ├── src/components/            # WorkPlanButton(工作计划) / CustomerCodeSearch
│   ├── src/utils/                 # copyText / groupByCustomer / pdfToImages
│   └── dist/                      # vite build 产物，**进 git**
├── scripts/data-fixes/            # 一次性数据脚本（幂等 + 无参 dry-run + --apply）
├── tasks/                         # 任务台账，INDEX.md 是总账
└── deploy.sh                      # 服务器一键部署脚本（6 步，含 PHP-FPM 重启）
```

**后端 handler 一览**（`backend/api/handlers/`，23 个）：

```
auth  user_admin  customer  supplier  inquiry  supplier_quote  customer_quote  order
product_admin  category  channel  markup_rule  payment_account  setting  dashboard
shelf  vendor  public_quote  banner  short_video  calendar  workplan  ai
```

## 数据模型（34 张表，按模块分组）

> 表数量以 `grep -c "CREATE TABLE IF NOT EXISTS" backend/config/database.php` 为准。
> 加字段前先 grep schema，别假设字段存在。

### 🔴 最重要的一件事：级联删除链

```
customer_quotes ──┬─→ customer_quote_items   (ON DELETE CASCADE)
                  ├─→ quote_follow_logs      (ON DELETE CASCADE)
                  └─→ orders                 (ON DELETE CASCADE)
                        ├─→ contracts        (ON DELETE CASCADE)
                        ├─→ payments         (ON DELETE CASCADE)   ← 收款记录
                        └─→ commissions      (ON DELETE CASCADE)   ← 返佣
```

**删掉一行 `customer_quotes`，会连带删掉订单、合同、收款记录、返佣，共 6 张表的数据，且不可恢复。**

这条链是 [05 号单](tasks/20260808-05-quote-regen-cascade-guard.md)事故的根源：
「重新生成客户报价」内部会先删旧报价，于是订单和钱一起没了。
现在 `buildCustomerQuote` 已加**后端硬拦**（有订单/已开票的报价不许被覆盖），
但**任何新写的删报价代码都必须重新想一遍这条链**。

配套注意：**SQLite 默认不开外键**。数据脚本里必须显式 `PRAGMA foreign_keys = ON`，
否则级联不生效、留一地孤儿数据。反过来——**开着 FK 时级联删得干干净净，
「孤儿数据为 0」不能证明没删过**，要证伪得查 `op_logs` 有记录但主表查不到。

### 询价 → 报价链

| 表 | 说明 |
|---|---|
| `inquiries` | 询价单（商机）。`inquiry_items` / `inquiry_attachments` 挂它，CASCADE |
| `dispatches` | 派单记录（一询多供），每条带 token，供应商凭此免登录填报 |
| `supplier_quotes` + `supplier_quote_items` | 供应商报价。items CASCADE 于 quotes |
| `customer_quotes` + `customer_quote_items` | 对外客户报价，含加价策略快照 + **发票快照列** |
| `quote_follow_logs` | 报价跟进日志 |
| `markup_rules` | 加价策略模板（5 种 type，见「关键约定 6」） |

`customer_quotes` 上还挂着**发票**：`invoice_no` / `invoice_issued_at` / `invoice_due_at`
以及 `invoice_entity_*` / `invoice_bank_*` **快照列**——发票是对外正式单据，
抬头和银行账号必须在开票那一刻**冻结**进这些列，不能留空。留空的话打印页会回落读
当前 `system_settings`，历史发票会跟着设置漂（见 06/07/08 号单）。

### 订单履约链

`orders`（挂 `quote_id`）→ `contracts` / `payments`（含 `voucher_path` 付款凭证）/
`commissions`（返佣）。三者都 CASCADE 于 `orders`。`salespersons` 是返佣的销售人员表。

### 商品 / 货架

| 表 | 说明 |
|---|---|
| `products` | 商品库。`status`（`pending`/上架等）、`base_price`、`images`(JSON)，CASCADE 于 `suppliers` |
| `product_price_logs` | 改价留痕，CASCADE 于 `products` |
| `categories` | 品类树，**`parent_id` 自引用多级**（当前用到三级），`name` 上有唯一索引 |
| `banners` | 首页轮播图，数据库驱动 |

⚠ **`base_price = 0` 的商品不许上架**（02 号单的闸门），对外货架 `shelf.php` 也过滤 0 价。

### 收款主体（开票用）

`payment_entities`（抬头：名称/NPWP/地址/电话/logo/公章）→ `payment_accounts`
（银行/账户名/账号/支行/SWIFT/币种/收款码/默认/启停），accounts CASCADE 于 entities。
**同主体同币种唯一默认**，事务内互斥。管理入口：系统设置 →「收款主体 / 账户」Tab（仅 admin）。

### 客户 / 供应商 / 账号

- `customers` — 客户。`code` **10001 起递增**，`short_name` 用于群名展示
- `suppliers` — 供应商。`code` **1001 起四位**。既是通讯录，也可开门户账号
- `users` — 后台内部账号，`role` 见「关键约定 9」
- `login_attempts` — 登录失败限流

> ⚠ **编号会跳过任何含数字 4 的值**（`nextCustomerCode` / `nextSupplierCode`，忌讳）。
> 所以编号**不连续是正常的**，别当成 bug 去「修复」。

### 短视频矩阵 / 办公

`sv_accounts` / `sv_assets` / `sv_tasks`（tasks CASCADE 于两者）、
`calendar_events`、`diary_entries`、`work_plans`、`channels`。

### 系统

`system_settings`（KV）、`op_logs`（操作日志，**盘点历史事故的唯一依据**）。

## 关键约定

### 1. 一切走 action

前端统一 `api.get('actionName', params)` / `api.post('actionName', params)`，
对应 backend `?action=actionName`。

### 2. 三层鉴权，加 action 必须想清楚归哪层

`backend/api/handler.php` 顶部有**两个**白名单数组，落在两者之外的一律要求后台登录：

**① `$publicActions` —— 完全公开，不需要任何身份**（当前 11 个）：

```
login  publicGetInquiry  publicSubmitQuote  publicCreateInquiry  publicAiParseSupplierQuote
vendorLogin  shelfMeta  shelfListProducts  shelfGetProduct  shelfLatestVideos  shelfBanners
```

**② `$vendorActions` —— 凭供应商 token，与后台 `users` 完全隔离**（当前 9 个）：

```
vendorMe  vendorChangePassword  vendorListProducts  vendorSaveProduct  vendorToggleProduct
vendorDeleteProduct  vendorUploadProductImage  vendorAiParseProducts  vendorImportProductsExcel
```

**③ 其余全部** → `requireAuth()`，需要后台登录态。

🔴 **加公开 action 前先问一遍「这个 action 能被匿名调用会怎样」**——
白名单是唯一的门，加错一个就是把内部数据挂到公网上。

### 3. 数据库迁移

新加列要在 `config/database.php` 的 `migrate()` 里写 ALTER 兼容老库，
避免每次部署手工 sqlite3 改表。

### 4. 系统设置自动补齐

`handle_listSettings` 会 `INSERT OR IGNORE` 补齐 `SETTING_KEYS` 里定义但 DB 没有的项，
新加设置项**只需改 `setting.php` 的 `SETTING_KEYS`**，不用手写 SQL。

### 5. 客户群名格式

`[公司抬头 编号] 简称` —— 如 `[星选建材 10001] 张总`。
公司抬头来自 `system_settings.company_name`，编号是 `customers.code`，
简称是 `customers.short_name`（留空则用 `name`）。

### 6. 加价策略

`backend/includes/helpers.php` 的 `applyMarkup()`（**不在 `app/services/`，那个目录不存在**）：

| type | 说明 |
|---|---|
| `flat_pct` | 整单 N% |
| `per_item_pct` | 按行 N%（payload `{item_id: pct}`） |
| `per_item_fixed` | 按行加固定金额（payload `{item_id: amount}`） |
| `category_pct` | 按品类 N% |
| `stepped` | 阶梯（按成本价梯度） |

另有 `none`（不加价，售价 = 成本价），由 `applyMarkup` 的 else 分支天然支持，
**是对比页的默认值**。前端对比页只暴露 `none` + 前 3 种，
`category_pct` / `stepped` 通过 `markup-rules` API 用模板使用。

### 7. 报价单 / 发票 PDF

**不是**「Cmd+P 另存为 PDF」，也不依赖服务端 wkhtmltopdf / dompdf。
`QuotePrint.tsx` / `InvoicePrint.tsx` 页面上有**导出 PDF 按钮**，
实现是 `html2canvas` 截图 → `jsPDF` 按 A4 切页。Logo 路径来自
`system_settings.pdf_logo_path`（相对 `backend/storage/`）。

改版式的正确姿势见「近期迭代交接」D 节。

### 8. ⚠ `Quotes.tsx` 已经是死代码

旧文档写「Quotes.tsx / Orders.tsx 的组件被详情页 import 复用，别删文件」——
**现在只有 `Orders.tsx` 还成立**（`Inquiries.tsx` import 了 `OrderDetail` / `ORDER_STATUS`）。

`Quotes.tsx` **全仓库零 import**，它导出的 `QuoteDetail` 只被自己文件内部引用，
Vite 根本没把它打进 bundle。商机详情页看报价走的是
`window.open('/quotes/:id/print')` 开新窗口，不用 `QuoteDetail`。

**但注意**：后端 `quickCreateInvoice` 这条路由还通着（`handler.php`），
虽然 UI 入口随 `Quotes.tsx` 下线了，任何带 token 的调用方仍能打到它。
**要下线得前后端一起下**，只删前端文件不等于关掉了这条路（见 08 号单）。

### 9. 角色

后台角色是 **`admin` / `sales` / `ops` / `finance` / `legal`** 五种
（定义在 `frontend/src/roles.ts` 的 `ROLE_OPTIONS`）。
**没有 `operator` 这个角色**——旧文档写的 `admin/sales/operator` 是错的。

权限矩阵存 `system_settings.role_permissions`（JSON `{role: [module,...]}`），
可授权模块见 `roles.ts` 的 `MODULES`。
「客户报价」「订单履约」已并入商机步骤、无独立路由，故不在可授权模块里。

## 部署流程（生产）

服务器：阿里云 + 宝塔 + nginx + PHP 8.2 + SQLite。

**推荐用一键脚本**（在服务器项目根目录）：

```bash
bash deploy.sh
```

`deploy.sh` 共 6 步：`git pull` → 校验 dist 就位 → seed 横幅图 →
修 `backend/data` `backend/storage` 写权限 → reload nginx → **重启 PHP-FPM**。

🔴 **只 `git pull` 不重启 PHP-FPM 是不够的**：OPcache 会缓存旧的 `handler.php`，
**新加的 action 会报「未知 action」**，看起来像代码没生效。
（旧文档写「PHP 改动 git pull 后即时生效，PHP-FPM 不需要重启」——**那是错的**，
`deploy.sh` 第 6 步的注释就是为这个坑加的。）

**前端 dist 已进 git**，服务器不需要装 Node、不需要 build。

**SQLite migration**：第一次访问任何 API 时 `database.php::initialize()` 自动跑 migrate + seed。

## 本地开发

### 前端

```bash
cd frontend
npm install     # 第一次
npm run dev     # http://localhost:5173
```

### 后端（重要：本机没有 PHP）

用户的 Mac **没有 php / brew / docker**。`frontend/vite.config.ts` 已把 `/api` 和 `/storage`
代理到生产站，所以本地 `npm run dev` 看到的就是**线上数据**。

后果：

- PHP 改动**无法本地 lint / 运行**。改完只能静态自查，部署后线上验证。
  最常翻车的两点：**括号配平**、**PDO 占位符数 = execute 参数数**
- 涉及写库的后端改动，提醒用户先在一条测试数据上过一遍
- **进后台需要账号**，本文档不提供（见顶部公开仓库声明）。
  需要验证线上功能时找项目负责人要测试账号，**不要自己想办法绕**

### 改完代码后

```bash
cd frontend && npm run build      # 动了前端就必须重新 build
cd ..
git add -A
git commit -m "..."
git push
# 服务器 bash deploy.sh
```

⚠ **多人共用同一个工作区时**：提交前先 `git status` 看清哪些文件不是自己的，
只 `git add` 自己的文件。**`dist` 由后落地的那个人统一 build 一次**，
否则会把别人的半成品打进包。

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
- **数据脚本一律放 `scripts/data-fixes/`**，幂等 + 无参 dry-run + `--apply` 才真执行
- **任务走 `tasks/` 台账**：开工改 🚧、卡住改 ⏸ 写清卡在哪、完成改 ✅。
  台账是别人能看到你状态的唯一地方

## 当前生产部署

- 域名：`https://www.xingxuan.cc`
- GitHub：`https://github.com/eatpeach/xingxuan.git`（**公开仓库**）
- 初始账号：**见部署交接，不落文档**


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
