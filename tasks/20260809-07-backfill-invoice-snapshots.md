# 补历史 21 张发票的主体快照 —— 它们现在是「活的」，不是快照

| 项目 | 内容 |
|---|---|
| **状态** | 🚧 第 1 步已完成（CTO 08-09 14:16 跑完脚本并裁决：放行精确回填）→ B 继续第 2 步写回填脚本 |
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
- [ ] **2. 写回填脚本** `scripts/data-fixes/backfill_invoice_snapshots.php`
      - 默认 **dry-run**，`--apply` 才写
      - `--apply` 前**自动 `VACUUM INTO` 备份**（照 `purge_all_products.php` 的做法）
      - **只填空列**，非空列一律不动（`COALESCE`/`WHERE col = ''` 之类）
      - 事务内执行，失败整体回滚
      - 打印每张发票补了哪几列
- [ ] **3. dry-run 输出发 CTO 确认**，确认后才 `--apply`
- [ ] **4. 回填后复跑一次 06 的只读盘点**，确认「快照完整」从 0 变成 21

## 交付清单

- [ ] **1. `op_logs` 排查结论**：设置项改没改过、改过哪些、什么时候
- [ ] **2. 回填脚本**（dry-run 默认 + 自动备份 + 只填空列 + 事务）
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
