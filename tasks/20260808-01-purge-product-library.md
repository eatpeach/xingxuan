# 清空商品库（products 全表）

| 项目 | 内容 |
|---|---|
| **状态** | 📋 待开始 |
| **负责人** | 雷云翔（在宝塔终端自行执行） |
| **指派人** | CTO |
| **创建时间** | 2026-08-08 |
| **完成时间** | — |
| **风险等级** | 🔴 高（生产数据删除，不可逆） |

---

## 背景

生产货架 `www.xingxuan.cc` 上有 **25 条商品，全部是 IKAD 瓷砖，且全部是错的**：

| 问题 | 实际情况 |
|---|---|
| 拆分维度错 | 25 条全按**尺寸代号**拆分（SZ/DZ/DX/DT/GE/SX/LS/ZS/XD/XS），同一花色被拆成十几条 |
| 应该的样子 | 提交 `4a4694e` 的目标是按**花色设计**合并成 7 个产品（MARBLE / MINIMALIST / MOZAIC / RETRO / STONE / STONE NATURO / WOOD），该合并**在生产上没生效** |
| 价格全 0 | 25 条 `sell_price` 全为 0，货架在对外展示一批无价商品 |
| 品类空转 | 品类树建了 5 大类、几十个子类，只有「瓷砖」有货，其余 count 全 0 |

### 根因

`scripts/data-fixes/import_ikad_products.php` 的第 3 步「清理旧版按尺寸拆分导入的商品」，
条件是 `base_price = 0 AND status = 'pending'`。
但这批旧商品当时**已经被置为 `status = 'on'`（上架）** —— 清理条件没命中，
旧数据留了下来，合并版也就没能顶上去。

## 决策（CTO，2026-08-08）

**整库清空 `products`，不做局部修补，后续重新导入。**

理由：现有 25 条无一可用（拆分维度错 + 价格全 0），逐条修的成本高于重导；
且商品库目前无任何业务数据依赖（见下），清空代价极低。

## 影响面

**会清空：**
- `products` 全表（含演示数据、供应商门户自报的商品）
- `product_price_logs` 全表
- 电子货架首页 / 分类页 / 详情页 → 0 商品

**不受影响：**
- 询价 / 商机 / 报价 / 订单 / 客户 / 供应商档案
  —— 全库只有 `product_price_logs` 外键引用 `products`，其余业务表不存商品 id（已 grep 验证）
- `categories` 品类树保留；其商品数是实时 `COUNT` 出来的，清空后自动归 0

**会留下（本次不处理）：**
- 演示供应商（`is_demo = 1`）变成空档案 → 需要的话在后台「商品库管理」点『一键清除演示数据』
- `backend/storage/products/` 下的图片文件 → 需要的话执行时加 `--purge-images`

## 执行步骤

脚本：`scripts/data-fixes/purge_all_products.php`（默认 dry-run，`--apply` 才真删，apply 前自动备份）

- [ ] 1. 服务器拉最新代码
      ```bash
      cd /www/wwwroot/www.xingxuan.cc && git pull
      ```
- [ ] 2. **先跑 dry-run 预览**，确认盘点数字符合预期（应显示 25 条上架商品、供应商 IKAD瓷砖）
      ```bash
      php scripts/data-fixes/purge_all_products.php
      ```
- [ ] 3. 确认无误后执行（脚本会自动 `VACUUM INTO` 出一致性快照备份，并打印备份路径）
      ```bash
      php scripts/data-fixes/purge_all_products.php --apply
      # 想连图片一起删：加 --purge-images
      ```
- [ ] 4. 记下脚本打印的备份文件路径，确认备份文件真实存在且非 0 字节
- [ ] 5. 打开 `https://www.xingxuan.cc` 确认货架首页为 0 商品，且页面不报错

## 验收标准

- [ ] `SELECT COUNT(*) FROM products` = 0
- [ ] `SELECT COUNT(*) FROM product_price_logs` = 0
- [ ] 货架首页 / 分类页正常渲染（空态，不是 500）
- [ ] 后台商机 / 报价 / 订单 / 客户列表**功能不受影响**（抽查一条商机详情能正常打开）
- [ ] 备份文件存在于 `backend/data/xingxuan.db.bak-<时间戳>`

## 回滚方案

脚本执行前会自动生成备份。需要回滚时：

```bash
cd /www/wwwroot/www.xingxuan.cc/backend/data
systemctl stop nginx
cp xingxuan.db.bak-<时间戳> xingxuan.db
rm -f xingxuan.db-wal xingxuan.db-shm     # 清掉 WAL 残留，否则会盖回旧数据
chown www:www xingxuan.db && chmod 664 xingxuan.db
systemctl start nginx
```

## 后续待办（已开单，不在本单范围）

- [x] ~~修 `import_ikad_products.php` 的清理条件~~ → **已开单** [20260808-03](20260808-03-fix-import-cleanup.md)
      （代码核查确认：只坏在 `status='pending'` 一处，`name` 匹配和 `base_price=0` 都是对的）
- [x] ~~给商品加「上架前必须有价格」的校验~~ → **已开单** [20260808-02](20260808-02-price-gate-before-onshelf.md)
      ⚠ **原描述低估了**：上架有**三条入口**（`adminReviewProduct` / `adminSaveProduct` / 供应商门户），
      **一条都没有价格校验**；对外货架 `shelf.php` 也不过滤 0 价商品。已提为 P0
- [ ] **重新导入 IKAD 商品**（按花色合并成 7 个产品）→ **暂缓，未开单**
      开单条件：① 业务方给出价格 ② 02 号单的上架闸门已上线。两个都满足才开

## 结论

_（执行完填写：实际删除条数、备份路径、验收结果）_
