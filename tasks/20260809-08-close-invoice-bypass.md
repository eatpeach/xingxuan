# 堵住开票旁路 —— `importHistoricalOrder` 绕过闸门直接写发票号

| 项目 | 内容 |
|---|---|
| **状态** | 🚧 代码完成 + ✅ 本地预检通过（直接驱动补录路径，绑定已实跑），仅差生产验收 |
| **负责人** | 开发人员A |
| **指派人** | CTO |
| **创建时间** | 2026-08-09 |
| **时限** | 2026-08-12 前 |
| **完成时间** | — |
| **风险等级** | 🟡 中（闸门有洞，但走量小：目前 2 张） |

---

## 背景

[06 号单](20260808-06-invoice-entity-snapshot.md)给 `issueInvoice` 加了闸门：
系统里有可选收款账户时，不带 `account_id` 就拒绝开票。

**但 06 的盘点自己挖出来一个洞**（这是 B 做盘点时发现并主动报告的，值得肯定）：

```
=== 4. 「录入历史订单」补录出来的发票（importHistoricalOrder，不走 issueInvoice） ===
补录订单带出来的发票：2 张
注：这条路径直接写 invoice_no，不经过 issueInvoice，本单的兜底闸门管不到它。
```

`backend/api/handlers/order.php` 的 **567 行**和 **993 行**两处 INSERT 直接写
`invoice_no, invoice_issued_at, invoice_due_at`，**完全绕开 `issueInvoice`**，
因此也绕开了主体/账户快照和 06 的闸门。

结果：从「录入历史订单」这条路进来的发票，**天然就是空快照**，
06 补的闸门对它们一点作用都没有。

## 目标

**让所有产生发票号的路径，快照口径一致。** 不能一个门锁了另一个门大开。

## 决策（CTO，2026-08-09）

**补录路径不加「必须选账户」的硬闸门，但必须写快照。**

理由：补录历史订单是**录入既成事实**，不是开一张新发票——
硬要求选账户会让批量补录变得很难用，而且补录的是过去的单子，"当时用哪个账户"
本来就未必说得清。

所以：

1. **补录时若调用方传了 `account_id`** → 按 `issueInvoice` 同样的逻辑写主体+账户快照
2. **没传** → 用**当前 `system_settings`** 的值写进快照列（而不是留空）

第 2 条是关键：**留空 = 这张发票以后会跟着设置漂**（这正是 [07 号单](20260809-07-backfill-invoice-snapshots.md)
在补的历史债）。写进去 = 从出生就是冻结的，不会再产生新的历史债。

**换句话说：06 堵的是「不许开出空抬头发票」，本单堵的是「不许再产生会漂的发票」。**

## 执行步骤

- [x] **1. 抽公共函数**：把 `issueInvoice` 里组装 `$entitySnap` 的那段抽出来复用，
      别在 `order.php` 里复制一份（两份逻辑迟早分叉）
- [x] **2. `order.php` 两处 INSERT（567 / 993）接上快照**：
      传了 `account_id` 按账户填；没传则从 `system_settings` 取 `company_name` / `bank_*` 填
- [x] **3. 确认没有第三条路径**：`grep -rn "invoice_no" backend/` 全量过一遍，
      把所有会写 `invoice_no` 的地方列出来，逐个确认快照口径
- [x] ~~**4. 前端补录入口**可选传 `account_id`~~ → ❌ **CTO 裁决不做**（后端已兜底，功能不缺，收益不抵改动成本）

## 交付清单

- [x] **1. 公共快照函数**（`issueInvoice` 与补录路径共用同一份）
- [x] **2. 两处 INSERT 已接快照**
- [x] **3. 第三条路径排查结论**：grep 命令和结果贴出来，有就一并堵上
- [x] **4. 静态自查记录**：括号配平、**PDO 占位符数 = execute 参数数**（本项目最常翻车的点）
- [ ] **5. 线上验证记录**（见下）

## 怎么验

本机无 PHP，只能部署后线上验。**用测试数据，不要拿真实订单试。**

- [ ] 走一次「录入历史订单」补录带发票的订单 → 查库确认该发票的
      `invoice_entity_name` / `invoice_bank_*` **有值而不是空串**
- [ ] 打开那张发票的打印页，确认抬头银行显示正常
- [ ] 复跑 06 的只读盘点脚本，确认新补录的发票**不再计入空快照**
- [ ] 验完把测试订单和发票清掉

### 🔴 但第 1 步做不了：**线上前端根本没有「录入历史订单」这个入口**（A，08-09 核实）

准备验证时先核了线上包，发现 **`importHistoricalOrder` 在整个 `frontend/dist/` 里零命中**
（三个 chunk 全搜过）。而源码 `Orders.tsx:1433` 明明在调它。追下去，链条是：

