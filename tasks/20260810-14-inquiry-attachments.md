# 询价附件上传没有入口 —— 客户图纸只被 AI 读成文字，原件不留

| 项目 | 内容 |
|---|---|
| **状态** | 🚧 进行中（B 08-10）· **本次只做上传校验加固，入口推迟**（CTO 08-10 拆单） |
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

---

# ✅ 第一步实现：上传校验加固（B，2026-08-10）—— **入口未做，见拆分说明**

## 🔴 本单被拆成两半，只做了前一半

| | 内容 | 状态 |
|---|---|---|
| **前一半（本次）** | `handle_uploadInquiryAttachment` 的**上传校验加固** | ✅ 已实现 |
| **后一半（推迟）** | 上传 / 列表 / 删除的**前端入口** ＋ `list`/`delete` 两个 action | ⏸ **未做** |

**为什么推迟入口**（CTO 08-10 裁决）：入口做出来就等于把这个接口从「没人调」接进业务日常，
而 `Inquiries.tsx` 上正叠着 12/13 两张未验证的单。**等它们生产验收后再做。**

**校验部分可以先做的理由**：它落在 `inquiry.php` 的**一个函数里**，与 12（`listInquiries` 子查询）、
13（`compareInquiry` 过滤）**不同函数、不同症状**——12 坏了是商机列表打不开、13 坏了是对比页打不开、
14 坏了是附件上传失败。**症状可区分 = 可归因**，不属于刹车要防的「同一数据路径叠两处未验证改动」。

> ⚠ **别把本单当成做完了。** 现在的状态是：接口更安全了，但**仍然没有任何界面能用它**。

## nginx 结论（CTO 08-10 核过老板贴的配置）：`/storage` **不执行 PHP**

```nginx
location ^~ /storage/ { alias .../backend/storage/;
```

关键是 **`^~`**：nginx 里最长前缀匹配若带 `^~`，**就不再检查任何正则 location**，
而 PHP handler（`enable-php-82.conf`）是正则 location。所以 `/storage/x.php` 走 alias 当静态文件吐出。

→ 摸底时报的那条**从「救火」降为「加固」**。我当时没去测是对的（测它等于在生产打 payload）。

## 但有另一条真漏洞，性质不同：**存储型 XSS**

上传的 `.html` / `.svg` 会在**同源**以 `text/html` 渲染。而 `api.ts` 把 token 存在 **localStorage**，
同源 XSS 直接读得走。攻击链：**任意低权限用户传 `evil.html` → 发给管理员 → 管理员一点 → token 被偷 → 提权。**

CTO 已给老板 nginx 加固配置（`/storage` 下拒绝脚本类与可渲染的 html/svg/xml），**尚未贴上去**。
**本单在应用层也堵了一道**，见下面第 3 层——两层独立，任一层生效都挡得住。

## 实现的四层校验

| 层 | 做什么 | 挡住什么 |
|---|---|---|
| 1. 大小 | ≤ 20MB；并区分「PHP 按 ini 拒了」给出可读提示 | 超大文件；以及原先笼统的「上传失败」看不懂 |
| 2. 扩展名白名单 | pdf / jpg / jpeg / png / webp / gif / xlsx / xls / csv / docx / doc / txt | `.php`、`.html`、`.svg`、`.js` 等一律拒 |
| 3. **内容检测** | 检出 `text/html`、`image/svg+xml`、`xml`、`javascript`、`php` 一律拒，**不管扩展名叫什么** | **`evil.html` 改名成 `evil.pdf`** —— 存储型 XSS 的主要绕过手法 |
| 4. **落盘名重写** | `YmdHis_<12位随机hex>.<白名单扩展名>`，**用户输入完全不参与路径** | 扩展名伪造、路径穿越、同名同秒静默覆盖 |

原始文件名去掉控制字符、限长 200，存进 DB 的 `filename` 列（那列本来就有），展示用。

### 白名单是怎么定的（不是拍脑袋）

