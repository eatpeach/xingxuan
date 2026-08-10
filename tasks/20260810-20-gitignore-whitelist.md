# `.gitignore` 改白名单式 —— 黑名单已漏三次，其中一次是整库快照

| 项目 | 内容 |
|---|---|
| **状态** | 🚧 进行中（B 2026-08-10 开工）|
| **负责人** | 开发人员B（三处都是他发现的） |
| **指派人** | CTO |
| **创建时间** | 2026-08-10 |
| **时限** | 2026-08-11 前（插队） |
| **完成时间** | — |
| **风险等级** | 🔴 高（公开仓库 + 整库快照未被忽略） |

---

## 为什么插队

**这单不产生可部署的代码改动**（只改 `.gitignore`），
所以它**不会加剧 06/12/13 那批未验证代码的归因风险**——那条刹车对它不适用。

而它防的是**一次手滑就把整个生产库推进公开仓库**。

## 三次发现，同一个根因

`backend/.gitignore` 是**黑名单式**：列出要忽略什么。
**每加一种产物就得记得同步改一次，已经漏了三批。**

### 漏洞一：七个上传目录没被忽略（14 号单摸底发现）

```
storage/inquiry   ✅    storage/export    ✅
storage/vouchers  ❌  ← 付款凭证
storage/payment   ❌    storage/products  ❌    storage/banner ❌
storage/sv        ❌    storage/tmp       ❌    storage/converted ❌
```

### 🔴 漏洞二：数据库备份文件没被忽略（07 本地实跑发现，**最严重**）

`.gitignore` 写的是 `data/*.db` / `-shm` / `-wal`，
而脚本生成的备份叫 **`xingxuan.db.bak-20260810-122359`** —— **不以 `.db` 结尾，匹配不上。**

CTO 已 `git check-ignore` 实测确认：

```
xingxuan.db                       ✅ 已忽略
xingxuan.db.bak-20260810-122359   ❌ 未忽略
```

**一个文件 = 整库快照**，含全部客户、报价、发票号、收款金额。
14 号单那个 `storage/vouchers/` 是一个目录的文件；**这是整个数据库一个文件。**

🔴 **而且这不是假设**：`purge_all_products.php` 和 `backfill_invoice_snapshots.php`
都生成这个命名的备份，**老板已经在生产服务器上跑过它们**——那台机器上现在就有这样的文件。

### 漏洞三（同类）：将来任何新增的产物

只要有人加一个新的上传目录、新的导出格式、新的备份命名，**黑名单就又漏一个，而且不会有任何提示。**

## 决策（CTO，2026-08-10）

**改成白名单式：默认忽略，显式放行。**

思路（具体写法你定，下面是意图不是抄写模板）：

- `storage/` 下**默认全部忽略**，只 `!` 放行**确实要进仓库的**：
  `brand/` 里那三个二维码 png（部署要用）、各目录的 `.gitkeep`
- `data/` 下**默认全部忽略**，只放行 `.gitkeep`
  —— 这样 `.db` / `-wal` / `-shm` / `.bak-*` / 以及**任何将来新增的命名**一律进不去

## 🔴 必须自证：不能把该进仓库的东西挡在外面

改完**必须验证现有已追踪文件一个都没被新规则排除**。

`.gitignore` 对**已追踪文件不生效**，所以光看 `git status` 干净**证明不了**——
必须显式验证。至少两条：

```bash
# 1. 现有已追踪的 storage 文件，逐个确认没被新规则命中
git ls-files backend/storage/ | while read f; do
  git check-ignore -q "$f" && echo "🔴 会被排除: $f"
done

# 2. 反向验证：那些该被忽略的，确认真被忽略了
git check-ignore -v backend/data/xingxuan.db.bak-20260810-122359 \
                    backend/storage/vouchers/x.jpg \
                    backend/storage/inquiry/x.pdf
```

**照 B 在 07 号单立的规矩：先测再下结论。**
你自己踩过一次——按锚定规则推断根 `.gitignore` 盖不住 `backend/storage/`，
实测发现命中的是嵌套那个，推断不成立。**这单更要测。**

## 交付清单

- [x] **1. `backend/.gitignore` 改白名单式** ✅
- [x] **2. 根 `.gitignore` 一并检查** ✅ **它有同一类洞，一并改了**（见结论）
- [x] **3. 自证一：现有已追踪文件无一被新规则排除** ✅ **但我第一次的验法是错的，见结论**
- [x] **4. 自证二：三类敏感产物确实被忽略** ✅ 14 个样本
- [x] **5. 全量扫一遍现在仓库里有没有已经混进去的敏感文件** ✅ **零命中，历史也干净**

## 🔴 红线