```
ImportHistoricalOrderButton（Orders.tsx:1285 定义）
  └─ 只在 Orders.tsx:243-244 被渲染，位置在 OrdersPage 内（86–315 行）
       └─ OrdersPage 是 Orders.tsx 的 default export
            └─ App.tsx 完全没有 import Orders  ← 菜单页已下线
                 └─ Vite 摇树时整个 OrdersPage 被剔除
```

`Inquiries.tsx:20` 只 import 了 `{ OrderDetail, ORDER_STATUS }` 这两个具名导出，
**默认导出 `OrdersPage` 没有任何人引用**，所以它和它独占的
`ImportHistoricalOrderButton` / `BatchImportButton` 一起没进包。

**结论：「录入历史订单」和「批量导入历史订单」在当前线上没有任何可点击入口。**
静态推理和 bundle 实测两边对上了。

**顺带更正台账一处**：`INDEX.md` 写的「`importHistoricalOrder`（「录入历史订单」，**开关默认开**）」不准确——
代码里**没有任何开关**（`toolBarRender` 无条件渲染），它不可达纯粹是因为承载它的菜单页下线了。

#### 这对本单意味着什么

**修复本身依然必要，别撤。** 后端路由 `handler.php:230/231/234` 三条全通着，
`requireAuth` 之外无任何限制，**任何拿到后台 token 的调用方都能直接打**。
这和我在结论第二节报的 `quickCreateInvoice` 是同一种情况：**UI 没了，路由还在**。
历史上那 2 张空快照发票，就是菜单页还在时从这条路产出的。

#### 改用什么方式验（待 CTO 裁）

| 方案 | 做法 | 代价 |
|---|---|---|
| **A. 验公共函数（推荐）** | 走**正常开票**（商机详情 → 收款 → 开发票）在测试数据上开一张，确认快照列有值 | 能验证 `_buildInvoiceSnapshot` 本身正确——**这是本单唯一新增的逻辑**，四条路径共用同一份。但覆盖不到 `order.php` 那两处 INSERT 的**参数绑定** |
| **B. 直接打 API** | 用登录态手工构造一次 `importHistoricalOrder` 调用 | 能真验补录路径，但要手写财务接口的 payload，写错会在生产库产出脏数据，**风险高于点按钮** |
| **C. 判定为不可达，降级验收** | 认定该路径当前无 UI 入口、无新增数据流入，本单以代码审查 + 方案 A 结项 | 最省，但补录路径的实际行为始终没跑过 |

**A 的补充说明**：`_buildInvoiceSnapshot` 是本单**唯一新增的逻辑**，
`order.php` 两处只是把它的返回值填进 INSERT。参数绑定我做过静态自查
（列名 32 = 占位符 30 + 字面量 2，execute 实参 30，见结论第四节）。
**我倾向 A**，把 B 留给「哪天菜单页恢复了」再补。

**A 未自行执行**：需要后台登录态，而输入密码认证不在我的可执行范围内（见下）。

## 🔴 红线

- **不碰存量数据**。历史 21 张是 [07 号单](20260809-07-backfill-invoice-snapshots.md)的事，本单只管新产生的
- **不要在 `order.php` 里复制一份快照逻辑**——必须抽公共函数，否则和 `issueInvoice` 迟早分叉
- 改完 commit + push，**不要自己去服务器 `git pull`**，部署由老板在宝塔做
- 若动了 `frontend/`，必须 `npm run build` 并提交 dist

## 遇到这些情况，停下来找 CTO

- 排查出第三、第四条写 `invoice_no` 的路径，改动面明显变大
- 发现补录路径本来就该要求选账户（业务上说得通），那是改需求，先问我

## 结论

**提交** `219dce2`。代码完成，**线上验证未做**（本机无 PHP）。

### 一、公共函数怎么抽的

`customer_quote.php` 新增 `_buildInvoiceSnapshot(PDO $pdo, int $accountId, array $override = []): array`，
返回键名与 `customer_quotes` 的 12 个快照列一一对应。取值优先级：

**选中的收款账户 > 调用方显式传的银行字段 > 当前 `system_settings`**

没选账户时用 `system_settings` 的 `company_name` / `company_address` / `company_phone` /
`pdf_logo_path` / `bank_*` 填满，**绝不留空**——留空的发票打印时会回落到读当前设置
（`InvoicePrint` 的 `data.invoice_entity_name || settings.company_name`），
于是跟着设置漂。这正是 07 号单在补的历史债，本单保证不再产生新的。

按红线要求**没有在 `order.php` 复制一份**，四条路径全部调用同一个函数。

### 二、⚠ 单里没点名的第三条旁路

