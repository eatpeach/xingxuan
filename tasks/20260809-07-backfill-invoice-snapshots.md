# 补历史 21 张发票的主体快照 —— 它们现在是「活的」，不是快照

| 项目 | 内容 |
|---|---|
| **状态** | ⏸ 第 2 步脚本已推送（`5dbf219`，`git log` 可查）→ **卡在需服务器跑 dry-run**（本机无 PHP、db 不在仓库） |
| **负责人** | 开发人员B（06 号单的盘点是他做的，上下文在他手上） |
| **指派人** | CTO |
| **创建时间** | 2026-08-09 |
| **时限** | 2026-08-12 前 |
| **完成时间** | — |
| **风险等级** | 🔴 高（**生产数据写操作**，对象是对外正式单据） |

---

## 背景：盘点数字

[06 号单](20260808-06-invoice-entity-snapshot.md)的只读盘点于 2026-08-09 13:41 在生产库执行，结果：

```
已开发票总数                  ：21
  invoice_entity_id IS NULL   ：21（100%）
  invoice_bank_account_no = ''：15
  快照完整                    ：0
```

时间跨度 2026-05-08 ~ 2026-08-04，客户包括李总、杨斌斌（陕西商会）、赵城康、黄伟、张军、姜总等。

## 问题的实质：不是「空」，是「活的」

`frontend/src/pages/InvoicePrint.tsx:80` 的回落链：

```tsx
const entityName = data.invoice_entity_name || settings.company_name || '星选建材'
// 银行同理：data.invoice_bank_* || settings.bank_*
```

所以这 21 张**印出来有内容**——内容取自**当前** `system_settings`。

**风险不在今天，在明天**：一旦改了 `company_name` 或 `bank_*`（而系统里已经配了 2 个收款主体、2 个账户，
说明多主体是真实需求，改动迟早发生），**这 21 张历史发票重新打印就全变了**。
客户手上那份和系统里重打的那份对不上账——发票是对外正式单据，**不可变是底线**。

## 🔴 先做这一步，再决定怎么补

**必须先查清楚：`company_name` / `bank_*` 这些设置项，从 2026-05-08 至今有没有改过。**

- [ ] 查 `op_logs` 里针对 `system_settings` 的修改记录，重点看 `company_name`、`bank_name`、
      `bank_account_no`、`bank_account_name`、`bank_swift`
      → **脚本已写好**：`scripts/data-fixes/audit_settings_change_history.php`（只读，`PRAGMA query_only=ON`）。
      ⏸ **卡住**：本机无 PHP、`data/*.db` 被 gitignore 不在仓库里，跑不了。**请在服务器上执行**：
      `cd /www/wwwroot/www.xingxuan.cc && php scripts/data-fixes/audit_settings_change_history.php`
- [x] **只读**，出结论给 CTO —— 代码层面的结论已出（见下「结论」），**数据层面待脚本输出**

**两种结论对应两种补法：**

| 查出来 | 怎么补 |
|---|---|
| **从没改过** | 当前设置值 = 当时的值，**直接回填，精确无损** |
| **改过** | 当前值 ≠ 部分发票当时的值。**停下来找 CTO**——要按 `op_logs` 的时间线分段回填，还是接受"冻结现值"并标注哪些不确定，我来定，你不要自己选 |

---

# ✅ CTO 裁决（2026-08-09 14:16，脚本已在生产库跑完）

## 一、排查结论：**对这 21 张而言，等价于「从没改过」。放行，精确回填。**

脚本第 3 节，8 个回落设置项里 **7 项「无变更记录」**，唯一变过的是 `pdf_logo_path`：

```
pdf_logo_path  🔴 2 次变更：
    2026-05-08 22:38:12  →  brand/logo.png
    2026-05-08 22:58:45  →  /brand/logo.png
```

**两次都在 2026-05-08，而最早的一张发票开于 2026-05-12 11:32:40 —— 晚了将近 4 天。**
也就是说：第一张发票开出来的时候，`pdf_logo_path` 已经是现在这个值了，此后再没动过。

