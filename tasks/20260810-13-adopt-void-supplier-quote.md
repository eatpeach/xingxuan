# 供应商报价采纳 / 作废没有入口 —— 一询多供「最终选了谁」在系统里没有留痕

| 项目 | 内容 |
|---|---|
| **状态** | 🚧 摸底中（B 2026-08-10 开工）|
| **负责人** | 开发人员B |
| **指派人** | CTO |
| **创建时间** | 2026-08-10 |
| **时限** | 2026-08-15 前 |
| **完成时间** | — |
| **风险等级** | 🟡 中（不丢钱，但业务过程无记录） |

---

## 问题

「一询多供」是这个平台的核心流程：一张询价派给多家供应商，各自报价，销售挑一家。

**但「挑了哪家」这个动作，在系统里没有任何记录。**

- 界面渲染了 `adopted`（已采纳）状态标签
- 后端 `adoptSupplierQuote` / `voidSupplierQuote` 都在
- **前端零调用** —— 所有供应商报价永远停在 `submitted`

事后查不出某个商机最终采纳了谁的报价。**过程数据是断的。**

## CTO 已核实的前提（2026-08-10）

**这次我先自己核过再写单，但你仍然照老规矩再核一遍——这两天我写错过四次前提。**

| # | 事实 | 位置 |
|---|---|---|
| 1 | `handle_adoptSupplierQuote` 存在 | `supplier_quote.php:46` |
| 2 | `handle_voidSupplierQuote` 存在 | `supplier_quote.php:55` |
| 3 | 两个路由都通 | `handler.php:127` / `128` |
| 4 | 前端**零调用** | `grep -rn "adoptSupplierQuote\|voidSupplierQuote" frontend/src/` 无结果 |
| 5 | 两个 handler 都是**裸 UPDATE 一行**，无任何附加逻辑 | 见下 |

```php
// adopt：只改自己，不碰同组其它报价
$pdo->prepare("UPDATE supplier_quotes SET status='adopted' WHERE id = ?")->execute([$id]);
// void：同样只改自己
$pdo->prepare("UPDATE supplier_quotes SET status='void' WHERE id = ?")->execute([$id]);
```

**所以这确实是「后端现成、只缺入口」** —— 但见下面那条，可能没这么干净。

## 🔴 一条我看到的线索，需要你核实

`Inquiries.tsx:737` 有个映射表叫 **`DISPATCH_STATUS`**：

```tsx
pending: '等待报价'  submitted: '已提交'  adopted: '已采纳'
rejected: '未采纳'   expired: '已过期'
```

**后端 void 写的是 `status='void'`，而这张表里没有 `void`。**

如果这张表被用来渲染供应商报价的状态，那么**作废一条之后，界面会直接印 `void` 四个英文字母**——
和 12 号单里 `confirmed` 那个缺陷**一模一样的类型**。

而且表里的 `rejected` / `expired` / `pending` 是谁写的？**表名叫 `DISPATCH_STATUS`，
它到底是给 `dispatches` 表用的还是给 `supplier_quotes` 用的？**
如果是给 dispatches 的、却被复用来渲染报价状态，那就是两套状态机混用。

**这条我只看到线索没查透，你去查清楚。**

## ❓ 一个必须先回答的设计问题：采纳一条，其余怎么办

后端 adopt 只改自己，**对同组其它报价没有任何处理**。所以这是个**开放的产品决策，不是代码问题**：

| 方案 | 含义 | 代价 |
|---|---|---|
| **A. 采纳一条，其余自动置 `void`** | 「一询多供最终选一家」，语义干净 | 万一要改主意，得先把作废的改回来 |
| **B. 采纳一条，其余不动** | 允许多家同时 `adopted`（比如分单给两家） | 「最终选了谁」还是答不清楚 |
| **C. 采纳一条，其余置 `rejected`（未采纳）** | 比 `void` 语义准确——是「没选中」不是「作废」 | 要确认 `rejected` 这个值现在有没有别的含义 |

**我倾向 C**，理由：`void`（作废）的语义是「这条报价本身不算数了」，
而没被选中的报价**是有效的、只是没中标**——把它们标成「作废」是失真的。
而且 `rejected` 在那张映射表里已经有中文标签「未采纳」，说明当初就是这么设计的。

**但先别按 C 做。** 你摸底时确认两件事再定：
1. `rejected` 这个值现在有没有被别处写入、有没有别的含义
2. 业务上会不会真的分单给多家（若会，B 方案才对）

**摸完报我，我再拍。**