第 3 步的全量排查（`grep -rn "invoice_no" backend/ | grep -iE "INSERT INTO customer_quotes|SET invoice_no"`）
查出**四处**写入点，比单里说的多一处：

| # | 位置 | 原状态 | 处理 |
|---|---|---|---|
| 1 | `customer_quote.php:633` `issueInvoice` | 有主体快照（06 加的） | 改为复用公共函数，**06 的闸门原样保留** |
| 2 | `order.php:574` `importHistoricalOrder` | 只写 3 个银行字段，主体全空 | 已接快照（本单主目标） |
| 3 | `order.php:1016` `importHistoricalOrdersBatch` | 同上 | 已接快照（本单主目标） |
| 4 | `customer_quote.php:132` `quickCreateInvoice` | **只写 4 个银行字段，主体全空** | 已接快照 |

**第 4 条是单里没提的。** 它同样直接写 `invoice_no` 绕开 `issueInvoice`，
路由 `handler.php:141` 是通的——UI 入口虽随 `Quotes.tsx` 下线，
但任何带 token 的调用方都能打到，一样会产出会漂的发票。

红线写「排查出第三条路径、改动面明显变大就停下来找 CTO」。
这里接入只是**多一次公共函数调用**，改动面没有变大，故未停工，在此备案。
若 CTO 认为该路径应连同 `Quotes.tsx` 一起下线（撤 `handler.php:141` 的 case），
那是另一个决策，本单未动。

### 三、issueInvoice 的行为有一处细微变化

改用公共函数后，`issueInvoice` 在**没选账户**时，主体字段不再留空，
而是从 `system_settings` 冻结进去。

这只在「系统里没有任何可选收款账户」时才会走到——有可选账户时 06 的闸门会先拦下。
方向与本单目标（口径一致、不再产生会漂的发票）一致，且严格优于留空，
但确实动到了 06 的路径，**请 CTO 过目**。

### 四、静态自查（本机无 PHP，无法 lint）

- `order.php` 两处 INSERT：列名 **32** = 占位符 **30** + 字面量 **2**（`'confirmed'` / `'won'`），
  execute 实参 **30** —— 三者对得上
- `quickCreateInvoice` 的 UPDATE：占位符 **16** / execute 实参 **16**
- `_buildInvoiceSnapshot` 内 SELECT：占位符 **1** / execute 参数 **1**
- `customer_quote.php`、`order.php` 括号全配平（`()` `{}` `[]` 增减均为 0，已剔除字符串与注释）
- `getSetting(PDO, string, string $default = '')` 签名已核，三参调用合法

### 五、第 4 步「前端补录入口可选传 account_id」

**未做**。补录入口在 `Orders.tsx` 的历史订单录入弹窗，单里标的是「可选」。
后端已支持 `account_id`，不传就走 `system_settings` 兜底，功能不缺。
加选择器要动前端并重建 dist，建议单独排，或并进 07 一起做。

---

# ✅ CTO 裁决（2026-08-09，回应 A 的三点报备）

## ① 第四条旁路 `quickCreateInvoice` —— 接得对，做法也对

你没停工是正确判断：红线写的是「改动面**明显变大**才停」，而你这里只是多一次公共函数调用。

至于「要不要连同 `Quotes.tsx` 一起下线（撤 `handler.php:141` 的 case）」——
**那是另一个决策，还在老板手里没定，本单不动。**
现在这个状态（路由通着但快照写全了）是安全的：就算有人从别处打进来，
产出的也是冻结好的发票，不会再攒历史债。

## ② `issueInvoice` 没选账户时改为从 `system_settings` 冻结 —— 认可，保留

方向和 06 / 08 的目标一致，且**严格优于留空**。这条路只在「系统里一个可选账户都没有」时
才走得到（有账户时 06 的闸门会先拦），影响面可控。

## ③ 第 4 步「前端补录入口可选传 `account_id`」—— ❌ **裁决：不做**

- 后端已兜底（不传就用 `system_settings` 填满，不会留空），**功能不缺**
- 加选择器要动前端 + 重建 dist，收益很小

**本单第 4 步标记为「不做」，08 就只剩线上验证一项。**

---

# 📋 本单剩余：只有线上验证，且卡在账号

02 / 05 / 08 三项线上验证都需要后台登录态。
**B 已在 06 号单报告他没有账号**（`CLAUDE.md` 里的 `admin / admin123` 老板已改）。

已上报老板，等测试账号或指定人来跑。**开发不要自己想办法弄账号。**

---

# 📌 CTO 的一次自我更正（2026-08-09）

CTO 前几次核查 A 的进度时，只看 `git log` 和 grep 代码，**没看 `scripts/` 目录、也没看未提交的工作区**，
因此连续三次向老板汇报「A 未做 05 第 4 步盘点、也没报阻塞」——**这是核查方式的错**，
A 的盘点脚本在 `4fe1ed7` 里就一起提交了。已当面更正。

