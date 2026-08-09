# 询价附件上传没有入口 —— 客户图纸只被 AI 读成文字，原件不留

| 项目 | 内容 |
|---|---|
| **状态** | 🔍 **仅摸底完成，未写任何实现**（CTO 08-10 明确：四张未验证的单验完再动手） |
| **负责人** | 开发人员B |
| **指派人** | CTO |
| **创建时间** | 2026-08-10 |
| **风险等级** | 🟡 中（功能缺失）／ 🔴 高（摸底挖出的安全问题，见第 2 节） |

---

## 背景（CTO 指派）

`inquiry_attachments` 表建好了、`uploadInquiryAttachment` 后端写好了、**前端零调用**。
建材询价八成带图纸/清单/规格书，现在只能靠 AI 解析成文字，**原件丢了出争议没依据**。

**本次只摸底，不写实现。**

---

# 摸底结论（B，2026-08-10）

## 1. 「后端现成、只缺入口」——**只对一半**

✅ 属实的部分：`handle_uploadInquiryAttachment` 存在（`inquiry.php:578`）、
路由通（`handler.php:121`）、**前端零调用**（自己 grep 确认）、
**不在 `publicActions` 白名单里**，所以需要登录态。

❌ **但它是全项目唯一一个附件 action。没有列表、没有下载、没有删除。**

- 没有 `listInquiryAttachments` / `deleteInquiryAttachment`
- `getInquiry` **也不返回附件**（查过，返回里没有 attachments）

**所以「只缺入口」不准确——传上去之后，系统里没有任何接口能把它列出来或删掉。**
做这个功能不是加一个上传按钮：

| 至少还要补 | 为什么 |
|---|---|
| 列表 | 不然用户传完在界面上看不见，等于传进黑洞 |
| 删除 | 传错文件没法撤 |

⚠ 另外：`inquiry_attachments` 有 `ON DELETE CASCADE`，删商机会连带删掉**数据库记录**，
但**盘上的文件不会删**（全项目没有任何 `unlink` 逻辑）→ 产生孤儿文件。

## 2. 🔴 安全：这是八个上传接口里**唯一一个没有任何校验**的

| handler | 大小限制 | 类型校验 | 落盘文件名 |
|---|---|---|---|
| `uploadSettingImage` | 5MB | MIME 白名单 | 扩展名由检测到的 MIME 决定 |
| `uploadVoucher` | 20MB | 扩展名 `^[a-z0-9]{1,5}$`，否则强制 `bin` | 随机化（md5+rand） |
| `vendorUploadProductImage` | 10MB | MIME 白名单 | 随机化 |
| `aiParseInquiryFile` | 20MB | MIME 检测 | **不落盘** |
| **`uploadInquiryAttachment`** | **无** | **无** | **原样保留用户的扩展名** |

```php
$safe = preg_replace('/[\/\\\\]/', '_', $f['name']);   // 只把 / 和 \ 换成 _
$rel  = 'inquiry/' . date('YmdHis') . '_' . $safe;
move_uploaded_file($f['tmp_name'], $abs);
```

- ✅ **路径穿越挡住了**：分隔符被替换，`../../x` 变成 `.._.._x`，跑不出目录
- ❌ **扩展名完全不限**：传 `x.php` 就落成 `storage/inquiry/20260810123456_x.php`
- ❌ **`/storage/` 无鉴权 web 可达**——实测 `GET /storage/brand/logo.png` 返回 **HTTP 200**
  （目录列表是关的，`/storage/inquiry/` 返回 403，这点是好的）

### ⚠ 会不会真的被当成 PHP 执行，取决于 nginx 配置——**不在仓库里，我看不到**

宝塔默认站点配置通常带一条全局 `location ~ \.php$ { fastcgi_pass ... }`，
**若如此，则这是一个「任意已登录后台用户 → 服务器任意代码执行」**。

🔴 **我没有去测。** 测它等于在生产上打一发 payload，而且需要登录态——
**两条都不是我该做的事。请老板或 CTO 直接看一眼 nginx 配置**：
`/storage` 这个 location 有没有对 `.php` 的豁免（理想是 `location ^~ /storage { ... }` 里
显式关掉 PHP 解析，或直接 `location ~ ^/storage/.*\.php$ { deny all; }`）。

### 为什么这条必须在做入口之前解决

**这个接口现在是「路由通着但没人调」。14 号单一旦把入口做出来，
就等于把它从"没人碰"变成"业务日常使用"。** 补校验必须先于做入口，
否则等于亲手把一个潜在的洞接到主流程上。

