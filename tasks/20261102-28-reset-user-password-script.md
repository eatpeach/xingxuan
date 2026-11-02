# 28 · 后台账号密码重置脚本（admin 忘密码兜底）

| 项目 | 内容 |
|---|---|
| **状态** | 🚧 脚本完成 + 本地验证 · 差线上执行（老板在宝塔终端跑一条命令） |
| **创建** | 2026-11-02 |
| **风险** | 🟡 只改 `users` 一行 + 清该账号限流记录；临时密码只打印到终端，不落文件 |

## 背景

老板不知道线上 `admin` 密码（seed 口令早已随 10 号单改成随机，初始密码文件只在服务器上）。
后台「重置密码」入口需要先以管理员登录——鸡生蛋。此前只能手工拼 SQL，容易漏掉
`must_change_pwd` / `initial_pwd` / 限流清理，于是做成标准数据脚本。

## 做法

`scripts/data-fixes/reset_user_password.php`，与 `handle_resetUserPassword` 同一套规则：

- 同款好读临时密码（去 0/O/1/l），bcrypt 进 `password_hash`，明文留 `initial_pwd`，`must_change_pwd=1`
- 清 `login_attempts`，写 `op_logs`（`actor_label=cli:reset_user_password`，不记密码）
- 无参 dry-run 只看账号状态；`--apply` 才改。事务内 `rowCount()!==1` 回滚
- root 跑会先降权到 db 文件属主（www），避免 `-wal/-shm` 落成 root 属主把站点弄成 readonly

```bash
php scripts/data-fixes/reset_user_password.php --user=admin           # dry-run
php scripts/data-fixes/reset_user_password.php --user=admin --apply   # 重置，终端读临时密码
```

## 验证

- 本地（生产快照库）：`php -l` 过；dry-run 不改库；`--apply` 后 `users` 行 hash 60 位、`must_change_pwd=1`、
  `op_logs` 有记录、`login_attempts` 清空
- 线上：老板执行后用临时密码登录 → 被要求改密 → 改完能正常进工作台

## 纪律

临时密码**只在终端显示一次**：不进聊天记录以外的任何地方，不进本台账、commit、注释。
