# 26 · 亚铝（印尼亚铝订货商城）全量商品拉取 → 上架星选货架

| 项目 | 内容 |
|---|---|
| **状态** | 🚧 拉取 ✅ + 导入脚本 ✅（本地验证过）· 差生产执行 |
| **创建** | 2026-09-18 |
| **拉取完成** | 2026-09-22（老板登录态，认证价） |
| **风险** | 🟢 只读拉取第三方商城；导入只写 `pending` 商品，不动已有数据 |

## 目标

把供应商「亚铝」订货商城的全部商品批量拉下来，导入星选商品库（挂在亚铝这个供应商下，待审核上架）。

## 结果（2026-09-22）

- **8116 条商品，32 个一级分类，全部带认证价**（供货价）；其中 **121 条商城价为 0**（商城本身没标价）
- 数据文件 `yalv_products.json`（2.1MB，14 列定位数组）—— 🔴 **含供货价，不进仓库**。
  老板机器上在 `~/Downloads/yalv_products.json`；本机副本在 `backend/data/`（已 gitignore）
- 收集表格式 xlsx（25 列，可直接走门户「Excel 导入」）已生成并用后端解析器 `_vendorXlsxRows` 验过：7995 行全部识别，
  无缺名缺价；0 价的 121 条单独放在第二页「无供货价_不导入」

| 分类 | 条数 | 分类 | 条数 |
|---|---|---|---|
| BOSI波斯工具 | 4091 | Baut紧固件 | 1676 |
| 东成工具 | 1072 | Welding焊机及配件 | 281 |
| DELIXI德力西 | 196 | Lifting吊具 | 80 |
| Webbing Sling吊带 | 65 | SOMY水泵 | 63 |
| 其余 24 个分类 | 各 1~54 | | |

## 🔴 门户「Excel 导入」不适合这个量级 → 改用 CLI 脚本

`handle_vendorImportProductsExcel` 是一个 HTTP 请求里逐行插入 + 逐行 curl 下图：8000 行 × 一张图 ≈ 1~2 小时，
必超时；而且**中途超时既不回滚也不能续跑，没有判重，重传会重复插入**。

所以按 IKAD 导入的先例写了 **`scripts/data-fixes/import_yalv_products.php`**：

- 按 `(supplier_id, model=商品编码)` 幂等，可反复续跑；图片按 `md5(url)` 命名，已下过的直接复用
- 默认 dry-run，`--apply` 才写；`--skip-images` 先只入库（几十秒），`--images-only` 之后补图；`--limit=N` 测试用
- 供应商：`--supplier=ID` 指定，或按名字含「亚铝」找，都没有则创建「印尼亚铝」
- 一级分类 → 货架 13 大类映射见脚本 `CAT_MAP`（目标名已对照 `ShelfHome.tsx` 的 `CAT_ICONS` 核过）
- 0 价商品照样入库（`base_price=0, pending`），02 号单的价格闸门拦着不能上架，后台补价后再上
- **不更新已存在商品的价格**（商城价会变；改价走后台留痕，或另开单做「同步价格」模式）

**本地验证（2026-09-23，PHP 8.5，空库）**：`--apply --limit=30` → 新增 30、图片 30/30；立刻重跑 → 新增 0、已存在 30；
DB 行字段正确（名称/规格拆分、单位「个」、起订倍数、IDR 价、in_stock、图片相对路径）。全量 dry-run：新增 8116、0 价 121。

## 生产执行（老板做，三条命令）

```bash
# 1. 把 JSON 传到服务器项目的 backend/data/（该目录已 gitignore，不会被 git pull 覆盖也不会进仓库）
scp ~/Downloads/yalv_products.json <服务器>:<项目根>/backend/data/

# 2. 服务器项目根目录：先 dry-run 看供应商找对没有（有多个含「亚铝」会提示用 --supplier=ID）
php scripts/data-fixes/import_yalv_products.php

# 3. 执行。建议分两步：先只入库（几十秒），再补图（8000 张 1~2 小时，可反复续跑）
php scripts/data-fixes/import_yalv_products.php --apply --skip-images
nohup php scripts/data-fixes/import_yalv_products.php --apply --images-only > /tmp/yalv_images.log 2>&1 &
```

之后在后台「商品库」按分类审核上架；`base_price=0` 的 121 条要先补价。

## 拉取方法（下次更新价格时复用）

见 **`scripts/yalv_pull_hook.js`**（文件头有用法）。要点：

- 页面每个请求带 `host_key` / `aeskey` 防重放签名，**不逆向**；只被动截 `queryBaseInfos`（基础信息）和
  `queryDynamicInfo`（认证价 / 零售价 / 可供数量）的 XHR 响应
- 认证价**必须登录态**：游客只看到「认证可见」。老板用自己的 Chrome 登录（Claude in Chrome 扩展），
  应用内浏览器是另一套 profile，不共享登录
- 列表容器 `.am-list-view-scrollview` 程序滚 `scrollTop` **不触发翻页**，要真实滚轮事件，所以是「滚一下 → `step()` 一下」步进式；
  列表太短的分类（托盘物流箱周转筐）不会触发翻页，要回头补一次
- 数据随时 `save()` 镜像到 `localStorage`：这次标签页中途脱离了会话，8049 条全靠镜像找回
- 导出用 `download()` 触发 Blob 下载。**别搭本机接收器**：https 页面往 127.0.0.1 fetch 被 Chrome 本地网络访问限制挂死

## 🔴 纪律

老板的登录 token 出现在 cookie / 埋点 URL 里，**绝不写入任何文件 / commit / 台账**，用完即弃。
`yalv_products.json` 含供货价，只放 `backend/data/`（gitignore），不进仓库、不进任务单。

## 待老板决定

- [ ] 生产跑导入（上面三条命令）
- [ ] 121 条 0 价商品：补价上架，还是留着不上
- [ ] 以后要不要做「同步价格」模式（重拉 JSON → 更新已有商品价格并留痕）