- **只改 `.gitignore`**，不动任何代码，不动任何已追踪文件
- **不要 `git rm --cached` 任何东西** —— 若第 5 步扫出已混入的敏感文件，
  **停下来报 CTO**，那是要不要重写历史的决策，不是你能定的
- 改完 commit + push

## 遇到这些情况，停下来找 CTO

- 第 5 步扫出仓库里**已经有**敏感文件（客户图纸 / 付款凭证 / 数据库备份）
- 白名单写法会导致某个部署必需的文件进不了仓库，且找不到干净的放行方式

## 结论（B，2026-08-10）

### 第 5 步先做：**仓库现在干净，历史也干净——不需要重写历史**

先做这步，因为万一扫出东西就得停下来报，不该等改完规则才发现。

`backend/storage/` + `backend/data/` 下**已追踪的只有 6 个文件**，全部该在里面：

```
backend/data/.gitkeep
backend/storage/brand/channels.png     ← 部署要用的二维码
backend/storage/brand/douyin.png
backend/storage/brand/wecom.png
backend/storage/export/.gitkeep
backend/storage/inquiry/.gitkeep
```

**历史也扫了**（`git log --all --diff-filter=A`）——除上述三个 png 外，
`backend/storage/` 下从未提交过任何文件；全仓库历史中 `.db` / `.bak` / `.sqlite` /
`voucher` / `.pem` / `.key` **零命中**。

→ **没有已混入的敏感文件，不涉及重写历史的决策。**

### 新规则：三段式白名单

```
data/*
!data/.gitkeep

storage/*        # 排除 storage 的直接子项（含子目录本身）
!storage/*/      # 把子目录放回来，否则 git 不下探，里面的 ! 会因父目录被排除而全失效
storage/*/*      # 再排除子目录里的内容
!storage/*/.gitkeep
```

**`brand/` 故意不设放行规则**：那三个二维码**已经在仓库里**，而 gitignore 对已追踪文件不生效，
不会因为没放行就掉出去；反过来，不放行才挡得住 `brand/` 下**新出现**的文件——
`uploadSettingImage` 把后台上传的 logo/二维码也写进 `storage/brand/`
（`setting.php`，命名 `<key>_YYYYmmddHHMMSS.png`），那些是运行时产物，不该进仓库。
真要新增必须进仓库的，用 `git add -f`。

### 🔴 我第一次的自证方法是错的，得说清楚

**`git check-ignore` 不能用来做这两条自证**，我踩了两个坑：

1. **它默认跳过已追踪文件** —— 对任何已追踪路径都返回「不忽略」，与规则无关。
   所以「用 check-ignore 逐个过已追踪文件、没有命中」这个结论**是空的**，
   它对任何 `.gitignore` 都成立
2. **退出码在有 `!` 取反规则时不表示「最终被忽略」**，只表示「匹配到了某条规则」。
   我一度据此得出「`brand/logo.png` 被忽略」和「`!storage/brand/*.png` 生效了」两个互相矛盾的结论

**权威验法是造真文件跑 `git add -A --dry-run`** —— 这正是本单要防的场景（一次手滑）。
两条自证都用这个方法重做：

**自证一**：6 个已追踪文件，`git status` 零报告（未被当成删除、未受影响）；
并反向确认 `.gitkeep` 删掉后**还能重新 add 回来**（否则目录结构会丢）。

**自证二**：造 14 个真文件——数据库备份 `xingxuan.db.bak-*`、`x.sqlite3`、
`vouchers/凭证.jpg`、`inquiry/图纸.pdf`、`payment/` `products/` `banner/` `sv/` `tmp/`
`converted/`、**将来才会有的新目录**、三层嵌套、`brand/logo.png`、
`brand/pdf_logo_path_*.png` —— **`git add -A --dry-run` 一个都不会 staged。**

### 交付项 2：根 `.gitignore` **有同一类洞，一并改了**

原来是 `data/*.db*`（按扩展名匹配）。实测：根下 `data/z.sqlite3` **会被 staged**。
和 `backend/` 那个漏掉 `.bak-*` 是同一个成因——**黑名单按命名猜，猜不全**。

已改成同样的 `data/*` + `!data/.gitkeep`。改后复测：
根下 `data/` `storage/` 里任意命名（`.db.bak-*`、`.sqlite3`、`.tar.gz`、子目录文件）
**都不会被 staged**。

根下目前并没有 `data/` 和 `storage/` 目录（真正的在 `backend/` 下），
所以这两条是兜底——万一将来有人在根下建同名目录，规则已经就位。已在文件里注明。

### 最终回归

全仓库 `git add -A --dry-run` 只会新增两个文件：`.gitignore` 和 `backend/.gitignore` 本身。