**建议的最小校验**（照项目已有惯例，不发明新写法）：
大小上限、扩展名白名单（图纸类：pdf/jpg/png/webp/xlsx/xls/docx/dwg…）、
落盘文件名随机化不用用户输入 —— 三条 `uploadVoucher` 里都有现成写法可抄。

### 顺带一个非安全但会丢数据的点

文件名是 `date('YmdHis') . '_' . 原名`，**秒级粒度**。
同一秒传两个同名文件 → `move_uploaded_file` **静默覆盖**，前一个没了。
其它 handler 都加了 md5/随机后缀，只有这个没有。

## 3. 存储 / gitignore：**CTO 担心的那条是安全的，但邻居有洞**

✅ **询价附件不会进公开仓库。** `backend/.gitignore` 有：

```
storage/inquiry/*
storage/export/*
!storage/inquiry/.gitkeep
!storage/export/.gitkeep
```

`git check-ignore -v` 实测确认：`backend/storage/inquiry/客户图纸.pdf` **已被忽略**。

> 📌 我一开始判断错了：根目录 `.gitignore` 里的 `storage/*` 是**锚定到仓库根**的，
> 盖不住 `backend/storage/`。但**实测**发现命中的是 `backend/.gitignore` 里的规则——
> 有嵌套 gitignore，我原来的推断不成立。**先测再下结论，别照着推理写结论。**

### 🔴 但只有 `inquiry/` 和 `export/` 被忽略，其余**七个上传目录一个都没有**

`git check-ignore` 逐个实测：

| 目录 | 写入方 | 被 gitignore 忽略？ |
|---|---|---|
| `storage/inquiry/` | 本单 | ✅ |
| `storage/export/` | 导出 | ✅ |
| **`storage/vouchers/`** | **`uploadVoucher`（付款凭证）** | ❌ **未忽略** |
| `storage/payment/` | 收款码 | ❌ |
| `storage/products/` | 商品图 | ❌ |
| `storage/banner/` | 轮播图 | ❌ |
| `storage/sv/` | 短视频 | ❌ |
| `storage/tmp/` | 临时文件 | ❌ |
| `storage/converted/` | 转换产物 | ❌ |

**`storage/vouchers/` 是付款凭证——财务单据，敏感度和客户图纸同级，现在没有任何 gitignore 保护。**

目前没出事：开发机上这些目录是空的（真数据只在服务器上），而且没人从服务器提交。
**但 CTO 刚立的「禁止 `git add -A`、只 add 自己的文件」是唯一的防线，一次手滑就进公开仓库。**

**建议另开单**：把 `backend/.gitignore` 从黑名单改成白名单式——
忽略 `storage/*`，再用 `!` 放行确实要进仓库的（`brand/` 的 logo、各目录的 `.gitkeep`）。
**黑名单模式下每加一个上传目录都得记得同步改 gitignore，这次已经漏了七个**，
说明这个模式本身靠不住。

## 4. 和现有 AI 解析：**并行，不是替代**

`aiParseInquiryFile`（`ai.php:588`）读完临时文件直接送 AI，**全文没有 `move_uploaded_file`——不落盘**。
有 20MB 限制和 MIME 检测。

所以现在的流程是：**上传图纸 → AI 读成文字明细 → 原件丢弃。**

`uploadInquiryAttachment` 要补的正是「留存原件」，两者**互补**：
AI 负责把原文变成结构化明细，附件负责事后争议时拿得出原件。**没有替代关系。**

⚠ 做入口时要注意：询价页现在**已经有两个上传口**
（`aiParseInquiryText` 粘文字 / `aiParseInquiryFile` 传图片，都在「AI 智能解析」那块）。
再加一个「上传附件」，**要让用户一眼看出区别**——一个是「帮我读」，一个是「帮我存」。
文案上不区分开，用户会以为传了一次就都办了。

---

## 待 CTO 决定

1. 🔴 **nginx 里 `/storage` 是否禁用 PHP 解析** —— 请直接看配置，这条决定第 2 节是「加固」还是「救火」
2. **补校验要不要并进 14 号单**，还是单独一张先做（我倾向单独先做：它和"做入口"是两件事，
   而且补校验本身零 UI、可独立验证）
3. **`backend/.gitignore` 改白名单** —— 建议另开单，含 `storage/vouchers/` 等七个目录
4. 14 号单真正的范围：上传 ＋ **列表** ＋ **删除**（含删文件，别留孤儿），不是只做上传

**未写任何实现代码。** 等四张单（06/07/12/13）线上验完再动手。
