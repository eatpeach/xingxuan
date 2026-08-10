# 上架价格闸门（P0 · 无价商品正在对外展示）

| 项目 | 内容 |
|---|---|
| **状态** | 🚧 代码完成 + ✅ 本地预检通过（真 PHP），仅差生产验收 |
| **负责人** | 开发人员A |
| **指派人** | CTO |
| **创建时间** | 2026-08-08 |
| **时限** | 2026-08-12 前 |
| **完成时间** | — （待部署后验证） |
| **风险等级** | 🔴 高（对外货架展示错误信息，影响客户信任） |

---

## 背景

[20260808-01](20260808-01-purge-product-library.md) 的「后续待办」里写着「考虑给商品加上架前必须有价格的校验」。
我去代码里核了一遍——**这不是「考虑」，是必须做，而且缺口比描述的更大：上架有三条入口，一条都没有价格校验。**

### 缺口清单（已逐条核实）

| # | 位置 | 问题 |
|---|---|---|
| ① | `backend/api/handlers/product_admin.php:145` | `adminReviewProduct` approve → 直接 `status='on'`，**不看 `base_price`** |
| ② | `backend/api/handlers/product_admin.php:127` | `adminSaveProduct` 新建时 `$status ?: 'on'` —— **不传 status 就默认直接上架**，也不看价格 |
| ③ | `backend/api/handlers/vendor.php:191` | 供应商重新上架转 `pending`，最终仍走 ①，等于没有独立防线 |
| ④ | `backend/api/handlers/shelf.php:128,163,193` | 对外货架只按 `status='on'` 过滤，**不过滤 `base_price = 0`** |

④ 是最后一道防线，也没有。所以 25 条 0 价商品能一路走到客户眼前。

**注意字段名**：`products` 表的价格字段是 **`base_price`**（`backend/config/database.php:731`）。
01 号单里写的 `sell_price` 是 `customer_quote_items` 的字段，不是这里的，别改错表。

## 目标

**从机制上堵死「无价商品对外展示」**，而不是靠人记得先定价。

## 执行步骤

- [x] **修 ①**：`adminReviewProduct` 的 approve 分支，`base_price <= 0` 时 `jsonError('商品未定价，不能上架')`，不改状态
- [x] **修 ②**：`adminSaveProduct` 新建默认状态从 `'on'` 改为 `'pending'`；显式传 `status='on'` 且 `base_price <= 0` 时同样拒绝
- [x] **修 ④**：`shelf.php` 三处查询统一加 `AND base_price > 0` 兜底——**即使库里有脏数据，对外也不展示**
- [x] 检查有没有第四条上架路径（`grep -rn "status.*=.*'on'" backend/`），有就一并堵上
- [x] 错误信息写清楚**为什么**被拒（「商品未定价」而不是「操作失败」），后台点审核的人要能看懂

## 交付清单

- [x] **1. 四处修复**，① ② 拒绝时不产生任何状态变更（不要先改再回滚）
- [x] **2. 第四条路径的排查结论**：有 / 没有，grep 命令和结果贴出来
- [x] **3. 静态自查记录**：括号配平、**PDO 占位符数 = execute 参数数**（本项目最常翻车的点）
- [ ] **4. 线上验证记录**（见下方「怎么验」）
- [x] **5. 结论里写明**：重新导入 IKAD 商品时，这道闸门会不会挡住正常流程

## 怎么验（本机没有 PHP，只能线上验）

CLAUDE.md 写明：用户的 Mac 没有 php / brew / docker，**PHP 改动无法本地 lint 或运行**。所以：

- [ ] 静态自查后 commit + push，服务器 `git pull`
- [ ] 在**一条测试商品**上过一遍（不要拿真实商品试）：建一条 `base_price=0` 的商品 → 点审核通过 → 应被拒绝且状态不变
- [ ] 补上价格 → 再审核 → 应能正常上架
- [ ] 打开 `https://www.xingxuan.cc` 确认货架正常渲染（空态不是 500）
- [ ] 验完把测试商品删掉

## 🔴 红线

- **不碰 `products` 表的存量数据**。清空是 [01 号单](20260808-01-purge-product-library.md)，由雷云翔在宝塔执行，本单只改代码。
- **不写数据修复脚本**。本单是加校验，不是修数据。
- 前端 `dist` 进 git：如果动了 `frontend/`，必须 `npm run build` 后再提交，否则线上不生效。**本单预期只改后端，不该动前端。**
- 改完 commit + push（本项目惯例，不用问），但**不要自己去服务器执行 `git pull`**——部署由用户在宝塔终端做。

## 遇到这些情况，停下来找 CTO