脚本第 4 节的 `updated_at` 独立佐证同一结论：

| key | updated_at | vs 最早开票（05-12 11:32:40） |
|---|---|---|
| `company_name` | 2026-05-08 15:32:32 | 早 4 天 |
| `pdf_logo_path` | 2026-05-08 22:58:45 | 早 4 天 |
| `bank_name` / `bank_account_no` / `bank_account_name` | 2026-05-12 11:32:15 | **早 25 秒** |

**两条独立证据链指向同一结论：全部 21 张发票，开票当时的回落值 = 现在的值。**
脚本第 1 节也证明了日志是活的（229 条、14 类 entity、setting 类 20 条），
所以「无变更记录」是真的没改过，不是日志没记。

→ **回填是精确的，不是冻结猜测值。可以做。**

## 二、`invoice_entity_tax_no`（NPWP）：**同意 B，剔除出回填范围**

B 的理由成立且关键：这一列**为空时印的不是空白，是公司标语**
（`InvoicePrint.tsx:203`），从那 2 个 `payment_entity` 取 NPWP 填进去会把「标语」变成「NPWP 号」，
**直接违反交付清单第 6 条「渲染前后必须一致」**，而且伪造了开票当时不存在的事实。

**不填。回填列清单里去掉它。**

## 三、🔴 CTO 补充发现：**空值根本冻结不了，别白做**

B 和 A 都没提这一点，我复核渲染逻辑时发现的。`InvoicePrint.tsx` 用的是 `||` 回落：

```tsx
data.invoice_entity_name || settings.company_name
```

**JS 里空字符串是 falsy。** 所以把 `''` 写进快照列，渲染时**照样会回落到 `settings`**——
写了等于没写。

当前值为空的三项：`company_address`、`company_phone`、`bank_swift`。
**这三项回填也冻不住**，将来一旦在设置里填上，历史发票就会开始显示它们。

### 裁决：**接受这个残留，不改渲染逻辑，记录在案**

- 高风险字段（`company_name`、`bank_name`、`bank_account_no`、`bank_account_name`）**都有值，能真正冻住**
- 剩下三项是地址 / 电话 / SWIFT，从「空白」变成「有值」的危害，远小于「银行账号变了」
- 把 `||` 改成 `??` 或引入哨兵值，会影响**所有发票的渲染路径**，风险大于收益

**B 执行时**：这三个空列写不写都行（写了也不生效），**在脚本输出里标注一下即可**，不要为它们额外加逻辑。

## 四、实际要回填的值（脚本第 4 节的当前值）

| 快照列 | 填什么 | 能否真正冻住 |
|---|---|---|
| `invoice_entity_name` | `星选建材` | ✅ |
| `invoice_entity_logo_path` | `/brand/logo.png` | ✅（但见第五条） |
| `invoice_bank_name` | `BCA` | ✅ |
| `invoice_bank_account_no` | `2880650567` | ✅ |
| `invoice_bank_account_name` | `zhangweiqi` | ✅ |
| `invoice_entity_address` | （空） | ❌ 冻不住，见第三条 |
| `invoice_entity_phone` | （空） | ❌ 同上 |
| `invoice_bank_swift` | （空） | ❌ 同上 |
| `invoice_entity_tax_no` | **不填** | — 见第二条 |

**已有非空值的列一律不覆盖**（15 张银行账号为空、6 张有值，只补那 15 张）。

## 五、已知残留（不阻塞本单，记录留痕）

1. **冻结路径 ≠ 冻结图像**（B 提的，成立）：`invoice_entity_logo_path` 存的是路径，
   同名换图照样让历史发票变样。本单挡不住这个，**接受**
2. **直接改库无法自证**（B 提的）：绕过 `setSetting()` 的直接 SQL 修改，
   `op_logs` 和 `updated_at` 都不留痕。这是理论盲区，无解，**接受**
3. **空值三项冻不住**，见第三条

## 六、下一步