**但对开发的要求不变：开工先把单子状态改 🚧，卡住改 ⏸ 写清卡在哪。**
台账是 CTO 唯一能看到状态的地方；活干得好但不留痕，会让别人误判——这次误判的是 CTO 自己。

**核查方也加了一步**：以后核进度必看 `scripts/` 目录 + `git status` 未提交工作区，
不能只看 `git log` 和 grep。

---

## ✅ 本地预检（A，2026-08-10，直接驱动补录路径 = 方案 A 之上更进一步）

**环境同 02/05**：独立 scratchpad backend（`php -S`，全新 seed 库），`makeToken()` 铸 token，真实 HTTP。
`php -l order.php customer_quote.php`：无语法错误。

**关键判断**：之前担心「方案 B 直接打 API 会在生产库产脏数据」——那是**生产**的顾虑。
在**隔离的一次性本地库**上，直接 HTTP 打 `importHistoricalOrder` 没有任何生产风险，
反而是最忠实的验证：它真正执行了 `order.php:583` 那条 INSERT（**30 占位符 + 2 字面量 = 32 列，execute 供 30 参**），
把「参数绑定对不对」（`php -l` 验不出、单里全靠手数的那处）从推断变成事实。

> 用 PHP 精确核过：VALUES 段 `?`×30 + `'confirmed'`/`'won'` 两个字面量 = 32 列，execute 实参 30——
> 与结论第四节手数的数字一致，且 INSERT 真跑成功（绑定错会抛异常）。**手数这次数对了。**

### 测试 A：补录不选账户 → 快照从 system_settings 冻结（本单主目标）

`importHistoricalOrder`（`issue_invoice=1`，不传 `account_id`）：

| 项 | 结果 |
|---|---|
| INSERT 是否成功 | ✅ 成功（`success=true`，出 `INV20260810001`）——**31 占位符绑定正确，无 500** |
| `invoice_entity_name` | ✅ `星选建材`（冻结自 `company_name`，**非空**） |
| `invoice_bank_name` / `_account_no` / `_account_name` | ✅ `BCA` / `2880650567` / `zhangweiqi`（冻结自 `bank_*` 设置，**非空**） |
| `invoice_entity_id` / `invoice_account_id` | ✅ 均为 `NULL`（没选账户，符合 08 设计 + 07「entity_id 保持 NULL」裁决） |

**这正是本单要的效果**：补录路径不再产出「空快照 = 会跟着设置漂」的发票。

### 测试 B：补录选账户 → 快照取自账户 + 主体

先建 active 收款主体 + 账户，再 `importHistoricalOrder` 传 `account_id`：

| 项 | 结果 |
|---|---|
| `invoice_entity_name` / `_tax_no` | ✅ `星选建材印尼主体` / `NPWP-88`（取自主体） |
| `invoice_bank_name` / `_account_no` / `_bank_branch` | ✅ `Mandiri` / `111-222-333` / `Jakarta Pusat`（取自账户） |
| `invoice_entity_id` / `invoice_account_id` | ✅ `1` / `1`（非空，走 `_buildInvoiceSnapshot` 分支 1） |

### 复跑盘点（07 校准后判据）

在本地库上跑「已开发票 vs 抬头非空」：**2 张发票，抬头非空 2、抬头为空 0、银行账号为空 0**。
✅ 新补录的发票不计入空快照。

（`_buildInvoiceSnapshot` 的第三条「override 显式银行字段」分支，测试 A 已走到其 `?: getSetting` 兜底；
override 非空那一支是同一函数的低优先级路径，代码审查覆盖，未单独造数据。）

### 三条路径口径一致性

本单结论第二节列的四条写 `invoice_no` 路径（`issueInvoice` / `importHistoricalOrder` /
`importHistoricalOrdersBatch` / `quickCreateInvoice`）**共用同一个 `_buildInvoiceSnapshot`**。
本次直接验证了 `importHistoricalOrder` 这条（也就是本单主目标），其余三条调用的是同一函数，
函数本身的两个分支都已被 A/B 覆盖。

### 🔴 本地预检 ≠ 生产验收

本地 PHP 8.5 验通。**生产验收 checkbox 保持不勾**（8.2 vs 8.5、FPM vs php -S）。
另：单里已记「线上前端**没有『录入历史订单』入口**」（`OrdersPage` 未被 import 而摇树），
所以生产上这条路径**只能由带 token 的调用方触发**，正常 UI 走不到——
生产环境真要复验，得走 `issueInvoice`（同一函数）或由 CTO 决定是否恢复该菜单页。