## 要做什么（摸底通过后）

1. **入口**：商机详情第①步「供应商报价」的报价列表，行内加「采纳 / 作废」
2. **状态可见**：列表里显示当前状态，用中文标签
3. **补齐缺失的标签**：`void`（若确实会显示）等，别再印英文
4. **采纳的连带处理**：按上面拍定的方案

## 🔴 明确不做的

- **不做「采纳后自动生成对客报价」** —— 那是把两个步骤焊死，业务上未必想要
- **不动 `InquiryCompare` 的选行逻辑** —— 那是生成报价时挑哪一行，
  和「采纳哪家供应商的报价」是两件事，别混
- **不动 `Quotes.tsx`**

## 摸底要回答的（照你 07 / 12 的老规矩，先验证前提）

- [ ] `supplier_quotes.status` 实际有哪些取值、分别谁写的、有没有「活着但前端没标签」的
- [ ] `DISPATCH_STATUS` 到底服务哪张表，有没有两套状态机混用
- [ ] 有没有别处拿 `supplier_quotes.status` 当闸门用（12 号单踩到 `deleteCustomerQuote` 那种耦合）
- [ ] 采纳/作废与 `InquiryCompare` 选行、与 05 的覆盖硬拦有没有交叉
- [ ] `rejected` 的现有含义（决定上面选 A / B / C）

**摸完先报结论再动手。前提有问题就停下来找我。**

## 交付清单

- [ ] **1. 摸底结论**（上面五条）
- [ ] **2. 采纳/作废入口**
- [ ] **3. 状态中文标签补齐**
- [ ] **4. 连带处理按拍定方案实现**
- [ ] **5. 静态自查**：括号配平、**PDO 占位符数 = execute 参数数**
- [ ] **6. 线上验证记录**（需真人开门）

## 🔴 红线

- **不碰真实商机的供应商报价**，只用测试数据
- 动了 `frontend/` 必须 `npm run build` 并提交 dist，**并做重建后的回归检查**
  （确认 04/05/06/12 已上线的东西都还在，没打掉）
- 改完 commit + push，**不要自己去服务器 `git pull`**

## 结论

### 摸底（B，2026-08-10）——**未写一行实现代码**

#### ✅ 先自核 CTO 的五条前提：**全部属实**

adopt / void 两个 handler 存在、路由通（`handler.php:127`/`128`）、
**前端零调用（我自己 grep 确认，不是照抄）**、都是裸 UPDATE 一行。

补一条 CTO 没提的：两个 handler 进来都先调 `_loadSupplierQuote($pdo, $id)`，
不存在会 `jsonError('报价单不存在', 404)`。所以不是完全裸奔，有存在性校验，也都写了 `opLog`。

#### 1. `supplier_quotes.status` 的实际取值

| 值 | 谁写 | 会不会出现 | 前端有中文标签 |
|---|---|---|---|
| `submitted` | 两处 INSERT（`supplier_quote.php:134` 代录入 ／ `public_quote.php:167` 链接填报） | ✅ | ✅ 已提交 |
| `adopted` | `adoptSupplierQuote` | ⚠ 能写但前端零调用 → **线上从未产生过** | ✅ 已采纳 |
| `void` | `voidSupplierQuote` | ⚠ 同上 | ✅ 已作废 |
| `draft` | schema `DEFAULT 'draft'` | ❌ 两处 INSERT 都显式写 `submitted`，产生不了 | ❌ 无（但也不会出现） |
| `rejected` | **从未写入 `supplier_quotes`** | ❌ | —— |

**`rejected` 的现有含义（CTO 问题①的答案）**：它只在 **`products` 表**的商品审核里用
（`product_admin.php:160` 驳回商品、`vendor.php:142/193`）。**另一张表、另一套语义，和供应商报价没有任何关系。**
→ **拿它表示「未采纳」不存在冲突。**

#### 2. 🔴 `DISPATCH_STATUS` 那条：**CTO 的假设不成立，但真问题在隔壁，而且更严重**

**假设不成立的部分**：担心「作废后界面印 `void` 四个英文字母」——**不会**。
供应商报价列表在 `Inquiries.tsx:973-981` 有一张**自带的内联状态表**，
`submitted` / `adopted` / `void` 三个都有中文标签，`void` = 「已作废」。
**`DISPATCH_STATUS` 根本没被用来渲染供应商报价。**

**但 `DISPATCH_STATUS` 自己是坏的。** 它服务的是 `dispatches`
（`Inquiries.tsx:906` 的 `d.status`，`d` 来自 `listDispatches`，
而 `handle_listDispatches` 返回 `d.*` **原样不加工**）：

