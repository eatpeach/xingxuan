import { useEffect, useState } from 'react'
import { Alert, Button, Input, InputNumber, Modal, Space, Table, Tag, Timeline, Typography, message } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { api } from '../api'
import { DragHandle, dndStyles, reorder, useRowDnd } from '../utils/rowDnd'

/**
 * 修改报价单明细（成交/收款之后也能改）—— 20260824
 *
 * 老板反馈：客户付款后经常还会加减产品/改数量，以前只能删单重开，
 * 会把发票号、订单、收款记录全断链。这里原地改、留痕、同步订单金额。
 */
export default function EditQuoteItemsButton({
  quote,
  onSaved,
  size,
  type,
}: {
  quote: any
  onSaved: () => void
  size?: 'small' | 'middle' | 'large'
  type?: 'default' | 'link' | 'text' | 'primary'
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<any[]>([])
  const [reason, setReason] = useState('')
  const [revisions, setRevisions] = useState<any[]>([])
  const [detail, setDetail] = useState<any>(null)

  const cur = detail?.currency || quote?.currency || 'IDR'
  const sym = cur === 'CNY' ? '¥' : 'Rp'
  const fmt = (n: number) => `${sym} ${Math.round(n).toLocaleString()}`

  const isPaid = !!(detail?.paid_at || quote?.paid_at)
  const isWon = (detail?.deal_status || quote?.deal_status) === 'won'
  const reasonRequired = isPaid || isWon

  const oldTotal = Number(detail?.total ?? quote?.total ?? 0)
  const newTotal = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.sell_price) || 0), 0)
  const diff = newTotal - oldTotal

  const load = async () => {
    setLoading(true)
    try {
      const [d, rev] = await Promise.all([
        api.get('getCustomerQuote', { id: quote.id }),
        api.get('listQuoteRevisions', { quote_id: quote.id }).catch(() => ({ items: [] })),
      ])
      setDetail(d.data)
      setRows(
        (d.data.items || []).map((it: any) => ({
          inquiry_item_id: it.inquiry_item_id,
          product_name: it.product_name || '',
          spec: it.spec || '',
          unit: it.unit || '件',
          qty: Number(it.qty) || 1,
          cost_price: Number(it.cost_price) || 0,
          sell_price: Number(it.sell_price) || 0,
          brand_display: it.brand_display || '',
          model_display: it.model_display || '',
          show_brand: it.show_brand ?? 1,
          lead_time: it.lead_time || '',
          remark: it.remark || '',
        })),
      )
      setRevisions(rev.items || [])
      setReason('')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  const upd = (i: number, patch: any) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const moveRow = (from: number, to: number) => setRows((p) => reorder(p, from, to))
  const rowDnd = useRowDnd(moveRow)
  const addRow = () =>
    setRows((p) => [...p, { product_name: '', spec: '', unit: '件', qty: 1, sell_price: 0, cost_price: 0, show_brand: 1, lead_time: '' }])
  const delRow = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i))

  const submit = async () => {
    const valid = rows.filter((r) => String(r.product_name || '').trim())
    if (valid.length === 0) return message.warning('至少保留一行有产品名的明细')
    if (valid.some((r) => Number(r.qty) <= 0)) return message.warning('数量必须大于 0')
    if (reasonRequired && !reason.trim()) return message.warning('这张单已成交/已收款，必须填写修改原因')

    setSaving(true)
    try {
      const r = await api.post('updateQuoteItems', {
        quote_id: quote.id,
        items: valid,
        reason: reason.trim(),
      })
      const d = Number(r.diff || 0)
      message.success(
        `已保存（第 ${r.rev_no} 次修改）：${fmt(Number(r.total_before))} → ${fmt(Number(r.total_after))}` +
          (d !== 0 ? `，${d > 0 ? '增加' : '减少'} ${fmt(Math.abs(d))}` : '') +
          (r.order_synced ? `；订单 ${r.order_synced} 金额已同步` : ''),
        6,
      )
      setOpen(false)
      onSaved()
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button size={size} type={type as any} icon={<EditOutlined />} onClick={() => setOpen(true)}>
        修改报价单
      </Button>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okText="保存修改"
        cancelText="取消"
        width={1080}
        destroyOnClose
        title={
          <Space>
            <span>修改报价单 {quote?.no}</span>
            {isPaid && <Tag color="green">已收款</Tag>}
            {!isPaid && isWon && <Tag color="blue">已成交</Tag>}
            {revisions.length > 0 && <Tag>已改过 {revisions.length} 次</Tag>}
          </Space>
        }
      >
        {loading ? (
          '加载中...'
        ) : (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            {reasonRequired && (
              <Alert
                type="warning"
                showIcon
                message={isPaid ? '这张报价单已经收过款' : '这张报价单已成交并生成订单'}
                description={
                  <span style={{ fontSize: 12 }}>
                    改动会同步更新订单金额和应收款，<strong>但不会动发票号、收款记录和已收金额</strong>。
                    每次修改都会完整留痕（改前改后明细都存档）。
                  </span>
                }
              />
            )}

            <div className="muted" style={{ fontSize: 12, color: '#8c8c8c' }}>按住 ⠿ 上下拖动可调整顺序，顺序会体现在打印出的报价单上</div>
            <style>{dndStyles}</style>
            <Table
              size="small"
              rowKey={(_, i) => String(i)}
              dataSource={rows}
              pagination={false}
              scroll={{ y: 340 }}
              onRow={(_, index) => rowDnd.rowProps(index as number)}
              columns={[
                { title: '', width: 32, align: 'center' as const, render: () => <DragHandle /> },
                { title: '#', width: 40, render: (_: any, __: any, i: number) => i + 1 },
                {
                  title: '产品名 *',
                  width: 200,
                  render: (_: any, r: any, i: number) => (
                    <Input size="small" value={r.product_name} onChange={(e) => upd(i, { product_name: e.target.value })} />
                  ),
                },
                {
                  title: '规格',
                  width: 170,
                  render: (_: any, r: any, i: number) => (
                    <Input size="small" value={r.spec} onChange={(e) => upd(i, { spec: e.target.value })} />
                  ),
                },
                {
                  title: '数量 *',
                  width: 100,
                  render: (_: any, r: any, i: number) => (
                    <InputNumber size="small" min={0} value={r.qty} style={{ width: '100%' }}
                      onChange={(v) => upd(i, { qty: Number(v ?? 0) })} />
                  ),
                },
                {
                  title: '单位',
                  width: 70,
                  render: (_: any, r: any, i: number) => (
                    <Input size="small" value={r.unit} onChange={(e) => upd(i, { unit: e.target.value })} />
                  ),
                },
                {
                  title: `单价(${sym}) *`,
                  width: 130,
                  render: (_: any, r: any, i: number) => (
                    <InputNumber size="small" min={0} value={r.sell_price} style={{ width: '100%' }}
                      onChange={(v) => upd(i, { sell_price: Number(v ?? 0) })} />
                  ),
                },
                {
                  title: '小计',
                  width: 130,
                  render: (_: any, r: any) => (
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmt((Number(r.qty) || 0) * (Number(r.sell_price) || 0))}
                    </strong>
                  ),
                },
                {
                  title: '交期',
                  width: 110,
                  render: (_: any, r: any, i: number) => (
                    <Input size="small" placeholder="同整单" value={r.lead_time}
                      onChange={(e) => upd(i, { lead_time: e.target.value })} />
                  ),
                },
                {
                  title: '备注',
                  render: (_: any, r: any, i: number) => (
                    <Input size="small" value={r.remark} onChange={(e) => upd(i, { remark: e.target.value })} />
                  ),
                },
                {
                  title: '排序',
                  width: 72,
                  align: 'center' as const,
                  render: (_: any, __: any, i: number) => (
                    <Space size={2}>
                      <Button size="small" type="text" disabled={i === 0} onClick={() => moveRow(i, i - 1)}>↑</Button>
                      <Button size="small" type="text" disabled={i === rows.length - 1} onClick={() => moveRow(i, i + 1)}>↓</Button>
                    </Space>
                  ),
                },
                {
                  title: '',
                  width: 40,
                  render: (_: any, __: any, i: number) => (
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => delRow(i)} />
                  ),
                },
              ]}
              footer={() => (
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addRow}>
                    添加一行
                  </Button>
                  <Space size={16}>
                    <span className="muted" style={{ fontSize: 12 }}>原金额 {fmt(oldTotal)}</span>
                    <span style={{ fontSize: 15 }}>
                      新金额 <strong style={{ color: '#1d57e0' }}>{fmt(newTotal)}</strong>
                    </span>
                    {Math.abs(diff) > 0.001 && (
                      <Tag color={diff > 0 ? 'red' : 'green'} style={{ marginInlineEnd: 0 }}>
                        {diff > 0 ? '+' : '−'} {fmt(Math.abs(diff))}
                      </Tag>
                    )}
                  </Space>
                </Space>
              )}
            />

            <div>
              <Typography.Text type="secondary">
                修改原因{reasonRequired ? ' *' : '（可选）'}
              </Typography.Text>
              <Input.TextArea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="如：客户付款后临时加了 2 卷电缆 / 现场实测少用 30 米，退差价"
                style={{ marginTop: 4 }}
              />
            </div>

            {revisions.length > 0 && (
              <div>
                <Typography.Text strong style={{ fontSize: 13 }}>修改历史</Typography.Text>
                <Timeline
                  style={{ marginTop: 8 }}
                  items={revisions.map((rv: any) => ({
                    color: rv.was_paid ? 'red' : 'blue',
                    children: (
                      <div style={{ fontSize: 12 }}>
                        <Space size={6} wrap>
                          <Tag style={{ marginInlineEnd: 0 }}>v{rv.rev_no}</Tag>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {fmt(Number(rv.total_before))} → <strong>{fmt(Number(rv.total_after))}</strong>
                          </span>
                          {rv.was_paid ? <Tag color="red" style={{ marginInlineEnd: 0 }}>收款后改动</Tag> : null}
                        </Space>
                        <div className="muted" style={{ marginTop: 2 }}>
                          {rv.user_name || '—'} · {String(rv.created_at || '').slice(0, 16)}
                          {rv.reason ? ` · ${rv.reason}` : ''}
                        </div>
                      </div>
                    ),
                  }))}
                />
              </div>
            )}
          </Space>
        )}
      </Modal>
    </>
  )
}
