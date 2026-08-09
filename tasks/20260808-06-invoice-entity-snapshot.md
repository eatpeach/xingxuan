# 开票不带收款主体，多主体开票整套功能失效

| 项目 | 内容 |
|---|---|
| **状态** | ⏸ 代码完成+已部署，账号已给 → **卡在登录页人机验证滑块，需真人手动登录一次**（见结论末节） |
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

- [x] **1. 抽组件**：`IssueInvoiceButton` 抽成独立文件，`Orders.tsx:450` 改用它
      → 新建 `frontend/src/pages/IssueInvoiceButton.tsx`，**不从 `Quotes.tsx` import**，
      `Quotes.tsx` 里那份原封未动。抽得干净：只依赖 `antd` + `../api`，无 `Quotes.tsx` 内部引用
- [x] **2. 前端**：开票前弹窗选主体+账户，`api.post('issueInvoice', { id, account_id })` 带上参数
- [x] **3. 后端兜底**：`customer_quote.php` 的 `issueInvoice` 加上面第 3 条的判断
- [x] **4. 错误可见**：`doIssue` 里 try/catch + `message.error`
- [ ] **5. 只读盘点**：⏳ **脚本已写好，但本机跑不了**（无 PHP、生产库在服务器上）。
      新增 `scripts/data-fixes/audit_invoice_entity_snapshot.php`（`PRAGMA query_only=ON`，无 `--apply`）。
      **需在服务器上执行一次**：
      `cd /www/wwwroot/www.xingxuan.cc && php scripts/data-fixes/audit_invoice_entity_snapshot.php`

## 交付清单

- [x] **1. 组件抽离** + `Orders.tsx` 改用（不从 `Quotes.tsx` import）
- [x] **2. 前端选主体+账户可用**，三种情况都写了分支：
      多个账户 = 主体/账户两级选择（默认账户优先选中）；只有一个主体 = 自动选中省一步；
      一个可选账户都没有 = 转成警示 + 「仍然开票（用系统默认抬头）」。
      ⏳ **但三种情况都还没在浏览器里实跑**，见下「怎么验」
- [x] **3. 后端兜底实现**，拒绝时零副作用：`jsonError` 在 `_nextInvoiceNo` 和任何 `UPDATE` 之前
      就 `exit`，且整段没有开事务，不存在半写状态
- [ ] **4. 历史盘点数字**：⏳ 待在服务器上跑盘点脚本
- [x] **5. 静态自查记录**（见「结论」）
- [ ] **6. 线上验证记录**：⏳ 待部署

## 怎么验

前端部分本机能验（有 Node 18，`vite.config.ts` 把 `/api`、`/storage` 代理到生产，
`npm run dev` 看到的就是线上真实数据）。后端部分只能部署后线上验。

> ⛔ **B 本地验不了：`npm run dev` 起得来，但进后台要账号密码，我手上没有。**
> `CLAUDE.md` 写的 `admin / admin123` 已被用户改过。下面四条都需要登录态，**请 CTO 提供测试账号，或指定人来跑**。

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

**代码已完成待验证**（B，2026-08-09）。

### 改了什么

| 文件 | 改动 |
|---|---|
| `frontend/src/pages/IssueInvoiceButton.tsx` | **新增**。选主体+账户弹窗，不依赖 `Quotes.tsx` |
| `frontend/src/pages/Orders.tsx` | 发票 Tab 里裸 `api.post('issueInvoice', {id})` 换成 `<IssueInvoiceButton>` |
| `backend/api/handlers/customer_quote.php` | 新增 `_hasSelectablePaymentAccount()`；`issueInvoice` 加兜底闸门 |
| `scripts/data-fixes/audit_invoice_entity_snapshot.php` | **新增**，只读盘点 |
| `frontend/dist/` | 重建（新包 `index-DhX9waSR.js`） |

`Quotes.tsx` **一行没动**。核实过：全仓库没有任何文件 import `Quotes.tsx`
（`CLAUDE.md` 里「被详情页 import 复用」那句对 `Quotes.tsx` 已经不成立，`Orders.tsx` 仍成立）。

### 一个实现上的判断，请 CTO 确认

单子写的兜底条件是「`payment_accounts` 存在启用记录」。我实现成了
**启用账户 + 其所属主体也启用**（`JOIN payment_entities` 一起判断）。

原因：前端弹窗只列启用主体下的账户。若后端只看 `payment_accounts.status`，
出现「账户启用、主体停用」时会死锁——前端选不到任何账户，后端又硬拦，开票功能整个卡死。
两边用同一个口径就不会。**如果 CTO 认为该按字面只判 `payment_accounts`，我改回去。**

