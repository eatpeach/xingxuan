# 代码盘点结论 · 2026-08-08

> **这不是任务单**，是开发人员A 应要求做的一次全量盘点，供 CTO 决定要不要开单。
> 基线 `6a1dfb0`。方法：后端 170 个 `handle_*` 与前端全部调用点交叉核对，
> 再按可达性回溯（`Quotes.tsx` 已无 import，其内部调用不计入可达）。
> 与已开的 02 / 03 / 04 号单**无重叠**。

## 🔴 P0 · 功能已经坏了但没人发现

### A. 开票不带收款主体快照，「收款主体/账户」整套功能事实上失效

现在唯一能走到的开票入口是 `frontend/src/pages/Orders.tsx:450`：

```tsx
const r = await api.post('issueInvoice', { id: order.quote_id })
```

**没传 `account_id`**。后端 `backend/api/handlers/customer_quote.php:491`
的 `account_id` 是可选参数，不传就走空快照：`invoice_entity_*` 与
`invoice_bank_*` 全部留空，发票打印页只能回落到 `system_settings.company_name`
和默认 `bank_*`。

后果：commit `6edfebb` 专门做的多主体开票（抬头 / NPWP / 地址 / logo / 公章 + 银行账户快照）
**一次都没被真正用上**。原本会弹窗选主体+账户的 `IssueInvoiceButton`
在 `Quotes.tsx:707`，已随该文件一起脱钩（见 C）。

建议：把选主体+账户的弹窗迁到 `Orders.tsx` 的开票按钮；
另外查一下线上 `customer_quotes` 里 `invoice_entity_id IS NULL` 的已开发票有多少条。

### B. 重新生成对客报价会连带删掉订单、合同、收款、返佣

`backend/api/handlers/customer_quote.php:744-750` 无条件执行
`DELETE FROM customer_quotes WHERE inquiry_id = ?`，而
`orders.quote_id` 是 `ON DELETE CASCADE`，级联链是
`customer_quotes → orders → contracts / payments / commissions`。

代码注释写「按产品要求即为预期行为」，但前端只提示
「生成后将覆盖下方现有对客报价」——**没说会连订单和收款记录一起删**。
销售在「对客报价」步骤重新生成一次，已成交订单的收款和返佣就没了，不可逆。

需要 CTO 定：是真要无条件覆盖（那就补 Popconfirm，明确列出将被删除的订单号和已收金额），
还是已开票/已生成订单的要拦住。

## 🟡 P1 · 有后端没入口

### C. `Quotes.tsx` 已完全脱钩，8 个后端能力随之失联

`9d53243`（本人 08-08 改动）移除商机详情的「管理」入口后，
`Quotes.tsx`（1409 行）已无任何 import，也没有路由。以下 action 不再可达：

| action | 原入口 | 影响 |
|---|---|---|
| `sendCustomerQuote` | 发送给客户 | 报价的 `sent_at` / `status=sent` 再也不会被设置 |
| `updateQuoteTerms` | 编辑报价条款 | 有效期/生产周期/备注生成后改不了（生成时可设，影响有限） |
| `listQuoteFollowLogs` / `addQuoteFollowLog` / `deleteQuoteFollowLog` | 跟进记录 | 整个跟进功能失联 |
| `deleteCustomerQuote` | 删除报价 | — |
| `markInvoicePaid` | 标记已收款 | 履约管理有独立收款流程，可能本就重复 |
| `convertSupplierQuote` | 🎯 一键转化商机 | 供应商报价 → 星选报价单，`b8174f4` 刚扩过粘贴文字模式 |
| `quickCreateInvoice` + `createCasualQuote` | 快速开发票 | 跳过派单直接生成报价+发票 |

「一键转化商机」和「快速开发票」是两个完整功能，优先确认还要不要。
决策完之前**不要删 `Quotes.tsx`**。

### D. 其余无入口的后端能力

| 能力 | action | 现状 |
|---|---|---|
| 供应商报价采纳 / 作废 | `adoptSupplierQuote` / `voidSupplierQuote` | 商机详情渲染了 `adopted` / `void` 状态标签，但没地方能设置，所有报价永远停在 `submitted` |
| 询价附件上传 | `uploadInquiryAttachment` | `inquiry_attachments` 表闲置，客户发来的图纸/清单存不下原件 |
| 加价策略模板 | `list/create/update/deleteMarkupRule` | 四个 action 全部空转。`CLAUDE.md` 说「4/5 通过 markup-rules API 用模板使用」，但没有界面，`category_pct`（按品类）和 `stepped`（阶梯）两种策略事实上不可用 |
| 业务员管理 | `create/update/deleteSalesperson` | 只有 `listSalespersons` 被 `Orders.tsx:1268` 用来读列表，新增业务员只能直接改 SQLite |

## 🟢 P2 · 工程债

### E. `CLAUDE.md` 三处与代码不符

- A 节写「已开票或已生成订单的旧报价保留」——与上面 B 的无条件删除**正好相反**
  （`2b0eda3` 改成无条件覆盖后没同步文档）
- A 节写「Quotes.tsx / Orders.tsx 的组件被详情页 import 复用，别删文件」——
  现在只剩 `Orders.tsx` 还被复用
- D 节的打印页版式描述停留在旧的 `doc-*` 灰底带体系，`6a1dfb0` 已改成斑兔版式

### F. 死代码 / 死依赖

- `Quotes.tsx` 1409 行无引用（**等 C 决策完再动**）
- `html2pdf.js` 还在 `package.json`，源码里只剩一行注释提到它
- `printI18n.ts` 的 `print` 词条在两个打印页去掉打印按钮后已无人使用

### G. 前端单 chunk 3.1 MB

`vite.config.ts` 没有 `manualChunks`，产物单文件 3,136 kB（gzip 983 kB），
每次 build 都报 chunk 超限。打印页的 jspdf + html2canvas、货架页、后台页全打在一个包里。
打印页/货架页按路由 `React.lazy` 拆分 + jspdf/html2canvas 改动态 `import()` 就能拆掉一大块。
