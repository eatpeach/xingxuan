import { useState } from 'react'
import { Alert, Button, Input, Modal, Space, Table, Typography, message } from 'antd'
import { CarOutlined } from '@ant-design/icons'
import { api } from '../../api'
import { FREIGHT_MODE_OPTIONS, freightAllocate } from '../../utils/freight'
import type { FreightMode } from '../../utils/freight'
import { FreightPicker } from './DealTerms'

/**
 * 对客报价页的运费设置（20261112）
 * 运费方式：到付 / 加进单价 / 我方承担。加进单价时按金额权重分摊，实时显示每行占比、分到运费、含运费单价、小计（含尾差）。
 * 锁定规则同改明细：报价单提交后只有管理员能改，且必须写原因。
 */

const money = (cur: string, n: number) =>
  (cur === 'CNY' ? '¥ ' : 'Rp ') +
  Number(n || 0).toLocaleString(undefined, cur === 'CNY' ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })

/** 报价卡片上的运费标签 */
export function freightTagText(q: any) {
  const label = FREIGHT_MODE_OPTIONS.find((o) => o.value === (q?.freight_mode || 'collect'))?.label || '到付'
  const amt = Number(q?.freight_amount || 0)
  return q?.freight_mode && q.freight_mode !== 'collect' && amt > 0 ? `运费：${label} ${money(q.currency, amt)}` : `运费：${label}`
}

export default function QuoteFreightButton({ quote, locked, onDone }: { quote: any; locked: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<any[]>([])
  const [mode, setMode] = useState<FreightMode>('collect')
  const [amount, setAmount] = useState(0)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const cur = quote?.currency || 'IDR'
  const isAdmin = localStorage.getItem('role') === 'admin'
  const canEdit = (!locked || isAdmin) && quote?.status !== 'to_review'

  const show = async () => {
    const r = await api.get('getCustomerQuote', { id: quote.id })
    setItems(r.data?.items || [])
    setMode((r.data?.freight_mode || 'collect') as FreightMode)
    setAmount(Number(r.data?.freight_amount || 0))
    setReason('')
    setOpen(true)
  }

  const alloc = freightAllocate(
    items.map((it) => ({ qty: Number(it.qty) || 0, price: Number(it.sell_price) || 0 })),
    mode === 'in_price' ? amount : 0,
    cur,
  )
  const goodsCost = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost_price) || 0), 0)
  const margin = alloc.goods_total - goodsCost - (mode === 'absorb' ? amount : 0)
  const inPrice = mode === 'in_price' && amount > 0

  const save = async () => {
    if (locked && !reason.trim()) return message.warning('这张报价单已提交，修改运费必须填写原因')
    setSaving(true)
    try {
      const r = await api.post('updateQuoteFreight', { quote_id: quote.id, freight_mode: mode, freight_amount: mode === 'collect' ? 0 : amount, reason: reason.trim() })
      message.success(`运费已更新：${money(cur, r.total_before)} → ${money(cur, r.total_after)}`)
      if (r.invoice_voided) {
        Modal.warning({ title: `原发票 ${r.invoice_voided} 已作废`, content: '运费变了，报价总额跟着变，原发票对不上，已自动作废，请重新开具。', zIndex: 1300 })
      }
      setOpen(false)
      onDone()
    } catch {
      // 拦截器已提示
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button size="middle" icon={<CarOutlined />} onClick={show}>
        {canEdit ? '设置运费' : '运费分摊'}
      </Button>
      <Modal
        title={`运费 · ${quote?.no}`}
        open={open}
        onCancel={() => setOpen(false)}
        width={inPrice ? 1000 : 760}
        zIndex={1200}
        destroyOnClose
        okText="保存运费"
        okButtonProps={{ disabled: !canEdit, loading: saving }}
        onOk={save}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {!canEdit && (
            <Alert
              type="info"
              showIcon
              message={quote?.status === 'to_review' ? '报价单有追加物料待审批，审批后才能改运费' : '报价单已提交锁定，运费只有管理员能改'}
            />
          )}
          <div style={{ pointerEvents: canEdit ? undefined : 'none', opacity: canEdit ? 1 : 0.7 }}>
            <FreightPicker value={{ mode, amount }} onChange={(v) => { setMode(v.mode); setAmount(v.amount) }} currency={cur} />
          </div>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            scroll={{ y: 320 }}
            dataSource={items}
            columns={[
              { title: '产品', dataIndex: 'product_name', ellipsis: true },
              { title: '数量', width: 90, render: (_: any, it: any) => `${Number(it.qty).toLocaleString()} ${it.unit || ''}` },
              { title: '原单价', width: 110, align: 'right' as const, render: (_: any, it: any) => money(cur, Number(it.sell_price)) },
              ...(inPrice
                ? [
                    { title: '金额占比', width: 80, align: 'right' as const, render: (_: any, __: any, i: number) => `${((alloc.lines[i]?.share || 0) * 100).toFixed(1)}%` },
                    { title: '分到运费', width: 110, align: 'right' as const, render: (_: any, __: any, i: number) => money(cur, alloc.lines[i]?.alloc || 0) },
                    {
                      title: '含运费单价',
                      width: 120,
                      align: 'right' as const,
                      render: (_: any, __: any, i: number) => <span style={{ color: '#1d57e0' }}>{money(cur, alloc.lines[i]?.price_with_freight || 0)}</span>,
                    },
                  ]
                : []),
              {
                title: '小计',
                width: 140,
                align: 'right' as const,
                render: (_: any, __: any, i: number) => {
                  const l = alloc.lines[i]
                  return (
                    <div>
                      <b>{money(cur, l?.subtotal || 0)}</b>
                      {l && Math.abs(l.tail) > 0.0001 && (
                        <div style={{ fontSize: 11, color: '#d46b08' }}>
                          含尾差 {l.tail > 0 ? '+' : '−'}
                          {money(cur, Math.abs(l.tail)).replace(/^(Rp|¥) /, '')}
                        </div>
                      )}
                    </div>
                  )
                },
              },
            ]}
          />
          <Space size={20} wrap style={{ justifyContent: 'flex-end', width: '100%' }}>
            <span className="muted">货品 {money(cur, alloc.goods_total)}</span>
            {inPrice && <span className="muted">+ 运费 {money(cur, alloc.freight)}</span>}
            <span className="muted" title="毛利按原单价算，不含运费；我方承担的运费从毛利里扣">毛利 {money(cur, margin)}</span>
            <span>
              报价总额 <b style={{ fontSize: 16, color: '#1d57e0' }}>{money(cur, alloc.total)}</b>
            </span>
          </Space>
          {locked && canEdit && (
            <div>
              <Typography.Text type="secondary">修改原因 *（报价单已提交）</Typography.Text>
              <Input.TextArea rows={2} style={{ marginTop: 4 }} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
        </Space>
      </Modal>
    </>
  )
}
