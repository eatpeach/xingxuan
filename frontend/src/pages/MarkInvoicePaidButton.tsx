import { useState } from 'react'
import { Button, Popconfirm, message } from 'antd'
import { CheckCircleOutlined, UndoOutlined } from '@ant-design/icons'
import { api } from '../api'

/**
 * 「标记发票已收款 / 撤销」独立入口（20260810-11）。
 *
 * 🔴 刻意【不】从 Quotes.tsx import。markInvoicePaid 原本唯一的调用点在 Quotes.tsx，
 * 而那个页面已下线（全仓零 import 的死文件），等于没有任何可达入口——
 * 结果 customer_quotes.paid_at 对每张发票恒为 NULL，应收看板会把所有发票列成逾期（100% 假阳性）。
 * 本组件把入口放在能走到的地方（订单详情发票 Tab），后端 markInvoicePaid 已支持 paid=0/1，不改后端。
 */
export default function MarkInvoicePaidButton({
  quoteId,
  paid,
  onChange,
}: {
  quoteId: number
  paid: boolean
  onChange?: () => void
}) {
  const [busy, setBusy] = useState(false)

  const toggle = async (next: 0 | 1) => {
    setBusy(true)
    try {
      await api.post('markInvoicePaid', { id: quoteId, paid: next })
      message.success(next ? '已标记为已收款' : '已撤销收款')
      onChange?.()
    } catch (e: any) {
      message.error(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  if (paid) {
    return (
      <Popconfirm
        title="撤销收款？该发票会重新计入应收看板。"
        okText="撤销"
        cancelText="取消"
        onConfirm={() => toggle(0)}
      >
        <Button size="small" loading={busy} icon={<UndoOutlined />}>
          撤销收款
        </Button>
      </Popconfirm>
    )
  }

  return (
    <Popconfirm
      title="确认这张发票的款项已到账？"
      okText="确认已收"
      cancelText="取消"
      onConfirm={() => toggle(1)}
    >
      <Button type="primary" size="small" loading={busy} icon={<CheckCircleOutlined />}>
        标记已收款
      </Button>
    </Popconfirm>
  )
}
