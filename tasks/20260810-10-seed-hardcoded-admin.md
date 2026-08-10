# seed 硬编码 `admin123` —— 公开仓库里的活代码，闸门是唯一防线

| 项目 | 内容 |
|---|---|
| **状态** | 🚧 代码完成 + ✅ 本地验证过（空库/已有库两种情况），仅差生产验收 |
| **负责人** | 开发人员A（他发现的，上下文在他手上） |
| **指派人** | CTO |
| **创建时间** | 2026-08-10 |
| **时限** | 2026-08-12 前 |
| **完成时间** | — |
| **风险等级** | 🟠 中高（即时风险已排除，但防线单薄且后果是管理员权限） |

---

## 即时风险已排除，但不能就这么放着

**老板 2026-08-10 已确认：`users` 表里 `admin` 这一行还在。**
所以 seed 的闸门成立，不会重建账号——**现在线上没有已知密码的后门。**

**但这不等于安全。**

## 事实（CTO 逐行核过）

`backend/config/database.php:890-895`：

```php
$cnt = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE username='admin'")->fetchColumn();
if ($cnt === 0) {
    $hash = password_hash('admin123', PASSWORD_BCRYPT);
    $st->execute(['admin', $hash, '管理员', 'admin']);   // admin 角色
}
```

`backend/api/handler.php:26` → `$db->initialize()` → `seed()`。

**`handler.php` 是所有 API 的单一入口，而这行在鉴权之前**（鉴权在 58 行）。
所以**任何一个请求都会触发 seed，包括无需登录的公开接口**——
随便谁打一下 `shelfMeta`、打开一下货架首页都会走到。

**结论：只要 `admin` 这一行消失，下一个请求（不需要任何凭据）就会用一个公开可查的密码重建管理员账号。**

## 🔴 为什么必须改，而不是"admin 还在就没事"

1. **防线只有一道，而且是数据条件不是代码条件**——清理用户、合并账号、换服务器重建库，
   任何一种都会让它失守，而且失守时没有任何告警
2. **密码是公开的**。`github.com/eatpeach/xingxuan` 长期公开（老板 08-09 已定），
   任何人 clone 就知道这个种子口令。闸门一旦失守就是直接可登录，没有中间环节
3. **新部署天生带后门**。这套代码任何一次全新部署，初始管理员密码都是已知的

## 顺便更正一条 CTO 的错误裁决

08-09 我曾结案「`admin123` 是失效口令，不重写 git 历史」，
**前提是它只存在于文档和历史里。这个前提是错的——它是 main 分支上的活代码。**

裁决的**结论**仍然成立（不重写历史），但**理由要换**：

> 不重写历史，不是因为口令失效，**而是因为重写历史根本没用**——
> `admin123` 就在当前源码里，清历史清不掉它。**唯一有效的处置是改代码，也就是本单。**

## 要改什么

### 1. 触发条件收紧

`WHERE username='admin'` → **`users` 表完全为空**。

理由：现在的条件把「有没有叫 admin 的用户」当成「系统初始化了没有」，这两件事不是一回事。
用户改了用户名、或者删掉 admin 另建账号，都会被误判成"未初始化"。

### 2. 密码不再硬编码

任选一种，**你判断哪种在本项目（无 composer、宝塔部署）最不别扭，选了在结论里说明理由**：

- **随机生成 + 落盘到仓库外**：`bin2hex(random_bytes(9))` 之类，写到
  `backend/data/initial-admin-password.txt`（`data/` 已在 `.gitignore` 里），并在 `error_log` 打一行
- **读环境变量**：`getenv('XINGXUAN_INITIAL_ADMIN_PASSWORD')`，没设就**不建账号**并记日志

**不要**用「随机生成但只打印到 stdout」——PHP-FPM 环境下没人看得到。

### 3. 同一个 `seed()` 里的另外两项业务数据，一并处理

A 已指出：`bank_account_name` 是**真实姓名**，`bank_account_no` 是**真实银行账号**
（`database.php:907` 附近），都硬编码在公开仓库的 seed 默认值里。

**CTO 决策：两项都改成空默认值**，由部署后在「系统设置」里填。

理由不是保密（这两项本来就印在客户发票上），是**工程层**：
业务配置焊死在源码里，任何人 fork 部署，默认收款账号就是星选的。

