# 25 · 收款环节改造（首款≥50% + 收款账户跟随系统设置）

状态：✅ 完成（待生产 deploy）

## 背景
商机 → 订单履约 → 收款（Orders.tsx PaymentTab）原本是「记一笔钱」：
类型 + 金额 + 自由填付款方式 + 备注。参考斑兔收款环节改造。

## 改动
- **付款比例**：全款 100% / 手写(≥50) / 50%（比例 × 订单总额 = 建议金额，可改）；去掉 25% / 0%
- **收款账户**：从系统设置 `payment_accounts`（active，按订单币种过滤）下拉选；
  去掉自由填「付款方式」文本框（方式由所选账户带出）
- **收款方抬头**：固定「星选建材」（读 `system_settings.company_name`，只读展示）
- **首款门槛**：本单第一笔收款 < 订单总额 50% 拒绝（前端 message + 后端 jsonError 双拦，
  容差 `amt + 0.005 < total*0.5`）；后续补款不限
- **合同模板**：定金「30%」→「50%」（中文 body_cn + 印尼文 body_id）
- **DB**：`payments` 加 `payment_ratio TEXT` / `account_id INTEGER`（建表 + migrate ALTER，幂等）
- **存量**：老收款记录不动，新规则只对新收款生效

## 文件
- `backend/config/database.php`（payments 建表 + migrate 加列）
- `backend/api/handlers/order.php`（handle_addPayment 首款校验 + 新列 INSERT；合同模板 50%）
- `frontend/src/pages/Orders.tsx`（PaymentTab 重构 + 调用处传 total/currency）

## 验证
- `php -l` order.php / database.php 通过
- `npm run build` 通过
- INSERT payments 9 列 = 9 占位符 = 9 参数，手核一致

## 待办
- 生产 `bash deploy.sh`（首访 migrate 自动加列 + 重启 PHP-FPM 让 order.php 新逻辑生效）