**B 继续执行第 2 步起的回填脚本。** 按原单要求：默认 dry-run、`--apply` 前自动
`VACUUM INTO` 备份、只填空列、事务内执行。**dry-run 输出先发我，我点头才 `--apply`。**

## 回填口径（CTO 定，2026-08-09）

**把当前 `system_settings` 的值冻结进快照列，`invoice_entity_id` 保持 NULL。**

为什么不挂到那 2 个收款主体上：**这 21 张开票时根本没选过主体**，它们渲染的是 `system_settings` 的值，
不是任何一个 `payment_entity`。硬挂过去等于伪造一个当时不存在的事实。
保持 `invoice_entity_id = NULL` + 填好 `invoice_entity_name` 等文本列，
记录如实表达「当时没选主体，这是那个年代的设置值」，且渲染结果与今天**完全一致**——
只是从此不再漂。

要回填的列：`invoice_entity_name` / `invoice_entity_tax_no` / `invoice_entity_address` /
`invoice_entity_phone` / `invoice_entity_logo_path` / `invoice_bank_name` /
`invoice_bank_account_no` / `invoice_bank_account_name` / `invoice_bank_swift`
（**已有非空值的列不要覆盖**——有 6 张银行账号是有值的）

## 执行步骤

- [ ] **1. 先做上面的 `op_logs` 排查**，结论给 CTO 后再往下
- [x] **2. 写回填脚本** `scripts/data-fixes/backfill_invoice_snapshots.php` ✅ **已推送 `5dbf219`**
      - 默认 **dry-run**，`--apply` 才写
      - `--apply` 前**自动 `VACUUM INTO` 备份**（照 `purge_all_products.php` 的做法）
      - **只填空列**，非空列一律不动（`COALESCE`/`WHERE col = ''` 之类）
      - 事务内执行，失败整体回滚
      - 打印每张发票补了哪几列
- [ ] **3. dry-run 输出发 CTO 确认**，确认后才 `--apply`
- [ ] **4. 回填后复跑一次 06 的只读盘点**，确认「快照完整」从 0 变成 21

## 交付清单

- [ ] **1. `op_logs` 排查结论**：设置项改没改过、改过哪些、什么时候
- [x] **2. 回填脚本**（dry-run 默认 + 自动备份 + 只填空列 + 事务）✅ `5dbf219`
- [ ] **3. dry-run 输出**（21 张各补哪些列）
- [ ] **4. `--apply` 执行记录 + 备份文件路径**
- [ ] **5. 复跑盘点的对比数字**（补前 0 完整 → 补后应为 21）
- [ ] **6. 抽查一张历史发票打印页**，确认渲染内容与回填前一致（不能变样）

## 🔴 红线

- **改不改设置项之前先查 `op_logs`**。查不清就别回填，宁可空着也不要填错——填错等于伪造单据内容
- **已有非空值的列一律不覆盖**
- `--apply` 前必须有备份，且备份路径要打印出来
- **不动 `invoice_entity_id`**，保持 NULL
- 本单**只补历史数据**，不改任何业务代码（堵漏是 [08 号单](20260809-08-close-invoice-bypass.md)）

## 遇到这些情况，停下来找 CTO

- `op_logs` 显示设置项改过 —— **必停**，回填口径要重定
- `op_logs` 里根本没有设置变更的记录（可能是当初就没记日志）—— 那是"查不出"不是"没改过"，也要停
- 发现除 `system_settings` 外还有别的回落来源

## 结论

### 第 1 步（B，2026-08-09）：代码层面已查完，数据层面卡在服务器上

**没有回填任何数据。** 按红线要求，`op_logs` 没查清之前不动库。

#### 1. op_logs 查得到吗？——查得到，窗口全覆盖

| 记日志的代码 | 从哪个提交起有 | 覆盖 |
|---|---|---|
| `handle_updateSetting` 的 `opLog('setting', 'update', "key=值")` | `80179c5`（**2026-05-08**，PHP 迁移那一版） | ✅ 覆盖 05-08 至今全窗口 |
| `handle_uploadSettingImage` 的 `opLog('setting','upload_image')` | `3308827`（2026-07-26） | 07-26 起 |

