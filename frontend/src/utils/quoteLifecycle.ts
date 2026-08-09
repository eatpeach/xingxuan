import dayjs from 'dayjs'

/**
 * 客户报价的「状态」与「有效期」口径（20260810-12）
 *
 * 抽成独立文件是因为商机详情的报价卡片和商机列表都要用同一套口径——
 * 两处各写一份迟早会不一致。**不从 `Quotes.tsx` import**（那个文件去留未决，
 * 照 06 号单抽 `IssueInvoiceButton` 的先例）。
 */

/**
 * `customer_quotes.status` 的全部取值。
 *
 * 摸底结论（B，2026-08-10，逐个 grep 确认写入点）：
 * - `draft`     —— 三处 INSERT 写死，绝大多数报价都是它
 * - `sent`      —— `sendCustomerQuote` 的 UPDATE，以及 `createCasualQuote` 直接 INSERT
 * - `confirmed` —— `importHistoricalOrder`（补录历史订单）写的，**是活的**
 * - `to_review` —— **全仓库零写入，死值**。只在读侧分支里出现（删除闸门、dashboard 计数）。
 *                  保留标签是为了万一有历史数据，清理死值是另一回事
 *
 * ⚠ `won` / `lost` 不是 `status` 的值，成交与否走的是另一列 `deal_status`。
 *   这两行是历史遗留，留着不碍事，别拿它们当 `status` 用。
 */
export const QUOTE_STATUS: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  to_review: { color: 'orange', text: '待审' },
  sent: { color: 'blue', text: '已发送' },
  confirmed: { color: 'success', text: '已确认' },
  won: { color: 'success', text: '已成交' },
  lost: { color: 'default', text: '未成交' },
}

/**
 * 状态标签。映射表里没有的值**回落显示原文**，不要吞掉——
 * 宁可显示个陌生字符串让人来问，也别假装它不存在。
 *
 * （`confirmed` 原先就是这么漏出去的：映射表里没有它，界面直接印英文原文。
 *   那是既有缺陷，12 号单顺手补的标签，不是 12 号单引入的。）
 */
export function quoteStatusTag(status?: string | null): { color: string; text: string } {
  return QUOTE_STATUS[status || ''] ?? { color: 'default', text: status || '-' }
}

type QuoteLike = {
  valid_until?: string | null
  deal_status?: string | null
}

/**
 * 报价是否已过有效期。
 *
 * 🔴 **只用于展示，绝不用来拦截任何操作。**
 * CTO 裁决（20260810-12）：业务上经常需要按老报价成交，拦了会挡住真实流程。
 *
 * 按【日期】比而不是按时间戳，两个原因：
 * 1. 「有效期到某天为止」这件事业务上本来就是按天算的
 * 2. 库里 `valid_until` 有两种写法——多数路径写 `YYYY-MM-DD 23:59:59`，
 *    而主路径（InquiryCompare）历史上写的是 **UTC** 时间戳（已在本单修掉，
 *    但**存量数据仍是旧值**）。按日期比能盖住其中大部分
 *
 * ⚠ **但盖不全，别当成完全免疫**（CTO 2026-08-10 复核指出，已验算）：
 *   `toISOString()` 的日期只在 UTC 跨过午夜时才和本地差一天，而本地
 *   **00:00 ~ 时区偏移整点**（UTC+7 是 07:00、UTC+8 是 08:00）正好落在这个窗口里。
 *   这段代码跑在浏览器，所以窗口大小取决于**操作者本地时区**：雅加达 7 小时、北京 8 小时。
 *   **凌晨那个窗口生成的存量报价，日期部分本身就少了一天，按日期比也救不回来**，
 *   它们仍会提前一天显示过期。影响面最多一天，CTO 裁决：不回刷，记录在案。
 *
 * 已成交（`deal_status = 'won'`）的不算过期——单子明确「状态不是已成单」才标。
 */
export function isQuoteExpired(q: QuoteLike | null | undefined): boolean {
  if (!q?.valid_until) return false
  if (q.deal_status === 'won') return false
  const d = dayjs(q.valid_until)
  if (!d.isValid()) return false
  return d.isBefore(dayjs(), 'day')
}

/** 有效期显示成 `YYYY-MM-DD`；没有则返回空串 */
export function quoteValidUntilText(q: QuoteLike | null | undefined): string {
  if (!q?.valid_until) return ''
  const d = dayjs(q.valid_until)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(q.valid_until).slice(0, 10)
}