询价页那个 AI 解析上传口的 `accept` 就是本项目对「客户实际会发什么」的回答——
`Inquiries.tsx:512`：`image/*, .pdf, .xlsx, .csv, .txt`。
附件是**留存原件**而非拿去解析，在此基础上加了 **Word（docx/doc）和老版 Excel（xls）**，规格书常见。

❓ **一条要业务方确认的**：**图纸如果是 CAD（`.dwg`/`.dxf`）现在传不上去。**
代码里没有任何地方处理过 CAD，我没有自作主张加——**要加请业务方确认，我加两行就行。**

## 🔬 本地预检（独立实例，照 A 的隔离法）

把 `backend/` 复制到 scratchpad 独立实例跑（`php -S 127.0.0.1:8021`，全新 seed 库），
**不碰共用工作区的库**。跑完停服务、整个目录删除。

`php -l` 通过；确认无 8.3+ 语法（生产 8.2）；单独验过 `isset(常量数组[key])` 合法。

**逐个打真实攻击载荷：**

| 文件 | 结果 | 服务端返回 |
|---|---|---|
| `图纸.pdf`（真 PDF） | ✅ 通过 | `inquiry/20260810144100_78e6719762ce.pdf` |
| `清单.xlsx` | ✅ 通过 | `inquiry/20260810144100_075339304062.xlsx` |
| `evil.html` | 🛑 拒绝 | 不支持的文件类型… |
| **`伪装成图纸.pdf`**（内容是 HTML，扩展名改成 pdf） | 🛑 拒绝 | **文件内容被识别为网页/脚本类型，出于安全考虑不允许上传** |
| `x.svg` | 🛑 拒绝 | 不支持的文件类型… |
| `shell.php` | 🛑 拒绝 | 不支持的文件类型… |
| `伪装成图片.png`（扩展名 png，内容是随机字节） | 🛑 拒绝 | 该文件扩展名是图片，但内容不是图片 |
| 3MB 文件（本机 ini 上限 2M） | 🛑 拒绝 | **文件超过服务器允许的上传大小（当前上限 2M），请压缩后再传** |

**落盘与 DB 核对**：盘上只有 `20260810144100_78e6719762ce.pdf` 这种随机名，
**用户原名一个字都没进路径**；DB 里 `filename=图纸.pdf`、`file_path=inquiry/…随机….pdf`，原名照常保留。

**同名同秒连传两次** → `…144117_3e80d81bf500.pdf` 和 `…144117_c73c7d6af47c.pdf`，
**各自独立、不再互相覆盖**（原实现秒级粒度会静默覆盖，摸底时报过）。

## 🔴 一个必须让 CTO 知道的：20MB 这个上限**可能根本达不到**

本机预检实测 `php.ini` 是 **`post_max_size=8M` / `upload_max_filesize=2M`**。
超过 8M 的请求**在进入本函数之前就被 PHP 拒绝了**（`$_FILES` 是空的，代码里的 20MB 检查压根跑不到）。

**实际能传多大 = `min(post_max_size, upload_max_filesize, 20MB)`。**

→ **生产的这两个 ini 值需要确认。** 如果生产也是 2M，那「图纸类 PDF 常见 5~15MB」就传不上去，
**做完入口会立刻表现为「大图纸传不了」**。这是运维配置不是代码，我改不了，**请 CTO 转老板确认/调整**。

## 剩下没做的（本单后一半）

- `listInquiryAttachments` / `deleteInquiryAttachment` 两个 action（**目前传上去没接口能列出或删掉**）
- 前端入口（上传 / 列表 / 删除 UI）
- 删除时同步 `unlink` 盘上文件（`ON DELETE CASCADE` 只清 DB 记录，会留孤儿文件）
- 询价页已有两个上传口，做入口时文案要让用户分清「帮我读」和「帮我存」

**生产验收 checkbox 一律未勾**：本地 8.5 vs 生产 8.2、`php -S` vs nginx+FPM、ini 值差异，本地都验不出。
