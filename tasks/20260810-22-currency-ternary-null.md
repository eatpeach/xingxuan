# 三元真分支取裸值导致 `currency` 落 NULL —— 两处，撞 NOT NULL 约束 500

| 项目 | 内容 |
|---|---|
| **状态** | 🚧 代码完成 + ✅ 本地预检过（两处 + 对照），仅差生产验收 |
| **负责人** | 开发人员A（他在 02 预检时撞出来的） |
| **指派人** | CTO |
| **创建时间** | 2026-08-10 |
| **时限** | 2026-08-13 前 |
| **完成时间** | — |
| **风险等级** | 🟡 中（潜伏 bug，当前 UI 路径触发不到，但接口对任何调用方开放） |

---

## 问题

```php
'currency' => in_array($input['currency'] ?? 'IDR', ['IDR','CNY','USD'], true) ? $input['currency'] : 'IDR',
```

**条件里用了 `?? 'IDR'` 兜底，真分支却取裸 `$input['currency']`。**

请求不带 `currency` 时：

| 步骤 | 结果 |
|---|---|
| 条件求值 | `$input['currency'] ?? 'IDR'` → `'IDR'` → `in_array` **为真** |
| 走真分支 | `$input['currency']` → **未定义键 → NULL** |
| 落库 | `products.currency` 是 `NOT NULL`（`database.php:732`）→ **约束冲突 → 500** |

CTO 已用真 PHP 复现求值过程确认。

## 🔴 两处，不是一处

A 报了一处，CTO 全量搜同类模式又找到一处：

| # | 位置 | 判定 |
|---|---|---|
| 1 | `backend/api/handlers/product_admin.php:78` | 🐛 **是 bug**（A 发现） |
| 2 | `backend/api/handlers/vendor.php`（同样的 `currency` 写法） | 🐛 **是 bug**（CTO 发现，**A 漏了这处**） |
| 3 | `product_admin.php` 的 `status`（`?? ''`） | ✅ **不是 bug** —— `''` 不在白名单里，条件为假，落到 `: null` 正是本意。**别顺手"修"它** |

**第 2 处更值得注意**：那是**供应商门户自己存商品**的路径。供应商是外部账号，
调用方行为不受我们控制，**比后台路径更可能不带这个字段**。

## 不是本轮改动引入的

`git log -L` 追到来源是 `1e31704`（货架 / 商品库那批特性），**与 02 / 05 / 08 无关**。
前端表单 `Products.tsx:453,532` 的 currency 有默认值，UI 总会带上，**所以是潜伏 bug**——
只有不带 `currency` 的调用方才触发。

## 改法

两处都一样，真分支补上同样的兜底：

```php
? ($input['currency'] ?? 'IDR')
```

**只改这两处。第 3 处的 `status` 不要动。**

## 交付清单

- [x] **1. 两处都改**（`product_admin.php:78` + `vendor.php:126`）
- [x] **2. 再全量搜一遍同类模式**，确认没有第三处（四种形状全搜，结论见下）
- [x] **3. `php -l` 两个文件** → 均无语法错误
- [x] **4. 本地预检**：独立 scratchpad + `makeToken()` + 真 HTTP，两条路径不带 currency 都不再 500、落 IDR
- [ ] **5. 生产验收**（需真人开门；本地已过）

## 🔴 红线

- **只修这一个 bug**，不顺手重构那两个 handler
- **`status` 那处不要动**——它现在的行为是对的
- 本地预检**用独立 scratchpad 实例**，别碰共用工作区的库（B 已明确你那套隔离法更干净，照做）
- 改完 commit + push，**不要自己去服务器 `git pull`**

## 遇到这些情况，停下来找 CTO

- 第 2 步搜出第三处、第四处，且改动面明显变大
- 发现某处的"裸取"其实是有意的（比如靠 NULL 区分「没传」和「传了空」）

## 结论

改 **两个文件各一行**，`php -l` 均过，本地实跑确认修复。

### 1. 两处改法（完全一致）

`product_admin.php:78` 和 `vendor.php:126`，真分支从裸取补成同样的兜底：

