import { useState } from 'react'
import { Button, Popconfirm, message } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import { api } from '../api'

/**
 * 「发送给客户」按钮（20260810-12）
 *
 * 后端 `sendCustomerQuote` 一直是好的，缺的只是入口——它此前只被 `Quotes.tsx`
 * 调用，而那个文件全仓库零 import、零路由，等于没人能走到。
 * 于是所有报价永远停在 `draft`，`sent_at` 永远为空，
 * 答不出「这张报价什么时候发出去的」「哪些发了还没回音」。
 *
 * 抽成独立文件、**不从 `Quotes.tsx` import**：那个文件的去留仍未决，
 * 从它 import 会把这个决策绑死（照 06 号单抽 `IssueInvoiceButton` 的先例）。
 *
 * 🔴 语义：**只改本系统的状态，不真的给客户发任何东西**（不发邮件、不发短信）。
 * 这一版是「销售确认已经发出去了」的手工标记。按钮文案和二次确认都按这个说法写，
 * 免得操作者以为点一下系统就替他发了。
 */

type Props = {
  /** 整条报价记录（至少要有 id / no / status） */
  quote: { id: number; no?: string; status?: string | null }
  /** 成功后回调，用来刷新详情/列表 */
  onSent: () => void
}

export default function SendQuoteButton({ quote, onSent }: Props) {
  const [loading, setLoading] = useState(false)

  // 本单只做 draft → sent 这一步（CTO 2026-08-10 批准）。
  // 已发送 / 已确认的不再显示按钮——「客户已接受/已拒绝」是更大的设计，本单明确不做。
  if (quote.status !== 'draft') return null

  const send = async () => {
    setLoading(true)
    try {
      await api.post('sendCustomerQuote', { id: quote.id })
      message.success(`${quote.no || '报价'} 已标记为发送给客户`)
      onSent()
    } catch (e: any) {
      // 失败必须让操作者看得见：02 / 05 / 06 三张单都踩过「后端拒绝但界面毫无反应」的坑。
      // api 拦截器已经 toast 过一次，这里只兜住拦截器没覆盖的情况（如 success:false）。
      message.error(e?.message || '标记失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Popconfirm
      title="标记为已发送给客户"
      description="仅在系统里记录「已发出」和发送时间，不会真的给客户发邮件或短信。"
      okText="确认已发出"
      cancelText="取消"
      onConfirm={send}
      // AntD 层级 bug：Drawer 内的浮层要抬 zIndex，否则被 Drawer 盖住（见 CLAUDE.md）
      zIndex={9999}
    >
      <Button icon={<SendOutlined />} loading={loading}>
        发送给客户
      </Button>
    </Popconfirm>
  )
}
