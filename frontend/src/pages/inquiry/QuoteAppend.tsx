import { useEffect, useState } from 'react'
import { Alert, Button, Input, InputNumber, Modal, Space, Table, Tag, Timeline, Typography, message } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { api } from '../../api'

/**
 * 报价单锁定 + 追加物料（20261112）
 * 报价单提交（发送客户 / 已开单）后锁定，不能直接改货品。客户要加产品：
 *  - 新建商机重新报价，或
 *  - 在这里「追加物料」：只加新行、不动原有行，追加后进「待审批」，管理员通过才生效
 */

/** 报价单是否已锁定（与后端 quoteIsLocked 一致；有订单的情况由后端兜底） */
export function isQuoteLocked(q: any, hasOrder = false) {
  return ['sent', 'confirmed', 'to_review'].includes(q?.status) || q?.deal_status === 'won' || hasOrder
}

const isAdmin = () => localStorage.getItem('role') === 'admin'
const money = (cur: string, n: number) =>
  (cur === 'CNY' ? '¥ ' : 'Rp ') + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: cur === 'CNY' ? 2 : 0 })

const blank = () => ({ product_name: '', spec: '', unit: '件', qty: 1, cost_price: 0, sell_price: 0, lead_time: '', remark: '' })

export function AppendQuoteItemsButton({ quote, onDone }: { quote: any; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<any[]>([blank()])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const cur = quote?.currency || 'IDR'
  const pendingReview = quote?.status === 'to_review'
  const upd = (i: number, patch: any) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addTotal = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.sell_price) || 0), 0)

  const submit = async () => {
    const valid = rows.filter((r) => String(r.product_name).trim())
    if (!valid.length) return message.warning('请至少填一行物料')
    if (valid.some((r) => Number(r.qty) <= 0)) return message.warning('数量必须大于 0')
    setSaving(true)
    try {
      const r = await api.post('appendQuoteItems', { quote_id: quote.id, items: valid, reason: reason.trim() })
      message.success(`已追加 ${r.count} 项，报价单进入「待审批」，管理员通过后生效`, 6)
      if (r.invoice_voided) {
        Modal.warning({
          title: `原发票 ${r.invoice_voided} 已作废`,
          content: '追加了物料，金额变了，原发票对不上，系统已自动作废。审批通过后请重新开具发票。',
          zIndex: 1300,
        })
      }
      setOpen(false)
      setRows([blank()])
      setReason('')
      onDone()
    } catch {
      // 拦截器已提示
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        icon={<PlusOutlined />}
        disabled={pendingReview}
        title={pendingReview ? '上一批追加还在待审批' : '报价单已锁定，只能追加新物料（需审批）'}
        onClick={() => setOpen(true)}
      >
        追加物料
      </Button>
      <Modal
        title={`追加物料 · ${quote?.no}`}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="提交审批"
        confirmLoading={saving}
        width={1000}
        zIndex={1200}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="报价单已提交锁定，原有货品不能改，只能追加新物料"
          description="追加后报价单进入「待审批」，管理员审批通过才生效；驳回则这批追加的物料会被撤掉。客户要大改，建议新建商机重新报价。"
        />
        <Table
          size="small"
          rowKey={(_, i) => String(i)}
          pagination={false}
          dataSource={rows}
          columns={[
            { title: '产品名 *', width: 200, render: (_: any, r: any, i: number) => <Input size="small" value={r.product_name} onChange={(e) => upd(i, { product_name: e.target.value })} /> },
            { title: '规格', width: 150, render: (_: any, r: any, i: number) => <Input size="small" value={r.spec} onChange={(e) => upd(i, { spec: e.target.value })} /> },
            { title: '数量 *', width: 90, render: (_: any, r: any, i: number) => <InputNumber size="small" min={0} style={{ width: '100%' }} value={r.qty} onChange={(v) => upd(i, { qty: Number(v ?? 0) })} /> },
            { title: '单位', width: 70, render: (_: any, r: any, i: number) => <Input size="small" value={r.unit} onChange={(e) => upd(i, { unit: e.target.value })} /> },
            { title: '成本价', width: 120, render: (_: any, r: any, i: number) => <InputNumber size="small" min={0} style={{ width: '100%' }} value={r.cost_price} onChange={(v) => upd(i, { cost_price: Number(v ?? 0) })} /> },
            { title: '单价 *', width: 120, render: (_: any, r: any, i: number) => <InputNumber size="small" min={0} style={{ width: '100%' }} value={r.sell_price} onChange={(v) => upd(i, { sell_price: Number(v ?? 0) })} /> },
            { title: '小计', width: 120, align: 'right' as const, render: (_: any, r: any) => money(cur, (Number(r.qty) || 0) * (Number(r.sell_price) || 0)) },
            { title: '备注', render: (_: any, r: any, i: number) => <Input size="small" value={r.remark} onChange={(e) => upd(i, { remark: e.target.value })} /> },
            { title: '', width: 40, render: (_: any, __: any, i: number) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setRows((p) => p.filter((_, x) => x !== i))} /> },
          ]}
          footer={() => (
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setRows((p) => [...p, blank()])}>
                再加一行
              </Button>
              <span>
                本次追加 <b style={{ color: '#1d57e0' }}>{money(cur, addTotal)}</b>
                <span className="muted" style={{ fontSize: 12 }}>（运费按报价单的运费方式重新分摊）</span>
              </span>
            </Space>
          )}
        />
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary">追加说明（选填）</Typography.Text>
          <Input.TextArea rows={2} style={{ marginTop: 4 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：客户现场临时补 20 盒自攻钉" />
        </div>
      </Modal>
    </>
  )
}

