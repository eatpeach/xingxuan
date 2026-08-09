# 星选建材 · 建材中介平台

印尼建材中介平台：一套后台 + 三个对外门面。

后端 **PHP 8 + PDO + SQLite (WAL)**（无框架、无 composer，BantuCRM 同款单入口 action 路由），
前端 **Vite + React 18 + TypeScript + Ant Design Pro 组件**。

> 🔴 **本仓库是公开仓库。** 不要往任何文件里写账号、密码、API key、服务器地址、
> 客户与供应商真实资料或内部排期。凭据走部署交接，不落文档。

## 四条业务线

**① 中介撮合（主链路）**

客户提交询价 → 派单给多个供应商（一询多供，token 链接，供应商**无需账号**）→
收齐供应商报价 → 在对比页选行 + 选加价策略生成对外报价 → 订单 → 合同 / 收款 / 返佣 → 开发票。

**② 电子货架**（`/`、`/c/:name`、`/item/:id`）

对外公开的商品展示站，无需登录。首页轮播图数据库驱动，访客可直接从货架发起询价。

**③ 供应商门户**（`/vendor`）

供应商**有账号**，自助维护商品：手工录入、Excel 批量导入、AI 解析、图片链接自动下载。
鉴权与后台 `users` **完全隔离**。

**④ 商品库**（后台）

供应商提报的商品在这里审核上架，上架后进电子货架。**底价为 0 的商品不允许上架。**

## 目录

```
xingxuan/
├── backend/
│   ├── config/database.php        # 连接 + 建表(34 张) + migrate + seed
│   ├── includes/helpers.php       # 鉴权 / 编号生成 / applyMarkup 加价 / 日志 / 设置
│   ├── api/handler.php            # 单入口 ?action=xxx 分发 + 三层鉴权白名单
│   ├── api/handlers/*.php         # 23 个业务 handler
│   ├── data/                      # SQLite（运行时生成）
│   ├── storage/                   # 附件 / 商品图 / banner / logo / 公章
│   ├── index.php                  # php -S 入口（首页 + API 转发）
│   └── .htaccess                  # Apache rewrite
├── frontend/
│   ├── src/api.ts                 # axios 封装：api.get/post(action, params)
│   ├── src/App.tsx                # 路由：后台 /admin/* + 货架 + 供应商门户 + 公开页 + 打印页
│   ├── src/roles.ts               # 角色定义 + 可授权模块
│   ├── src/pages/                 # 后台各页 + shelf/(货架) + vendor/(供应商门户)
│   └── dist/                      # vite build 产物，**进 git**（服务器不需要 Node）
├── scripts/data-fixes/            # 一次性数据脚本（幂等 + 无参 dry-run + --apply）
└── deploy.sh                      # 服务器一键部署（6 步）
```

## 启动

### 前端

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173
```

⚠️ **`vite.config.ts` 默认把 `/api` 和 `/storage` 代理到生产站，不是本地。**
也就是说直接 `npm run dev` 看到的是**线上数据**，改动会写生产库。
要连本地后端，把 `proxy` 的 `target` 改成你自己的地址（如 `http://127.0.0.1:8000`）。

### 后端（任选其一）

**A. PHP 内置服务器**（开发最快）：

```bash
cd backend
php -S 127.0.0.1:8000              # 首次访问自动建库 + seed
```

**B. Apache / Nginx**：把 `backend/` 部署成站点根目录，确保支持 `.htaccess`
（或对应 nginx rewrite），`data/` 和 `storage/` 给 PHP 写权限。

> 要求 **PHP 8.0+**（用了 `str_starts_with` 等）和 **SQLite 3.24+**（`ON CONFLICT`）。

**初始账号见部署交接，不落文档。** 登录后可在系统设置里改密码（`changePassword`）。

## 部署（生产）

```bash
bash deploy.sh
```

6 步：`git pull` → 校验 dist 就位 → seed 横幅图 → 修写权限 → reload nginx → **重启 PHP-FPM**。

🔴 **只 `git pull` 不重启 PHP-FPM 是不够的**——OPcache 会缓存旧的 `handler.php`，
新加的 action 会报「未知 action」，看起来像代码没生效。

前端 dist 已进 git，**服务器不需要装 Node、不需要 build**。

## 鉴权：三层

`backend/api/handler.php` 顶部有两个白名单，落在两者之外的一律要求后台登录。
需要登录的请求带 `Authorization: Bearer <token>`。

| 层 | 数组 | 数量 | 说明 |
|---|---|---|---|
| 完全公开 | `$publicActions` | 11 | `login`、供应商 token 填报、客户公开询价、货架只读接口、`vendorLogin` |
| 供应商 token | `$vendorActions` | 9 | 供应商门户自助管理商品，与后台 `users` 隔离 |
| 后台登录 | 其余全部 | — | `requireAuth()` |

