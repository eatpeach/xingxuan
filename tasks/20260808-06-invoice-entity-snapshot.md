# 开票不带收款主体，多主体开票整套功能失效

| 项目 | 内容 |
|---|---|
| **状态** | 📋 待开始 |
| **负责人** | 开发人员B（2026-08-08 新加入星选，本单是第一张） |
| **指派人** | CTO |
| **创建时间** | 2026-08-08 |
| **时限** | 2026-08-12 前 |
| **完成时间** | — |
| **风险等级** | 🔴 高（对客正式单据信息缺失） |

---

## 先读这些（B 第一次接手本项目）

1. `CLAUDE.md` —— 尤其「协作偏好」和「近期迭代交接」两节
2. **本机没有 PHP / brew / docker**，后端改动**无法本地运行或 lint**，只能静态自查 + 部署后线上验
3. 前端 `dist` **进 git**：动了 `frontend/` 就必须 `npm run build` 并把 dist 一起提交，否则线上不生效
4. 本项目最常翻车的点：**PDO 占位符数 ≠ execute 参数数**；`array_unique`/`array_filter` 后必须 `array_values()`

## 背景

系统做了一整套「收款主体 / 账户」：`payment_entities`（抬头/NPWP/地址/电话/logo/公章）
→ `payment_accounts`（银行/账户名/账号/支行/SWIFT/币种），管理入口在系统设置里。
开票时本该选一个账户，把**主体 + 账户快照**进发票，之后改设置也不影响已开的发票。

**但这套东西一次都没被真正用上。**

### 已核实

现在唯一能走到的开票入口，`frontend/src/pages/Orders.tsx:450`：

```tsx
const r = await api.post('issueInvoice', { id: order.quote_id })
```

**没传 `account_id`。** 后端 `backend/api/handlers/customer_quote.php:490` 起：

```php
$accountId = (int) ($input['account_id'] ?? 0);
if ($accountId) {
    ... 查账户 + 主体，填满 $entitySnap
}
// 不传 → $entitySnap 保持初始的全空值，原样写进快照列
```

结果：`invoice_entity_*` / `invoice_bank_*` 全部写空串，
发票打印页只能回落到 `system_settings.company_name` 和默认 `bank_*`。

**会弹窗选主体+账户的 `IssueInvoiceButton` 在 `Quotes.tsx:707`**，
而 `Quotes.tsx`（1409 行）已经完全脱钩——没有任何 import、没有路由，所以那个弹窗根本走不到。

后果：客户收到的**正式发票**上，抬头、NPWP、地址、logo、公章、银行账户信息全是系统默认或空的。

## 决策（CTO，2026-08-08）

**把选主体+账户的能力接回唯一可达的开票入口，并且在后端加一道兜底。**

### 1. 组件先抽出来，不要从 `Quotes.tsx` import

`Quotes.tsx` 的去留是另一个待决策事项（还没开单），**现在从它 import 会把这个决策绑死**。
把 `IssueInvoiceButton` 抽成独立文件（如 `frontend/src/pages/IssueInvoiceButton.tsx`），
`Orders.tsx` 从新文件引用。`Quotes.tsx` 里那份原地留着别动，等去留决策出来再一起清。

### 2. 有账户就必须选，没账户才允许回落

- 系统里**存在启用的收款账户** → 开票**必须**选一个，不选不让提交
- 系统里**一个启用账户都没有** → 允许按现在的方式开（回落系统默认），
  但要给明确提示，引导去「系统设置 → 收款主体 / 账户」配置

**为什么不一刀切强制**：全新部署还没配账户时，硬卡会让开票功能直接不可用。

### 3. 后端加兜底（跟 02 号单同一个思路）

前端传参是第一道，后端是第二道。`issueInvoice` 里：
若 `account_id` 为空 **且** `payment_accounts` 存在启用记录 → `jsonError` 拒绝，
提示「请选择收款账户」。**两层都要**——只靠前端，换个调用方就绕过去了。

## 执行步骤

- [ ] **1. 抽组件**：`IssueInvoiceButton` 抽成独立文件，`Orders.tsx:450` 改用它
- [ ] **2. 前端**：开票前弹窗选主体+账户，`api.post('issueInvoice', { id, account_id })` 带上参数
- [ ] **3. 后端兜底**：`customer_quote.php` 的 `issueInvoice` 加上面第 3 条的判断
- [ ] **4. 错误可见**：后端拒绝时前端要显示出来。
      ⚠ 本项目老毛病：`api.post` 没 try/catch 会**静默无反应**（02、05 号单都踩过），别再犯
- [ ] **5. 只读盘点**：查线上 `customer_quotes` 里已开发票中 `invoice_entity_id IS NULL`
      或 `invoice_bank_account_no = ''` 的有多少条，出个数字给 CTO。**只查不改**

## 交付清单

- [ ] **1. 组件抽离** + `Orders.tsx` 改用（不从 `Quotes.tsx` import）
- [ ] **2. 前端选主体+账户可用**，三种情况都验：有多个账户 / 只有一个 / 一个都没有
- [ ] **3. 后端兜底实现**，拒绝时零副作用（不产生任何状态变更）
- [ ] **4. 历史盘点数字**：多少张已开发票是空快照
- [ ] **5. 静态自查记录**：括号配平、PDO 占位符数 = execute 参数数
- [ ] **6. 线上验证记录**（见下）

## 怎么验

前端部分本机能验（有 Node 18，`vite.config.ts` 把 `/api`、`/storage` 代理到生产，
`npm run dev` 看到的就是线上真实数据）。后端部分只能部署后线上验。

- [ ] `cd frontend && npm run dev`，走一遍开票弹窗，确认能列出主体和账户
- [ ] **用测试数据开一张发票**（不要拿真实客户的报价试），确认打印页上
      抬头 / NPWP / 地址 / 银行账户 **来自所选账户而不是系统默认**
- [ ] 不选账户直接提交 → 应被拒绝且**有可见提示**
- [ ] 验完把测试发票清掉

## 🔴 红线

- **不碰存量已开发票的数据**。本单只改代码 + 只读盘点，补历史数据另开单
- **不动 `Quotes.tsx`**，也不从它 import——它的去留是另一个未决事项
- 拒绝路径零副作用：先判断再写库，不要先开票再回滚
- 动了 `frontend/` 必须 `npm run build` 并提交 dist
- 改完 commit + push，**不要自己去服务器 `git pull`**，部署由用户在宝塔做

## 遇到这些情况，停下来找 CTO

- 盘点发现空快照发票数量很大（说明历史发票普遍缺信息，是要补数据的事故）
- 发现除 `Orders.tsx:450` 外还有别的开票入口
- 抽组件时发现 `IssueInvoiceButton` 依赖了 `Quotes.tsx` 里的其他东西，抽不干净

## 结论

_（完成后填写：组件抽离方式、三种账户情况的验证、历史空快照数量、线上验证记录）_
