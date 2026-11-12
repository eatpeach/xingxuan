import { useState } from 'react'
import { Alert, Button, Input, InputNumber, Modal, Space, Tag, message } from 'antd'
import { api } from '../../api'
import { fmtMoney } from './DealConfirm'

/**
 * 客户直付工厂：应收工厂返佣（20261112）
 * 客户把货款直接打给工厂，我们的利润是差价 = 报价货品总额 − 工厂成本。
 * 系统自动算，可以手动改；工厂把差价打给我们后点「确认到账」才计入返佣收入。
 */
export default function FactoryRebatePanel({ order, canOperate, onDone }: { order: any; canOperate: boolean; onDone: () => void }) {
  const fr = order.factory_rebate
  const cur = order.currency || 'IDR'
  const [editOpen, setEditOpen] = useState(false)
  const [amt, setAmt] = useState<number | null>(null)
  const [remark, setRemark] = useState('')
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  if (!fr) return null
  const confirmed = !!fr.confirmed_at

  const call = async (action: string, data: any, ok: string) => {
    setSaving(true)
    try {
      await api.post(action, { order_id: order.id, ...data })
      message.success(ok)
      setEditOpen(false)
      setRevokeOpen(false)
      onDone()
    } catch {
      // 拦截器已提示
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ border: '1px solid #ffe7ba', background: '#fffbf0', borderRadius: 8, padding: 12, marginTop: 12 }}>
      <Space wrap size={8} style={{ marginBottom: 6 }}>
        <b>工厂返佣 · {order.no}</b>
        {confirmed ? <Tag color="success">已到账</Tag> : <Tag color="orange">待工厂打款</Tag>}
        <span className="muted" style={{ fontSize: 12 }}>客户直付工厂，我方利润 = 差价</span>
      </Space>
      <div style={{ fontSize: 13, lineHeight: 1.9 }}>
        报价货品 {fmtMoney(cur, fr.sell)} − 工厂成本 {fmtMoney(cur, fr.cost)} = 自动计算 {fmtMoney(cur, fr.auto)}
        <br />
        应收返佣：<b style={{ fontSize: 15, color: '#d46b08' }}>{fmtMoney(cur, fr.amount)}</b>
        {fr.manual != null && <Tag style={{ marginLeft: 6 }}>手动填写</Tag>}
        {fr.remark && <span className="muted"> · {fr.remark}</span>}
        {confirmed && (
          <span className="muted">
            {' '}
            · {fr.confirmed_by} {String(fr.confirmed_at).slice(0, 16)} 确认到账
          </span>
        )}
      </div>
      {fr.auto <= 0 && fr.missing_cost_lines === 0 && !confirmed && fr.manual == null && (
        <Alert
          style={{ marginTop: 6 }}
          type="info"
          showIcon
          message="报价单价和工厂成本一样，算不出差价"
          description="如果这单的利润是工厂按比例返点，点「修改金额」填上和工厂谈好的返佣金额。"
        />
      )}
      {fr.missing_cost_lines > 0 && !confirmed && fr.manual == null && (
        <Alert
          style={{ marginTop: 6 }}
          type="warning"
          showIcon
          message={`有 ${fr.missing_cost_lines} 行没填成本价，自动算出的返佣偏大`}
          description="在「修改报价单」里补上成本价，或者直接手动填返佣金额。"
        />
      )}
      <Space style={{ marginTop: 8 }} wrap>
        {!confirmed && (
          <>
            <Button
              size="small"
              disabled={!canOperate}
              onClick={() => {
                setAmt(fr.manual ?? fr.auto)
                setRemark(fr.remark || '')
                setEditOpen(true)
              }}
            >
              修改金额
            </Button>
            <Button
              size="small"
              type="primary"
              disabled={!canOperate || fr.amount <= 0}
              style={canOperate && fr.amount > 0 ? { background: '#52c41a', borderColor: '#52c41a' } : undefined}
              onClick={() =>
                Modal.confirm({
                  title: '确认工厂返佣已到账？',
                  content: `工厂已把差价 ${fmtMoney(cur, fr.amount)} 打给我们？确认后计入工作台「工厂返佣」收入，金额就此定下。`,
                  okText: '确认到账',
                  cancelText: '取消',
                  zIndex: 1300,
                  onOk: () => call('confirmFactoryRebate', {}, '已确认返佣到账'),
                })
              }
            >
              返佣确认到账
            </Button>
          </>
        )}
        {confirmed && (
          <Button size="small" disabled={!canOperate} onClick={() => { setReason(''); setRevokeOpen(true) }}>
            撤销到账
          </Button>
        )}
        <span className="muted" style={{ fontSize: 12 }}>
          给工厂下单：用「对客报价」里的「按供应商拆分明细」打印给工厂即可
        </span>
      </Space>

      <Modal
        title="修改工厂返佣金额"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        zIndex={1300}
        footer={[
          <Button key="auto" onClick={() => call('setFactoryRebate', { amount: null, remark: '' }, '已恢复自动计算')}>
            恢复自动计算
          </Button>,
          <Button key="c" onClick={() => setEditOpen(false)}>取消</Button>,
          <Button key="ok" type="primary" loading={saving} onClick={() => call('setFactoryRebate', { amount: amt ?? 0, remark }, '已保存')}>
            保存
          </Button>,
        ]}
      >
        <div style={{ marginBottom: 8 }}>自动计算：{fmtMoney(cur, fr.auto)}</div>
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          value={amt ?? undefined}
          formatter={(v) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
          parser={(v) => Number(String(v || '').replace(/,/g, '')) as any}
          onChange={(v) => setAmt(v == null ? null : Number(v))}
        />
        <Input style={{ marginTop: 8 }} placeholder="备注（选填），如：和工厂谈好按 8% 返" value={remark} onChange={(e) => setRemark(e.target.value)} />
      </Modal>

      <Modal
        title="撤销返佣到账"
        open={revokeOpen}
        onCancel={() => setRevokeOpen(false)}
        zIndex={1300}
        okText="确认撤销"
        okButtonProps={{ danger: true, loading: saving }}
        onOk={() => {
          if (reason.trim().length < 2) return message.warning('请填写撤销原因')
          return call('revokeFactoryRebate', { reason: reason.trim() }, '已撤销')
        }}
      >
        <Input.TextArea rows={3} placeholder="撤销原因（必填）" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  )
}