### 静态自查记录（本机无 PHP，只能静态查）

- **括号配平**：`customer_quote.php` 改动前后 `(` 与 `)` 的差值都是 `-2`（该文件历史上就带 -2，
  来自字符串字面量里的括号），大括号 90/90、方括号 405/405 全平；盘点脚本 11/11、87/87、10/10 全平
- **PDO 占位符 = execute 参数**：脚本扫了全文件 36 处 `prepare`，逐一比对占位符数与 `execute` 实参数，
  全部相等。两处告警（L775、L912）是 `IN ({$ph})` 和拼接 `$sets` 的动态 SQL，人工确认为误报。
  本单核心的两条 UPDATE：新开票 16=16、已开票补账户 13=13
- **我新增的代码没有任何占位符**：`_hasSelectablePaymentAccount` 用无参 `query()`；盘点脚本 `prepare` 数为 0
- **TypeScript**：`npm run build`（`tsc -b && vite build`）通过，无报错
- **盘点脚本无写操作**：全文不含 `INSERT/UPDATE/DELETE/DROP/ALTER`，且 `PRAGMA query_only=ON`

### 🔴 发现了第二条开票入口（单子说「遇到就停下来找 CTO」）

**`importHistoricalOrder`（`backend/api/handlers/order.php:520`，前端「录入历史订单」）
自己生成发票号，完全不经过 `issueInvoice`。**

- `order.php:555` 里 `if ($issueInvoice) { $invoiceNo = _nextInvoiceNo($pdo); ... }`，
  直接把 `invoice_no` 写进 `customer_quotes`
- 只接 `bank_name` / `bank_account_no` / `bank_account_name` 三个自由文本字段，
  而前端 `Orders.tsx:1436` 那个提交**一个都没传**
- **`invoice_entity_*` 一列都不写**，主体快照必然为空
- 前端那个「开具发票」开关 `useState(true)`，**默认开**

也就是说：本单的闸门堵住了 `issueInvoice` 这条路，但补录历史订单仍会源源不断产出空快照发票。
**没动它**——超出本单范围（红线：不动存量、不扩范围）。盘点脚本第 4 节会单独数出这条路径产生了多少张，
**建议按这个数字决定是否另开单**。

### 还没做的（都需要我拿不到的东西）

| 事项 | 卡在哪 |
|---|---|
| 浏览器实跑三种账户情况 | ~~没账号~~ 账号已给 → **改卡在登录页的人机验证滑块**，见下 |
| 历史空快照数量 | ✅ 已解（08-09 13:41 在服务器跑完，结果见 07 号单） |
| 线上验证（开测试发票、验打印页、验拒绝路径） | 同第一行 |

---

### ⏸ 第二次卡住（B，2026-08-09）：**账号能用了，但我过不了登录页的人机验证**

CTO 已提供测试账号（**按要求不写进本仓库**），部署也确认到位：

- 线上 `index.html` 引用的包 = 仓库 `frontend/dist` 的包（`index-DhX9waSR.js`），**同一个包**
- 拉下线上这个包实际 grep 过，06 的三段文案都在：
  `仍然开票（用系统默认抬头）` / `现有收款主体下没有启用的收款账户` / `请先选择收款主体` 各 1 处，
  `listPaymentAccounts` 3 处；05 的 `previewQuoteOverwrite` 也在
- **所以前端改动确实在线上，不是没部署**

**卡点是登录页那道滑块验证。** `frontend/src/pages/Login.tsx:20-21`：

```tsx
// GNAME 式滑块验证：拖到最右才算通过（配合后端登录限流使用）
function SliderVerify({ onOk }: { onOk: () => void }) {
```

`Login.tsx:90` 起，滑块没过就 `message.warning('请先按住滑块完成验证')`，提交被挡住。

**这个控件的用途就是拦截脚本化登录**（注释里写明了「配合后端登录限流使用」）。
我是自动化 agent，**替它把滑块拖过去，或者绕开它直接打 `?action=login` 拿 token，
都属于绕过人机验证——这类操作我不做**，是自己人的系统、手上有正当账号也一样。
这道控件存在的意义就是确保操作的是个人。

#### 需要人做一步，之后我能接着往下走

请任一真人在 Chrome 里**手动登录一次**（用 CTO 给的测试账号，自己拖一下滑块）。
登录态存在浏览器里，**登录完告诉我一声，我就能在同一个浏览器里接着验后面四条**，
不需要再要密码，也不需要人继续盯着。

> 这是**唯一**需要人介入的一步。不是要人替我把整套验证跑完。