🔴 **加公开 action 前先问：这个接口能被匿名调用会怎样。** 白名单是唯一的门。

后台角色：`admin` / `sales` / `ops` / `finance` / `legal`，
权限矩阵存 `system_settings.role_permissions`。

## 数据模型（34 张表）

按模块分：询价报价链、订单履约链、商品货架、收款主体、短视频矩阵、办公、系统。
完整定义见 `backend/config/database.php`，详细说明见 `CLAUDE.md`。

### 🔴 级联删除链

```
customer_quotes ──┬─→ customer_quote_items   (CASCADE)
                  ├─→ quote_follow_logs      (CASCADE)
                  └─→ orders                 (CASCADE)
                        ├─→ contracts        (CASCADE)
                        ├─→ payments         (CASCADE)   ← 收款记录
                        └─→ commissions      (CASCADE)   ← 返佣
```

**删一行 `customer_quotes` 会连带删掉订单、合同、收款、返佣。**
写任何删报价的代码前必须先想清楚这条链。

SQLite **默认不开外键**——数据脚本里要显式 `PRAGMA foreign_keys = ON`。
反过来，开着外键时级联删得干净不留孤儿，所以**「孤儿数据为 0」不能证明没删过**。

### 发票快照

`customer_quotes` 上的 `invoice_entity_*` / `invoice_bank_*` 是**快照列**：
开票那一刻把抬头和银行账号冻结进去。留空的话打印时会回落读当前 `system_settings`，
历史发票会跟着设置改变——发票是对外正式单据，不可变是底线。

## 加价策略（`includes/helpers.php` 的 `applyMarkup`）

| type | 说明 | 数据 |
|---|---|---|
| `flat_pct` | 整单百分比 | `value: 15` |
| `per_item_pct` | 按单品百分比 | `payload: {inquiry_item_id: pct}` |
| `per_item_fixed` | 按单品加固定金额 | `payload: {inquiry_item_id: amount}` |
| `category_pct` | 按品类百分比 | `payload: {category: pct}` |
| `stepped` | 按成本价梯度 | `payload: {ladders: [{lt: 100, pct: 30}, ...]}` |

另有 `none`（不加价，售价 = 成本价），是对比页的**默认值**。
可保存为模板（`listMarkupRules` / `createMarkupRule`）。

## 系统设置

`system_settings` 表，KV 存储，后台「系统设置」页可视化维护，仅 `admin` 可写。
共约 29 项，分几组：

- **公司信息**：`company_name` / `company_address` / `company_phone` / `pdf_logo_path`
- **发票收款**：`invoice_no_prefix` / `invoice_due_days` / `bank_name` / `bank_account_no` /
  `bank_account_name` / `bank_swift`
- **报价**：`default_markup_pct` / `default_quote_valid_days` / `hide_supplier_brand_default`
- **电子货架**：`shelf.default_markup_pct` / `shelf.category_markup` /
  `shelf.price_change_threshold_pct` / `shelf.categories` / 联系方式与二维码若干
- **AI**：`ai.openai.api_key` / `ai.openai.model` / `ai.openai.endpoint`
- **其它**：`customer_sources` / `customer_categories` / `theme_color`

新增设置项只需改 `setting.php` 的 `SETTING_KEYS`，`listSettings` 会自动补齐，不用写 SQL。

> 更完整的收款主体 / 账户体系（`payment_entities` → `payment_accounts`）在
> 系统设置 →「收款主体 / 账户」Tab 维护，开票时选主体 + 账户并快照。

## API

所有请求走单入口：`GET/POST /api/handler.php?action=xxx`。
完整 action 清单以 `backend/api/handler.php` 的 `switch` 为准（约 200 个），按 handler 分文件：

```
auth  user_admin  customer  supplier  inquiry  supplier_quote  customer_quote  order
product_admin  category  channel  markup_rule  payment_account  setting  dashboard
shelf  vendor  public_quote  banner  short_video  calendar  workplan  ai
```

## 开发约定

- 新加列要在 `config/database.php` 的 `migrate()` 里写 ALTER 兼容老库
- 加 SQL 字段前先 grep schema，别假设字段存在
- `array_unique` / `array_filter` 后必须 `array_values()`，否则 PDO execute 会报
  column index out of range
- 数据脚本一律放 `scripts/data-fixes/`，幂等 + 无参 dry-run + `--apply` 才真执行
- 客户 / 供应商编号会**跳过任何含数字 4 的值**，编号不连续是正常的

更详细的接手说明（含近期迭代交接）见 **`CLAUDE.md`**。