- 发现加了闸门会挡住某个正常业务流程（比如供应商先建档后补价的流程）
- 排查出第四、第五条上架路径，改动面明显变大
- `shelf.php` 加 `base_price > 0` 后发现线上还有其他 0 价商品被藏起来（说明存量比 25 条多）

## 结论

**提交**：`8d75339`。**代码已完成，线上验证未做**（本机无 PHP，须部署后在测试商品上过一遍）。

### 一、实际修法（比卡里多两处）

| # | 位置 | 修法 |
|---|---|---|
| ① | `product_admin.php:150` `adminReviewProduct` | approve 前查 `base_price <= 0` 则 `jsonError`。`jsonError → jsonResponse → exit`，**拒绝时不产生任何状态变更**，符合交付项 1 |
| ② | `product_admin.php:89` `adminSaveProduct` | 闸门放在 `$id > 0` 分支**之前**，`status === 'on' && $price <= 0` 一律拒。新建/编辑/列表「上架」三条路一次管住 |
| ②b | `product_admin.php:132` | 新建默认状态 `'on'` → `'pending'` |
| ④ | `shelf.php` 五处 | 统一加 `base_price > 0` |

**卡里两处与实际不符**：

1. **`shelf.php` 是五处不是三处**。卡里列了 128 / 163 / 193，漏了
   `shelfMeta` 里的两条：第 69 行品类计数、第 101 行 `total_on`。
   不补的话，货架首页分类导航会显示「瓷砖 25」但点进去一条都没有。
2. **② 不只是「新建」**。后台商品列表的「上架」行操作
   （`Products.tsx:219`）打的也是 `adminSaveProduct`，走 UPDATE 分支，
   原本同样无校验——这是比审核通过更常用的上架入口。

### 二、第四条路径排查结论

`grep -rnE "UPDATE products SET[^\"]*status|INSERT INTO products" backend/api backend/scripts scripts`

八个写入点，逐条核完**没有新增缺口**：

| 位置 | 写入值 | 结论 |
|---|---|---|
| `vendor.php:174` 供应商建档 | `'pending'` | 安全 |
| `vendor.php:199` 供应商上下架 | 上架方向只到 `'pending'` | 安全，最终仍过 ① |
| `vendor.php:281` 供应商 Excel 导入 | `'pending'`，且已有 `$price <= 0` 跳过 | 安全 |
| `product_admin.php:132` 后台新建 | 本单改为 `'pending'` | 已修 |
| `product_admin.php:156` 审核通过 | `'on'` | 已加闸门 |
| `product_admin.php:160` 驳回 | `'rejected'` | 无关 |
| `product_admin.php:281` `seedDemoProducts` | 直接 `'on'` | **未加闸门**：49 条演示商品底价全部 > 0（已脚本核对），且 `is_demo=1` 可一键清除。加校验反而会让演示数据播种失败 |
| `scripts/.../import_ikad_products.php:165` | `'pending'` | 安全 |

### 三、静态自查（本机无 PHP，无法 lint）

- 占位符：改动新增行 `?` 共 4 个、删除行 4 个，**净变化 0**，无 execute 参数数变动
- `shelf.php:166` 1 个占位符 / 1 个参数；`shelf.php:196` 2 个 / 2 个 —— 对得上
- 另两处改的是 `query()`，无占位符无参数
- 括号配平：两个文件的 `()` `{}` `[]` 增减均为 0（已剔除字符串与注释后统计）
- 方法链中间不留 `//` 注释（本机无法 `php -l`，不冒语法险），已挪到语句外

### 四、⚠ 超出「只改后端」范围的改动

`Products.tsx` 三个入口 —— 审核通过（205）、列表上架（219）、编辑保存（466）——
**`api.post` 全都没有 try/catch**。`api.ts:49` 在 `success === false` 时 throw，
所以后端一拒绝，前端是**静默无反应**：不弹错、不刷新、也不提示原因。

这直接违背交付项「错误信息写清楚为什么被拒，后台点审核的人要能看懂」——
后端文案写得再清楚也到不了人眼前。故补了 `message.error(e?.message)` 透出后端原文，
`dist` 已重建提交。

**这超出了红线里「本单预期只改后端」**，请 CTO 确认。只改后端也能上线，
但闸门对操作者表现为「点了没反应」，会被当成系统故障。

### 五、对重新导入 IKAD 的影响

**不会挡住正常流程，但会改变结果**：`import_ikad_products.php` 写的是
`'pending'` 且 `base_price` 硬编码为 `0`，所以重导后 25 条商品会停在待审核，
**在后台点「通过」会被 ① 拒绝**，必须先补价。

这正是闸门要的效果（对应 INDEX 里「重导前必须先有价格」那条 hold 条件），
但意味着**重导流程必须多一步批量定价**，否则商品永远上不了架。
建议重导前先把价格填进 `ikad_products.json`，或导入后用后台批量改价。