| `DISPATCH_STATUS` 的键 | `dispatches` 实际会不会出现 |
|---|---|
| `pending` | 只是 schema `DEFAULT`；两处 INSERT 都显式写值 → 产生不了 |
| `submitted` / `adopted` / `rejected` / `expired` | **从不写入**——这四个是供应商报价/商品的词汇，混进来了 |

而 `dispatches.status` **实际只有两个值**：
- `sent` —— `inquiry.php:457` 派单时写
- `responded` —— `supplier_quote.php:98`/`103`、`public_quote.php:205` 供应商回报时写

**这两个值 `DISPATCH_STATUS` 里一个都没有** →
🔴 **现在每一行派单都在界面上印英文原文 `sent` / `responded`。**

CTO 猜的「两套状态机混用」**确实存在，但方向反了**：
不是供应商报价的状态缺标签，而是**派单列表挂了一张供应商报价的词汇表**。
影响面是 **100% 的派单行**，比 12 号单的 `confirmed`（只影响补录的历史订单）更普遍。

另：`expired` 也是死键——token 过期只在 `public_quote.php:80` 校验时拒绝访问，
**不回写 `status`**，所以派单永远不会变成 `expired`。

#### 3. 🔴 `supplier_quotes.status` 有两处闸门（CTO 让找的耦合，找到了）

**(a) 供应商重新提交时「删旧建新」**（`public_quote.php:146`、`supplier_quote.php:113`）：

```php
SELECT id, no FROM supplier_quotes WHERE dispatch_id = ? AND status != 'adopted' ORDER BY id DESC LIMIT 1
// 找到就 DELETE 掉，保留原单号重建
```

- ✅ **已采纳的报价受保护**，不会被供应商重新提交冲掉——这个行为是对的
- ⚠ 但 `void` 和 `submitted` 的**会被真删**（`DELETE`，不是标记）

**(b) 🔴 `compareInquiry` 的过滤**（`inquiry.php`）：

```sql
WHERE q.inquiry_id = ? AND q.status IN ('submitted','adopted')
```

**→ 作废的报价会从「对客报价」对比页消失。**

#### 4. 🔴 这直接决定 A/B/C ——**CTO 倾向的 C 会静默弄坏对比页**

| 方案 | 对比页后果 |
|---|---|
| **A**（其余 → `void`） | 其余报价**从对比页消失** |
| **C**（其余 → `rejected`） | `rejected` 同样不在 `IN ('submitted','adopted')` 里 → **一样消失** |
| **B**（不动） | 无影响 |

**A 和 C 都会让「采纳一条」顺带把其它家的报价从对比页抹掉。**
销售之后想改主意、或想按另一家重新生成对客报价（05 那条活路径），行没了。

**C 的语义判断是对的**（`rejected` 从未被 `supplier_quotes` 用过、无冲突，
且比 `void` 准确——没中标不等于作废）。**但必须连带把 `compareInquiry` 的过滤条件加上 `rejected`**，
否则功能第一天就是错的——和 12 号单那条时区偏差是同一种性质：
**在一个会把数据藏起来的查询上建功能。**

**我的建议：C ＋ 把过滤改成 `IN ('submitted','adopted','rejected')`。**
这样其余报价仍在对比页可见、只是标成「未采纳」，销售改主意随时能切回来。

🔴 **但这是改既有查询的行为，我不自己拍。** 另外 CTO 问题②（业务上会不会分单给多家）
**我答不了，那是业务事实，不在代码里**——若真会分单，B 才对。

#### 5. 与 05 号单的交叉：**无**

05 的硬拦判的是 `customer_quotes` 的「已开票 / 有订单」，与 `supplier_quotes.status` 无关。
`InquiryCompare` 的选行逻辑是「生成对客报价时挑哪一行明细」，和「采纳哪家供应商」是两件事，
按红线不动它。

### 待 CTO 裁决的三件事

1. **A / B / C 选哪个**，以及若选 C，**同不同意连带改 `compareInquiry` 的过滤**
2. **业务上会不会分单给多家**（这条只有业务方能答）
3. **`DISPATCH_STATUS` 那个真缺陷要不要本单顺手修**（补 `sent` / `responded` 两个标签）。
   它和本单主题相邻但不是一回事——**建议顺手修**，理由同 12 号单的 `confirmed`：
   本单要动这块界面，明知道每行都在印英文还放着说不过去。**但要不要修、算不算扩范围，你定。**