⚠ **注意兼容**：`system_settings` 的 seed 用的是 `INSERT OR IGNORE`，
**现网已有值不会被覆盖**，改默认值不影响生产。但**动手前自己确认这一点**，别想当然。

## 交付清单

- [x] **1. 触发条件改为「`users` 表为空」**
- [x] **2. 密码不再硬编码**，方案二选一 + 结论里写明选择理由 → 选**随机落盘**，理由见结论
- [x] **3. `bank_account_name` / `bank_account_no` 默认值改空**，并确认 `INSERT OR IGNORE` 不影响现网
- [x] **4. 全仓再搜一遍**还有没有别的硬编码凭据 / 真实业务数据（结果见结论）
- [x] **5. 静态自查**：`php -l` 通过 + 占位符核对
- [ ] **6. 线上验证**（见下，需真人开门；本地 case1/case2 已过）

## 怎么验

⚠ **这单最容易验出事故——`seed()` 每个请求都跑，改错了会影响全站。**

- [ ] 部署后**立刻**访问一次公开接口（`https://www.xingxuan.cc` 首页），确认没有 500
- [ ] 确认 `users` 表里的账号**一个都没变**（`admin` 还在、其它账号还在、没有新增）
- [ ] 确认 `system_settings` 里的 `bank_*` **现有值没被清空**（这是 `INSERT OR IGNORE` 该保证的，实测确认）
- [ ] 用测试账号登录一次，确认后台正常

## 🔴 红线

- **不许删或改 `users` 表里任何现有账号**。本单只改建账号的条件和密码来源
- **不许清空 `system_settings` 现有值**。改的是默认值，不是现值
- `seed()` 在每个请求上跑，**任何异常都会让全站 500**——改完静态自查要格外仔细
- 改完 commit + push，**不要自己去服务器 `git pull`**，部署由老板做

## 遇到这些情况，停下来找 CTO

- 发现改「`users` 表为空」这个条件会影响某个现有流程（比如某处依赖 admin 一定存在）
- 第 4 步搜出别的硬编码凭据，改动面变大
- `INSERT OR IGNORE` 的实际行为和预期不符

## 结论

改了 **`backend/config/database.php` 一个文件**（seed 逻辑），外加同步更新 `CLAUDE.md` 与 21 号单的本地启动说明。
`php -l`：无语法错误。本地 case1（空库）+ case2（已有库）两种情况都实跑过。

### 1. 触发条件

`WHERE username='admin'`（COUNT=0 就建）→ **`SELECT COUNT(*) FROM users` 为 0 才建**。

先全仓确认没有别处依赖「一定有个叫 admin 的用户」：`git grep` 里所有权限判断都用 `role === 'admin'`
（`category.php` / `banner.php` / `calendar.php` 等），**唯一引用 `username='admin'` 的就是 seed 这一行本身**。
所以收紧条件不影响任何现有流程。

### 2. 密码方案：选「随机生成 + 落盘仓库外」，不选环境变量

| | 随机落盘（选它） | 环境变量 |
|---|---|---|
| 本地 `php -S` | ✅ 自动生成、写文件、`cat` 即可登录 | ❌ 没设变量就**建不出账号**，本地登不进 |
| 宝塔生产 | ✅ 一致，部署后读文件 | 需在 FPM 环境配变量，易漏 |
| 21 号单依赖 | ✅ 本地登录方式仍成立 | ❌ 会破坏 21 的本地登录 |

**决定性理由**：21 号单的本地开发登录**依赖 seed 建出账号**。环境变量方案下，本地不设变量就没账号，
直接把刚建好的本地环境打破。随机落盘在本地和生产**行为一致、无需任何人设变量**，
且文件落在已 gitignore 的 `data/`，口令永不进公开仓库——契合本项目无 composer、文件化的风格。

实现：`bin2hex(random_bytes(9))`（18 位十六进制），写 `backend/data/initial-admin-password.txt`
（含用户名/密码/生成时间/改密提示），并 `error_log` 记一行。`random_bytes` 失败时兜底用
`hash('sha256', uniqid+mt_rand)` 截 24 位（PHP 8 下几乎不会走到，但 seed 每请求都跑，不能让它抛异常）。
**用户名仍是 `admin`、角色仍是 `admin`**——当初泄露的是密码不是用户名，用户名无需改。