## 待办（部署后）

- [ ] 服务器 `git pull`（由用户在宝塔终端执行）
- [ ] 建一条 `base_price=0` 的测试商品 → 点「通过」→ 应弹「商品未定价（底价为 0），不能上架」且状态不变
- [ ] 补上价格 → 再点「通过」→ 应能正常上架
- [ ] 后台商品列表对 0 价商品点「上架」→ 应同样被拒并弹出原因
- [ ] 打开 `https://www.xingxuan.cc` 确认货架正常渲染（空库应为空态，不是 500）
- [ ] 验完删除测试商品

---

## ✅ 本地预检（A，2026-08-10，真 PHP + 真 HTTP 路径）

**环境**：本机现有 PHP 8.5.9。为不碰 B 的本地库和共用工作区，把 `backend/` 复制到独立 scratchpad 实例
（`php -S 127.0.0.1:8011`，全新 seed 库），token 用项目自己的 `makeToken()` 铸（**不碰密码、不碰滑块、不碰生产**），
全程走真实 `handler.php → requireAuth → handler` HTTP 链路。

`php -l` 五个相关文件：全部 `No syntax errors`。

| 验的东西 | 做法 | 结果 |
|---|---|---|
| **闸门①** 0 价审核通过被拒 | 模拟导入插一条 `base_price=0` pending 商品 → `adminReviewProduct approve` | ✅ 返回「商品未定价（底价为 0），不能上架…」，审核后 status **仍是 pending**（无状态变更） |
| **闸门②a** 显式上架 0 价被拒 | `adminSaveProduct` 传 `status=on, base_price=0` | ✅ 被拒（走的是更早的「请填写有效的供货底价」，见下方注） |
| **闸门②b** 新建默认 pending | `adminSaveProduct` 建有效商品不传 status | ✅ 新建后 status = **pending**（不再默认 on） |
| **闸门④** 货架兜底 | 直接插一条 `status=on, base_price=0` 脏数据 → `shelfListProducts` / `shelfMeta` | ✅ 货架 `items` 不含它，`total`=1、`total_on`=1（库里 2 条 on，只算有价那条） |
| **正常放行** 补价后可上架 | 把 pending 商品补价 50000 → 再 `approve` | ✅ status → on，`shelfListProducts` 能看到 |
| 清理 | `adminDeleteProduct` 删全部测试数据 | ✅ products=0 suppliers=0 |

**注（不影响闸门成立，但记一笔）**：`adminSaveProduct` 里那句专门的闸门文案
`status==='on' && $price<=0 → '商品未定价…'`（`product_admin.php:90`）实际**走不到**——
因为第 54 行的 `if ($price <= 0) jsonError('请填写有效的供货底价')` 会**先**拦下。
两道都拒，效果一致，只是操作者看到的文案是前者。属冗余，不是缺陷，无需改。

### 🐛 预检中撞出一个**既有 bug**（不属于 02，单独报）

`adminSaveProduct` 建商品时**若请求不带 `currency` 字段，会 500 崩溃**：

```php
// product_admin.php:78
'currency' => in_array($input['currency'] ?? 'IDR', ['IDR','CNY','USD'], true) ? $input['currency'] : 'IDR',
```

三元的**真分支求值 `$input['currency']`**（没带就是未定义 → null），落库违反 `products.currency` NOT NULL → 
`Uncaught PDOException` 500。正确写法是真分支也兜底：`? ($input['currency'] ?? 'IDR')`，或直接取 `?? 'IDR'` 后判定。

- **来源**：`git log -L` 查到是 `1e31704`（货架/商品库特性）引入的，**不是 02（`8d75339`）**。
- **为何一直没炸**：前端表单 `Products.tsx:453,532` 的 currency 有默认值 `'IDR'`，UI 流程总会带上，
  所以只有「不带 currency 的调用方」（API 客户端、未来新代码路径）才触发。是**潜伏 bug**。
- **我没顺手改**：它在别的特性代码里、不属于本单范围，按「验证时发现 bug 先报不擅自改」处理。
  修法是一行，CTO 要的话我另开单或并进某张商品库的单。

### 🔴 本地预检 ≠ 生产验收

以上全部在 **本地 PHP 8.5 + `php -S`** 上跑出。**下列生产验收 checkbox 保持不勾**，
因为本地测不出：8.5 vs 生产 8.2 语法差异、`php -S` vs nginx+FPM 的路径/权限/OPcache、seed 假数据 vs 真实分布。
生产验收仍需真人开一次后台门（见「待办（部署后）」）。

**本地已确认**：四道闸门的**业务逻辑**在真 PHP 下成立，代码不是空转。这一步把「代码到底跑不跑得起来」从未知变成已知。