**这一点很重要**：单子担心的「可能是当初就没记日志」**不成立**——设置变更从窗口第一天起就在记，
`detail` 还保留了每次改成的**新值**（`key=value`）。所以如果查出来一条都没有，
那是**真的没改过**，不是「查不出」。（前提是 `op_logs` 里同期有其它 entity 的记录来证明日志在工作，
脚本第 1 节专门验这个。）

**第二条独立证据**：`setSetting()` 每次写都刷新 `system_settings.updated_at`；
而 seed 建库用的是 `INSERT OR IGNORE`（`database.php:913`），没改过的项 `updated_at` 会停在建库那一刻。
两条证据互相印证，脚本第 4 节输出。

#### 2. 🔴 回填列清单里有一列**填不了**，请 CTO 改口径

单子第 68-70 行要回填 `invoice_entity_tax_no`（NPWP）。**这一列没有源，必须留空。**

- `SETTING_KEYS`（`setting.php:3-32`）里**根本没有 NPWP / 税号这一项**——`system_settings` 无值可取
- `InvoicePrint.tsx:203`：`data.invoice_entity_tax_no ? \`NPWP ${...}\` : L('companySlogan')`
  ——**空的时候印的不是空白，是公司标语**

所以若从那 2 个 `payment_entity` 里取 NPWP 填进去：① 伪造了开票当时不存在的事实；
② **会改变渲染结果**（标语 → NPWP 号），直接违反交付清单第 6 条「渲染内容与回填前一致」。
**建议：`invoice_entity_tax_no` 不在回填范围内。**

#### 3. 回落来源盘点（回答单子「有没有别的回落来源」）

数据源**只有 `system_settings` 一个**（`InvoicePrint.tsx:33` 的 `listSettings`），没有第二个表。
但回落链末端有**两处硬编码**：

| 快照列 | 回落 1 | 回落 2（硬编码） |
|---|---|---|
| `invoice_entity_name` | `settings.company_name` | `'星选建材'` |
| `invoice_entity_logo_path` | `settings.pdf_logo_path` | `/storage/brand/logo.png` |
| `invoice_entity_tax_no` | **无** | `L('companySlogan')` 标语 |
| `invoice_bank_branch` | **无** | 无（只跟 bank_name 拼接） |
| 其余 entity_* / bank_* | 对应的 `company_*` / `bank_*` | 无 |

→ 如果当前 `company_name` 或 `pdf_logo_path` 是空的，那 21 张现在印的就是这两个**硬编码值**。
要做到「渲染前后一致」，这种情况得把硬编码值写进快照，而不是写空。**得看脚本第 4 节的当前值才能定**。

#### 4. 另一个局限：冻结路径 ≠ 冻结图像

`invoice_entity_logo_path` 存的是**路径**。同名换图（本项目 banner 就是这么换的，
`seed_shelf_banners.php` 会覆盖同名文件）照样让历史发票变样。
回填只能挡住「改设置项」，挡不住「换图片文件」。

#### 5. 这次排查的盲区（一并报备）

1. 直接用 `sqlite3` / 宝塔数据库管理器改库 —— 绕过 `setSetting()`，`op_logs` 和 `updated_at` 都不会留痕，**库内无法自证**
2. 2026-05-08 之前是 Python/FastAPI 版，那一段没有 PHP 的 `op_logs`
3. 「录入历史订单」补录的发票，`invoice_issued_at` 是**回填的旧日期**，不是真实开票时刻，拿它对时间线会误判

### 下一步

**等 CTO 跑脚本，把输出贴回来我判读。** 按单子第 51-56 行：查出「从没改过」我才继续写回填脚本；
查出「改过」或第 1 节显示日志本身不可信，我停在这里等重定口径。

---

### 第 2 步（B，2026-08-09）：回填脚本已推送 `5dbf219`，**未在生产库执行任何写操作**

`scripts/data-fixes/backfill_invoice_snapshots.php`，308 行。**默认 dry-run**，
`--apply` 才写库。按裁决逐条落实：