### 3. bank 默认值改空 + 兼容确认

`bank_account_no`：`'2880650567'` → `''`；`bank_account_name`：`'zhangweiqi'` → `''`。

**`bank_name`（`'BCA'`）我没动**：单子点名的是「两项」（账号 + 户名），`'BCA'` 只是「哪家银行」的
通用默认、非识别性数据，按「别顺手多改」纪律留在范围内。**要不要连 `bank_name` 一起清，留给 CTO 定**——
若要，一行就改。

**`INSERT OR IGNORE` 兼容性我实测确认了**（不是想当然）：case2 里把 `bank_name`/`bank_account_no`
改成「生产真实值」再触发 seed，值**原样保留没被覆盖**（详见下方 case2）。改默认值不影响现网。

### 4. 全仓搜索结果（`git grep -nE "password_hash\(|admin123|2880650567|zhangweiqi"`，排除 tasks/）

| 命中 | 判定 |
|---|---|
| `database.php:892` `admin123` | 🐛 本单已改（唯一硬编码口令） |
| `database.php:907/908` `2880650567` / `zhangweiqi` | 🐛 本单已改空 |
| `auth.php:53` `product_admin.php:379` `user_admin.php:58/70` `vendor.php:66` `password_hash(...)` | ✅ **全部是对用户输入变量做哈希**（`$newPwd`/`$pwd`/`$password`），不是硬编码，合法 |

**没有别的硬编码凭据或真实业务数据。** CTO 提到的 currency bug（vendor 那处）是另一类问题，走 22 号单。

### 5. 静态自查

- `php -l database.php`：No syntax errors
- 新增 INSERT `users`：4 占位符 / execute 4 参 —— 对得上
- seed 块只新增一个 `if`、一个 try/catch、两次文件/日志写入，无 SQL 参数数变化
- bank 两项只改字面量值，SQL 结构不变

### 6. ✅ 本地验证（case1 空库 + case2 已有库，真 PHP + 真 HTTP）

**环境**：独立 scratchpad backend（`php -S 127.0.0.1:8012`），用改后代码全新构建。

**case 1 · 空库**（模拟全新部署 / 本地首启）：打 `shelfMeta`（公开接口）触发 seed →

- ✅ **HTTP 200**（seed 在空库上没崩）
- ✅ `users` 表有 1 个 `admin`（role=admin，bcrypt `$2y$12$`）
- ✅ `password_verify('admin123', hash)` = **false**——**旧后门口令彻底失效**
- ✅ 随机密码写入 `data/initial-admin-password.txt`（如 `c153725d6812487f18`），`error_log` 记录了
- ✅ **用文件里的口令走 `login` action → `success:true`**（拿到 `access_token`）——seed 账号可正常登录，21 依赖成立
- ✅ `bank_account_no` / `bank_account_name` 默认 = **空串**（`bank_name` 仍 `'BCA'`，见第 3 节）

**case 2 · 已有库**（模拟生产：把 admin 改名 `boss`、加一个 `sales01`、bank 设成生产值）→ 触发 seed：

- ✅ **HTTP 200**
- ✅ `users` 仍 2 个，**没有冒出新 `admin`**，`boss` / `sales01` 都在——**现有账号一个没动**（红线）
- ✅ `bank_name=PROD-BANK` / `bank_account_no=9999888877` **未被覆盖**（`INSERT OR IGNORE` 实证）
- ✅ 密码文件**没有被误建**（用「删掉文件看 seed 会不会重写」当探针，确认已有库不触发建账号分支）

### 🔴 本地已验证 ≠ 生产验收

本地 PHP 8.5 上跑通。**生产验收 checkbox 保持不勾**。这单 CTO 特别提示「最容易验出事故」，
生产部署后**必须立刻**：① 访问首页确认无 500 ② 确认 `users` 表账号一个没变、没新增
③ 确认 `system_settings` 的 `bank_*` 现有值没被清空。需真人开门。

### 顺带：更正 08-09 那条裁决的理由（单子背景已写，这里落实）

不重写 git 历史的**结论**仍成立，但**理由**换了：不是「口令已失效」（它没失效，是 main 上的活代码），
而是「**重写历史清不掉它——它在当前源码里**」。本单改代码才是唯一有效处置。**现在已处置。**