/** 待审批提示 + 管理员审批 + 修改日志 */
export function QuoteAppendPanel({ quote, onDone }: { quote: any; onDone: () => void }) {
  const [logs, setLogs] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const cur = quote?.currency || 'IDR'
  const pendingReview = quote?.status === 'to_review'

  const loadLogs = () =>
    api
      .get('listQuoteAppendLogs', { quote_id: quote.id })
      .then((r) => setLogs(r.items || []))
      .catch(() => {})
  useEffect(() => {
    loadLogs()
  }, [quote?.id, quote?.status, quote?.total])

  if (!pendingReview && logs.length === 0) return null
  const lastAppend = logs.find((l) => l.action === 'append')

  const review = (decision: 'approve' | 'reject', remark = '') => {
    setSaving(true)
    return api
      .post('reviewQuoteAppend', { quote_id: quote.id, decision, remark })
      .then(() => {
        message.success(decision === 'approve' ? '已审批通过，追加的物料生效' : '已驳回，追加的物料已撤掉')
        onDone()
      })
      .finally(() => setSaving(false))
  }
  const reject = () => {
    let remark = ''
    Modal.confirm({
      title: '驳回追加的物料',
      zIndex: 1300,
      content: <Input.TextArea rows={3} placeholder="驳回原因（必填）" onChange={(e) => (remark = e.target.value)} />,
      okText: '确认驳回',
      okButtonProps: { danger: true },
      onOk: () => {
        if (remark.trim().length < 2) {
          message.warning('请填写驳回原因')
          return Promise.reject()
        }
        return review('reject', remark.trim())
      },
    })
  }

  return (
    <div style={{ marginTop: 8 }}>
      {pendingReview && (
        <Alert
          type="warning"
          showIcon
          message={`有追加物料待审批${lastAppend ? `：${lastAppend.user_name} 追加了 ${lastAppend.item_count} 项` : ''}`}
          description={
            <div>
              {lastAppend && (
                <div style={{ marginBottom: 8 }}>
                  {lastAppend.items.map((it: any, i: number) => (
                    <div key={i} style={{ fontSize: 12 }}>
                      + {it.product_name} {it.spec} · {it.qty} {it.unit} × {money(cur, it.sell_price)}
                    </div>
                  ))}
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    报价总额 {money(cur, lastAppend.total_before)} → <b>{money(cur, lastAppend.total_after)}</b>
                    {lastAppend.remark ? ` · ${lastAppend.remark}` : ''}
                  </div>
                </div>
              )}
              {isAdmin() ? (
                <Space>
                  <Button size="small" type="primary" loading={saving} onClick={() => review('approve')}>
                    审批通过
                  </Button>
                  <Button size="small" danger onClick={reject}>
                    驳回
                  </Button>
                </Space>
              ) : (
                <span style={{ fontSize: 12 }}>等管理员审批，审批前不能再修改或追加</span>
              )}
            </div>
          }
        />
      )}
      {logs.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#666' }}>修改日志（{logs.length} 条，只能新增，不能修改或删除）</summary>
          <Timeline
            style={{ marginTop: 10 }}
            items={logs.map((l) => ({
              color: l.action === 'reject' ? 'red' : l.action === 'approve' ? 'green' : 'blue',
              children: (
                <div style={{ fontSize: 12 }}>
                  <Space size={6} wrap>
                    <Tag style={{ marginInlineEnd: 0 }}>第 {l.batch} 批</Tag>
                    <b>{l.action_label}</b>
                    <span>{l.user_name}</span>
                    <span className="muted">{String(l.created_at).slice(0, 16)}</span>
                    <span className="muted">
                      {money(cur, l.total_before)} → {money(cur, l.total_after)}
                    </span>
                  </Space>
                  {l.action === 'append' &&
                    l.items.map((it: any, i: number) => (
                      <div key={i} className="muted">
                        + {it.product_name} {it.spec} · {it.qty} {it.unit} × {money(cur, it.sell_price)}
                      </div>
                    ))}
                  {l.remark && <div className="muted">说明：{l.remark}</div>}
                </div>
              ),
            }))}
          />
        </details>
      )}
    </div>
  )
}