| 裁决 | 脚本里怎么落的 |
|---|---|
| `invoice_entity_id` 保持 NULL | 根本不在回填列清单里，脚本显式打印「故意不动」并说明理由 |
| NPWP 不填 | 同上，连同 `invoice_account_id` / `invoice_bank_branch` 一起标注 |
| 已有非空值不覆盖 | **两道保险**：读取时跳过非空列 + SQL 层 `CASE WHEN IFNULL(col,'')=''`。<br>后者保证即便 SELECT 与 UPDATE 之间有人开了新发票也绝不覆盖 |
| 空值三项冻不住 | 源值为空的列**跳过不写**，并在输出里打印为什么（`\|\|` 回落 + JS falsy） |
| 备份 / 事务 / 逐张打印 | `VACUUM INTO` 打印路径与回滚办法；事务内执行失败整体回滚；逐张打印补了哪几列 |

**额外做的两件事**（不改口径，只加留痕与保险）：

1. **每张发票写一条 `op_logs`**（`action=backfill_invoice_snapshot`，detail 记补了哪几列）。
   直接 INSERT 不引入 `helpers.php`，避免 CLI 下的 session 依赖。
   理由：这是对外正式单据的批量写操作，库内要留得下痕迹
2. **不动 `updated_at`**。这是数据修复不是业务变更，改了会把「这张报价最后一次业务修改时间」
   这条信息覆盖掉，将来做同类取证会误判。留痕交给 `op_logs`

#### 🔴 一处要请 CTO 定的：**交付清单第 5 条的验收判据，按现在的裁决永远达不到**

单子第 5 条写「复跑盘点：补前 0 完整 → **补后应为 21**」。但
`audit_invoice_entity_snapshot.php:56-59` 里「快照完整」的判据是：

```sql
invoice_entity_id IS NOT NULL AND IFNULL(invoice_bank_account_no,'') <> ''
```

而**本单裁决明确要求 `invoice_entity_id` 保持 NULL**。两者直接冲突——
回填做得再对，那个数字也还是 **0**，而且 `invoice_entity_id IS NULL：21` 也一个不会少。

**这不是脚本没生效，是判据是按「挂主体」那种补法写的，跟最终裁决不是一套。**

真正会动的数字只有一个：`invoice_bank_account_no = ''` **从 15 → 0**。

我在脚本的复核段（第 3 节）已经把这三个数字连同这段解释一起打印出来，防止谁复跑盘点时
看到「快照完整 0」就以为回填失败、跑去二次执行。**但验收口径要不要改、改成什么，我不自己定，请 CTO 裁。**
建议改为：「`invoice_bank_account_no = ''` 由 15 → 0，且 `invoice_entity_id IS NULL` 仍为 21（按设计）」。

#### 本机静态自查（无 PHP，逐项列出查了什么）

- **括号 / 引号 / 注释配平** —— 写了个 PHP 词法感知的检查器过了一遍，通过
- **PDO 占位符数 = execute 参数数**（`CLAUDE.md` 点名的本项目最常翻车点）——
  从结构上消除：SET 子句与参数**在同一个循环里生成**，不可能错位；
  执行前另有 `substr_count($sql,'?') !== count($params)` 显式断言，不等就抛异常整体回滚
- **SQL 仿真** —— 本机没 PHP 但有 sqlite3。建了个同构的内存库（21 张发票：15 张银行账号空、
  6 张有值，外加 1 张未开票的报价），把脚本会生成的 SQL **原样跑了一遍**，11 项断言全过：
  6 张原有值未被覆盖 ／ 15 张空的已补 ／ 21 张抬头与 logo 写入 ／ `invoice_entity_id` 全部仍为 NULL ／
  NPWP 一列没动 ／ 冻不住的三列没写入 ／ 未开票的报价没被碰 ／ 重跑一遍无事可做（幂等）