```php
- ? $input['currency'] : 'IDR'
+ ? ($input['currency'] ?? 'IDR') : 'IDR'
```

### 2. 第 2 步：四种形状全搜，确认只有这两处是 bug

| 形状 | 命中 | 判定 |
|---|---|---|
| `in_array($input[x] ?? d, ...) ? $input[x] : d` | `product_admin.php:78`、`vendor.php:126` | 🐛 **本单两处** |
| 同上形状 | `product_admin.php:87`（`status`，`?? ''`） | ✅ **不是 bug**：`''` 不在白名单 → 条件假 → 落 `: null`，正是本意（CTO 已判，未动） |
| `in_array($input[x], ...)`（条件里**不**带 `??`） | `order.php:956`（`currency`） | ⚠ **另一类，非本单**：缺字段时是在**条件里**读未定义键，只报 warning，结果仍落 `'IDR'`，**不 NULL、不 500**。见下方备注 |
| `isset($input[x]) ? $input[x] : d` | `order.php`/`inquiry.php`/`customer_quote.php` 等多处 tax_* | ✅ **安全**：`isset` 为真时键必定义，裸取合法 |
| `!empty($input[x]) ? $input[x] : d` | 无命中 | — |

**结论：全仓只有 78 / 126 两处符合「条件兜底但真分支裸取同键 → 落 NULL」这个 bug 模式。** 没有第三处。

> ⚠ **`order.php:956`（另一类，已按 CTO 裁决处理）**：
> `$currency = in_array($input['currency'], ['IDR','CNY'], true) ? $input['currency'] : 'IDR';`
> 条件里**没有 `?? `**，缺 `currency` 字段时在 `in_array` 处读一次未定义键——
> 只产生 `Undefined array key` **warning**，结果仍落 `'IDR'`，**不 NULL、不 500**，和本单 bug 不同性质。
> 我最初按红线没动，报给 CTO。
>
> **CTO 裁决：补上（`1e6bba1` 之后的追加提交）。** 理由不是修 bug，是**日志卫生**——
> `order.php` 是高频路径，一条稳定复现的 warning 会持续往生产 `error.log` 灌噪音，
> **噪音的真实代价是将来真错误被淹掉**。
> **改法（只改条件，不改真分支）**：`in_array($input['currency'] ?? '', ...)`。
> 补 `?? ''` 后 `''` 不在白名单 → 条件为假 → 直接落 `'IDR'`，**真分支根本走不到，所以真分支保持裸取即可，改两处反而多余**。
> 干净测试确认：缺字段 → `IDR` 且**无 warning**；带 `CNY` → `CNY`。

### 3. `php -l`

`product_admin.php`、`vendor.php` 均 `No syntax errors detected`。

### 4. ✅ 本地预检（独立 scratchpad + 真 HTTP）

用改后代码全新构建隔离实例（`php -S :8013`），admin token 与 vendor token 均用 `makeToken()` 铸：

| 用例 | 修复前 | 修复后（实测） |
|---|---|---|
| `adminSaveProduct` **不带 currency** | 500（NULL 撞 NOT NULL） | ✅ HTTP 200，落库 `currency='IDR'` |
| `vendorSaveProduct` **不带 currency**（供应商门户路径） | 同样会 500 | ✅ HTTP 200，落库 `currency='IDR'` |
| `adminSaveProduct` 带 `currency=CNY` | — | ✅ 落库 `'CNY'`（尊重传入值） |
| `adminSaveProduct` 带非法 `currency=XXX` | — | ✅ 落库 `'IDR'`（正确回落） |

vendor 路径需 `portal_enabled=1` 的供应商 + `role=vendor` 的 token，均在隔离库内造。

### 🔴 本地已验证 ≠ 生产验收

本地 PHP 8.5 上跑通。生产 checkbox 保持不勾（8.2 vs 8.5、FPM）。这两条路径 UI 总带 currency，
生产上要真触发得由不带该字段的调用方（或 vendor 门户异常提交），生产验收需真人开门。
