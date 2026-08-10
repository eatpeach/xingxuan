# 生产验收总清单（一次开门跑完 10 张单）

> 覆盖：02 / 05 / 06 / 07 / 08 / 10 / 11 / 12 / 13 / 22。
> 由 [A batch](PROD-VERIFY-A-batch.md) 与 [B batch](PROD-VERIFY-B-batch.md) 按
> **测试数据生命周期**合并重排（23 号单）。两份原文保留作底稿，**执行以本文为准，不要三份都跑**。
>
> 执行人无需了解任何单子背景：每一步都写了「点哪里 → 应看到什么」。
> 从上往下走，勾一条做一条；**任何一步实际看到的和「应看到」不一致，拍照/截图记下，继续走别硬修**。

---

## 🔴 不要碰的真实数据（先读这段）

线上现有：**12 条已成单商机、已收 Rp 3,504,495,889、9 条返佣、21 张历史发票**。

- 一切增删改只对名字带 **「_测试勿动」** 的数据做
- 05 那步要"重新生成报价被拒"——**必须用下面新造的测试商机试，绝不能拿真实商机点**
- 唯一允许碰真实数据的是 §2（07 抽查）：**只读，只看不点任何按钮**

---

## 0 · 无需开门即可完成（现在就能做）

- [ ] **部署**：宝塔终端 `cd /www/wwwroot/www.xingxuan.cc && bash deploy.sh`
      （**不能只 `git pull`**——OPcache 缓存旧 handler.php，新 action 会报「未知 action」）
- [ ] **确认没崩**：`curl -s -o /dev/null -w "%{http_code}\n" https://www.xingxuan.cc` → **应输出 200**
      （10 号单改了 seed()，它在鉴权前、每个请求都跑，出问题是全站 500）
- [ ] **线上包 = 仓库包**：
      ```bash
      curl -s https://www.xingxuan.cc/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
      ```
      → 应与仓库 `frontend/dist/index.html` 里的入口名一致
- [ ] **10 号单查库①（账号未变）**：
      ```bash
      sqlite3 /www/wwwroot/www.xingxuan.cc/backend/data/xingxuan.db "SELECT username, role FROM users;"
      ```
      → **账号一个没变、没冒出新 admin**
- [ ] **10 号单查库②（设置未清）**：
      ```bash
      sqlite3 /www/wwwroot/www.xingxuan.cc/backend/data/xingxuan.db \
        "SELECT key, value FROM system_settings WHERE key LIKE 'bank_%';"
      ```
      → **现有值原样还在，没被清空**
- [ ] **07 备份留痕**：
      ```bash
      ls -la /www/wwwroot/www.xingxuan.cc/backend/data/xingxuan.db.bak-*
      ```
      → 把路径和大小记进 [07 号单](20260809-07-backfill-invoice-snapshots.md) 交付清单第 4 项

---

## 1 · 开门（真人登录）

- [ ] 浏览器打开 `https://www.xingxuan.cc/admin/login`，真人过滑块登录
      （两个开发都不代过滑块，CTO 已背书；这就是为什么要攒成一次跑完）

---

## 2 · 🔴 第一站：07 打印页抽查（go / no-go 闸门，只读）

**为什么最先做**：07 已