- **回落值与页面对齐** —— 核对 `InvoicePrint.tsx:80-85`，回落链末端的硬编码是
  `'星选建材'` 和 `'/storage/brand/logo.png'`。设置项万一为空，脚本写的是这两个硬编码值
  （logo 存 `brand/logo.png`，页面会自己拼 `/storage/` 前缀），保证渲染前后一致。
  生产当前值非空，这条分支不会触发，但触发时会打印显眼提示
- **判空语义** —— 精确镜像 JS 的 falsy：**只有 `''` 才算空，不用 `trim()`**。
  `'   '` 在 JS 里是 truthy，页面会照印，当成空去回落就改变了渲染结果

未做验证：脚本没在任何真实 PHP 环境跑过。仿真验的是 SQL 与判定逻辑，**验不了 PHP 语法**。

#### ⏸ 卡在哪

**需要在服务器上跑 dry-run**，我跑不了——本机无 PHP，`backend/data/*.db` 被 gitignore 不在仓库里。
与第 1 步同一个卡点。

```bash
cd /www/wwwroot/www.xingxuan.cc && git pull
php scripts/data-fixes/backfill_invoice_snapshots.php          # dry-run，只读不写
```

**dry-run 完全只读**（`--apply` 之前脚本一行都不写库），可以放心跑。
输出贴回来我判读，确认无误、CTO 点头之后才执行 `--apply`。

**注意**：`git pull` 会同时带上 A 的 09 号单改动（`CLAUDE.md`）。本单只新增一个脚本文件，
不改任何业务代码，也没动 `frontend/dist`。

---

# ✅ CTO 裁决二（2026-08-09，回应 B 提的验收判据冲突）

## 一、你说得对，是我的裁决和验收判据打架了

`audit_invoice_entity_snapshot.php` 里「快照完整」的判据含 `invoice_entity_id IS NOT NULL`，
而本单裁决明确要求 **`entity_id` 保持 NULL**。两者不可能同时成立——
**回填做得再对，那个数字也永远是 0。**

这是我写交付清单第 5 条时没想清楚：那条判据是按「挂主体」那种补法写的，
跟我后来定的「冻结 `system_settings` 值、不挂主体」不是一套尺子。**你没有自己改尺子是对的。**

## 二、交付清单第 5 条改成这样

~~复跑盘点：补前 0 完整 → 补后应为 21~~ **作废**，改为：

| 指标 | 补前 | 补后应为 | 说明 |
|---|---|---|---|
| `invoice_bank_account_no = ''` | 15 | **0** | 真正会动的数字 |
| 「两者都空」 | 15 | **0** | 同上 |
| `invoice_entity_id IS NULL` | 21 | **仍为 21** | **按设计**，不是失败 |
| 「快照完整」 | 0 | **仍为 0** | **判据已过时**，见第三条 |

补充一条你没列但更关键的：**`invoice_entity_name = ''` 应由 21 → 0**。
这才是「冻结住了没有」的主指标——`entity_name` 有值，页面就不再回落到 `settings.company_name`。
盘点脚本目前不报这个数，**你在回填脚本的复核段里打出来**即可。

## 三、audit 脚本先不动，回填验完再单独改

你说「中途改尺子不合适」——同意。**本次前后对比必须用同一把尺子**，否则说不清是回填生效还是尺子变了。

**顺序定死：**
1. 现在 → dry-run → CTO 确认 → `--apply`
2. 用**原样的** audit 脚本复跑，按上面那张表核对
3. **确认无误之后**，再单独改 audit 脚本的「快照完整」判据
   （`invoice_entity_id IS NOT NULL` → `IFNULL(invoice_entity_name,'') <> ''`），
   作为一次独立的、有记录的变更

第 3 步不做也有代价：那个指标会永远显示「完整：0」，下一个人看到会以为回填失败、
跑去二次执行。**所以第 3 步必须做，只是排在验收之后。** 我会在本单结单时一并开出。

## 四、你额外做的两件事，都认可

1. **两道防覆盖**（读取时跳过 + SQL 层 `CASE WHEN IFNULL(col,'')=''`）——
   第二道让脚本幂等可重跑，且能抵御 SELECT 与 UPDATE 之间新开发票的竞态。这层我没要求，你自己加的，对
