# 26 · 亚铝（印尼亚铝订货商城）全量商品拉取 → 上架星选货架

| 项目 | 内容 |
|---|---|
| **状态** | 🚧 进行中（接口已摸清，直接调用差最后一步） |
| **创建** | 2026-09-18 |
| **风险** | 🟢 只读拉取第三方公开商城数据；写入走现有 Excel 导入流程 |

## 目标

把供应商「亚铝」订货商城的全部商品批量拉下来，按收集表格式导入星选商品库（挂在亚铝这个供应商下，待审核上架）。

## 已确认的事实

**商城**：畅捷通 T+ 订货商城（mshop），移动端 H5。
路径前缀 `https://cloud.chanjet.com/tczsy/uf00z85v9gz4/qhghhlspvh/`，店铺页 `shop/2926538486972429/index.html#/creator/2884581215568937`。

**游客可浏览**（`initInfo` 返回 `isSupportVisitor: true`）：商品名 / 编码 / 品牌 / 规格型号 / 英文名 / 图片 / 单位 / 库存 / 零售价 全部拿得到。
**供货价对游客显示「认证可见」** —— 这一列必须用老板的登录态（他的 Chrome 里已登录）。

**接口**（同前缀下 `mshop/MshopProduct/`，都是 POST，query 带 `?shopType=0`）：

1. `queryBaseInfos` —— 商品基础信息，分页
   ```json
   {"criteria":[{"qryCriteria":"PRODUCT_MSHOP_TREE_PATH","values":["DELIXI德力西^按钮开关^"]}],
    "sortBy":[{"qrySort":"SEQUENCE_NUM","order":"asc"}],
    "firstResult":0,"maxResult":20,
    "productFields":["PRODUCT_DISPLAY_DESCRIPTION","PRODUCT_SPEC_NO","CROSSED_PRICE","INVENTORY",
                     "SUGGESTED_RETAIL_PRICE","PRODUCT_CODE","BRAND","MININUM"],
    "isCheckInventory":false,"ignoreGroupDisplay":false,
    "productCustomizedFields":["customized3075028658817976"]}
   ```
   - 分页：`firstResult` / `maxResult`，响应带 `hasMore`
   - 分类过滤：`PRODUCT_MSHOP_TREE_PATH`，值是「一级^二级^」
   - 响应字段：`id` `code`(商品编码) `name` `specNo`(规格型号) `productBrandName` `displayDescription`(英文名)
     `imgUrl` `salesUom.uomName` `baseUom` `mshopSalesQty` `customized3075028658817976`(数量倍数 = 起订倍数)

2. `queryDynamicInfo` —— 价格 / 库存
   ```json
   {"productAndUomIds":[{"productId":2885845683934925,"uomId":2885841919935717}],
    "fields":["AVAIL_QTY","ON_HAND_QTY"]}
   ```
   - 响应：`availQty` `onHandBaseQty` `isSoldOut` `displayUoms[0].retailPrice`(零售价，游客有值)
     `displayUoms[0].price`(供货价，游客 = "认证可见") `promoTags`

**一级分类**（分类页左侧，未滚到底）：DELIXI德力西、BOSI波斯工具、Bridge大桥焊材、Welding焊机及配件、
Lifting吊具、Sabuk&Jaring安全、Webbing Sling吊带、Safety劳保产品、Mesin施工机械、货架 …
另有分类 id：德力西 2947495237390553、波斯 2947495237390548、东成 3245142514336817。

## 签名机制与突破口（已验证 ✅）

页面每个请求带 `host_key`（32 位 hex）和 `aeskey`（长 base64），**每个请求都不同**，是防重放签名；
在页面上下文直接 `fetch` 照抄固定 headers 拿到的是故意的 404。**不逆向它**——

**验证通过的办法**：hook `XMLHttpRequest.prototype.send`，在页面自己发请求前篡改 body。
实测把 `maxResult` 20→5，返回 5 条、status 200、hasMore=1 —— **签名不校验 body**。
所以：让页面自己算签名、自己发，我只改 `maxResult`（→500）、去掉 `criteria`（→全店），
在 xhr `load` 事件里截 `responseText`。翻页用 `firstResult` 递增直到 `hasMore=0`。

页面请求的固定 headers（签名两项由页面自己算，不用管）：`zoneId: 123456`、`book-number: qhghhlspvh`、
`mshopid` / `mshop-id: 2884581080957933`、`from-shop: true`、`Authorization: Bearer <jwt>`。
jwt 同时存在 cookie `tczsy-uf00z85v9gz4-qhghhlspvh-mshop` 里。

## 登录态：必须（老板 2026-09-18 明确）

认证客户看到的价格与游客不同，**所有价格必须在老板的登录态下拉**，游客的零售价不能当供货价用。

**建议做法**：老板在**应用内浏览器**（Browser pane，tab `seed`）里登录一次亚铝商城，
之后 hook / 篡改 / 截响应全在这个已登录页面里做，拿到的就是认证价。
应用内浏览器全程稳定；Chrome 扩展（tab 857553126）多次断连、JS 超时 45s，**不再依赖它**。
登录动作由老板本人完成，不代输账号密码。

## 工具选择

- **主力**：应用内浏览器 `mcp__Claude_Browser__*`（tab `seed`），登录后即唯一战场
- 页面上已挂三层 hook：`window.__reqLog`（url/body）、`window.__hdrLog`（headers）、`window.__tamperLog`（篡改验证）。
  **页面刷新 / 登录跳转后全部丢失，要重挂**
- Chrome 扩展仅作备用

## 落地路径

1. 全量拉 `queryBaseInfos`（遍历分类或无过滤翻页）→ 按 productId 批量 `queryDynamicInfo` 拿库存 / 零售价
2. 供货价：Chrome 登录态里 `queryDynamicInfo`，或老板在自己浏览器 F12 跑一段 JS 导出 JSON 发过来
3. 映射到收集表 25 列（`scripts/gen_product_template.py` 的列名）：
   name←name(去掉「/」后的规格部分) · spec←specNo · brand←productBrandName · model←code ·
   unit←salesUom.uomName · base_price←price(供货价) · 市场参考价←retailPrice · 可供数量←availQty ·
   起订量←customized3075028658817976 · 图片←imgUrl · 描述←displayDescription · 品类←一级分类映射到星选 13 大类
4. 生成 xlsx → 供应商门户「Excel 导入」或后台导入到亚铝供应商下 → 审核上架（`_vendorFetchImages` 会自动下载图片）

## 🔴 纪律

老板的登录 token 出现在埋点 URL 里，**绝不写入任何文件 / commit / 台账**，用完即弃。本文件不含凭据。