2. **写 `op_logs` 但不动 `updated_at`** —— 理由说得准：这是数据修复不是业务变更，
   改了会把「最后一次业务修改时间」覆盖掉，将来同类取证会误判。
   **而本单第 1 步的排查恰恰就是靠 `updated_at` 取证的**——你保住了下一次取证的能力

另外「**只有 `''` 才算空，不用 `trim()`**」这条判空精确镜像 JS falsy 的处理很到位：
`'   '` 在 JS 里是 truthy，页面会照印，当成空去回落就改变了渲染结果。这种细节容易想当然。

**SQL 仿真那 11 项断言**也是有效补偿——本机没 PHP 验不了语法，但至少 SQL 与判定逻辑是验过的。
仍要记住：**验不了 PHP 语法**，所以服务器上第一次跑 dry-run 时要盯着有没有 parse error。

---

# ✅ 回填已执行并验收通过（2026-08-10 01:28）

## 执行

老板在生产库跑了 `--apply`。**01:28 重跑时脚本报「所有已开发票的快照列都已有值，无需回填（幂等）」**
——说明首次 apply 已成功，B 做的两道防覆盖（读取时跳过 + SQL 层 `CASE WHEN IFNULL(col,'')=''`）
按设计生效，脚本可重复执行不会二次写入。

脚本第 1 节打印的取值与 CTO 08-09 14:16 在生产库核过的 `system_settings` **完全一致**：
`星选建材` / `/brand/logo.png` / `BCA` / `2880650567` / `zhangweiqi`。

裁决逐条落实：三个空列**跳过**并打印原因；`tax_no` / `entity_id` / `account_id` / `bank_branch`
四列标「故意不动」各附理由。**一条没走样。**

## 验收：四项指标全中

| 指标 | 补前 | CTO 预判 | 实际 |
|---|---|---|---|
| `invoice_bank_account_no = ''` | 15 | 0 | **0** ✅ |
| 「两者都空」 | 15 | 0 | **0** ✅ |
| `invoice_entity_id IS NULL` | 21 | 仍 21（按设计） | **21** ✅ |
| 「快照完整」 | 0 | 仍 0（判据过时） | **0** ✅ |

第 2 节明细也对上：**21 张现在全部只缺「主体」**，无一显示「主体+银行账号」。

---

# 📋 剩余三项

## 1. 🔴 改 audit 脚本的「快照完整」判据（B，现在可以动了）

CTO 08-09 裁决第三条说的「**回填验收之后再单独改**」，**现在到点了**。

当前输出会显示：

```
快照完整      ：0
空主体快照占比：100.0%
```

**这两个数字按现行裁决永远不会变**（判据含 `invoice_entity_id IS NOT NULL`，而裁决要求保持 NULL）。
不改的话，下一个人跑这个脚本会以为回填没生效，**跑去二次执行**。

**改法**：`audit_invoice_entity_snapshot.php` 里「快照完整」的判据
`invoice_entity_id IS NOT NULL` → `IFNULL(invoice_entity_name,'') <> ''`。

同时把「空主体快照占比」这个指标一起校准——它现在也是按 `entity_id` 算的。

🔴 **加一段说明**：为什么 `entity_id` 对这 21 张是 NULL（开票时没选过主体，
硬挂到 `payment_entity` 等于伪造事实），免得以后又有人当成缺陷去"修"。

**这是一次独立的、有记录的变更**，别和别的改动混在一起提交。

## 2. 备份文件确认（老板）

首次 `--apply` 的输出没留存，**备份路径未知**。请确认它存在且非 0 字节：

```bash
ls -lh /www/wwwroot/www.xingxuan.cc/backend/data/*.bak-*
```

## 3. 抽查一张历史发票打印页（需登录态）

交付清单第 6 条。挑一张（如 `INV20260804001` 李总那张）打开打印页，
**抬头和银行信息必须和回填前一模一样**。

这是本次回填的全部意义：目的是**冻住现在的样子**，不是改成别的样子。
**页面若变了，立刻用备份回滚。**
