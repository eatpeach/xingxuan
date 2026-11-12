import { useEffect, useState } from 'react'
import { Button, Descriptions, Empty, Input, Modal, Space, Spin, Tag, Timeline, message } from 'antd'
import { CheckCircleOutlined, RollbackOutlined } from '@ant-design/icons'
import { api } from '../../api'

/**
 * 确认到账才算成交（20261112）
 * 开单后是「待付款（未成交）」，跟单确认客户已付款后点「确认到账」才计入成交 / 营收；
 * 点错了可以撤销，但必须写原因。每次操作都进成交操作记录（只能新增）。
 */

export interface DealInfo {
  order_id: number
  order_no: string
  amount: number
  currency: string
  confirmed: boolean
  last_action?: string
  last_action_label?: string
  last_action_at?: string | null
  last_action_by?: string
  payment_channel?: string
  paid_confirmed?: number
  can_operate?: boolean
}

const CHANNEL_LABEL: Record<string, string> = {
  company: '对公',
  private: '对私',
  private_idr: '对私-印尼盾',
  private_cny: '对私-人民币',
  factory: '客户直付工厂',
}

export const channelLabel = (c?: string) => (c ? CHANNEL_LABEL[c] || c : '未选择')

export function fmtMoney(cur: string, n: number) {
  const v = Number(n || 0)
  return cur === 'CNY'
    ? '¥ ' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : 'Rp ' + Math.round(v).toLocaleString('id-ID')
}

const QUICK_REASONS = ['点错了', '客户付款被退回', '到账金额不对', '客户取消订单']

/** 当前登录人能不能操作：管理员，或该商机的负责人（没指定负责人时以创建人为准） */
export function canOperateDeal(inq: { owner_id?: number; created_by?: number }) {
  if (localStorage.getItem('role') === 'admin') return true
  const uid = Number(localStorage.getItem('user_id') || 0)
  const owner = Number(inq.owner_id || 0) || Number(inq.created_by || 0)
  return !!uid && owner === uid
}

/** 商机管理列表 / 详情里的「确认到账 / 撤销」按钮 */
export function DealConfirmButton({
  deal,
  customer,
  title,
  onDone,
  size = 'small',
}: {
  deal: DealInfo
  customer: string
  title: string
  onDone: () => void
  size?: 'small' | 'middle'
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonErr, setReasonErr] = useState('')
  const [saving, setSaving] = useState(false)

  const noPerm = deal.can_operate === false
  const permTip = '只有这张单的负责人或管理员才能操作'

  const info = (
    <Descriptions size="small" column={1} bordered style={{ margin: '12px 0' }} labelStyle={{ width: 90 }}>
      <Descriptions.Item label="单号">{deal.order_no}</Descriptions.Item>
      <Descriptions.Item label="客户">{customer || '-'}</Descriptions.Item>
      <Descriptions.Item label="标题">{title || '-'}</Descriptions.Item>
      <Descriptions.Item label="订单金额">
        <b>{fmtMoney(deal.currency, deal.amount)}</b>
      </Descriptions.Item>
      <Descriptions.Item label="付款方式">{channelLabel(deal.payment_channel)}</Descriptions.Item>
    </Descriptions>
  )

  const doConfirm = async () => {
    setSaving(true)
    try {
      await api.post('confirmDealPayment', { order_id: deal.order_id })
      message.success('已确认到账，此单计为已成交')
      setConfirmOpen(false)
      onDone()
    } catch {
      // 拦截器已提示
    } finally {
      setSaving(false)
    }
  }

  const doRevoke = async () => {
    const r = reason.trim()
    if (r.length < 2) {
      setReasonErr('请填写撤销原因')
      return
    }
    setSaving(true)
    try {
      await api.post('revokeDealPayment', { order_id: deal.order_id, reason: r })
      message.success('已撤销成交，回到待付款（未成交）')
      setRevokeOpen(false)
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
      {deal.confirmed ? (
        <Button
          size={size}
          icon={<RollbackOutlined />}
          disabled={noPerm}
          title={noPerm ? permTip : undefined}
          onClick={(e) => {
            e.stopPropagation()
            setReason('')
            setReasonErr('')
            setRevokeOpen(true)
          }}
        >
          撤销
        </Button>
      ) : (
        <Button
          size={size}
          type="primary"
          icon={<CheckCircleOutlined />}
          disabled={noPerm}
          title={noPerm ? permTip : undefined}
          style={noPerm ? undefined : { background: '#52c41a', borderColor: '#52c41a' }}
          onClick={(e) => {
            e.stopPropagation()
            setConfirmOpen(true)
          }}
        >
          确认到账
        </Button>
      )}

      <Modal
        title="确认到账"
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        zIndex={1200}
        destroyOnClose
        footer={[
          <Button key="c" onClick={() => setConfirmOpen(false)}>
            取消
          </Button>,
          <Button
            key="ok"
            type="primary"
            loading={saving}
            onClick={doConfirm}
            style={{ background: '#52c41a', borderColor: '#52c41a' }}
          >
            确认到账，标记成交
          </Button>,
        ]}
      >
        {info}
        {Number(deal.paid_confirmed || 0) > 0 && (
          <div style={{ fontSize: 13, color: '#389e0d', marginBottom: 8 }}>
            财务已确认收款 {fmtMoney(deal.currency, Number(deal.paid_confirmed))}
          </div>
        )}
        <div style={{ lineHeight: 1.7 }}>
          确认客户已经付款？确认后此单计为已成交，计入工作台成交和营收。点错了可以撤销，但撤销时必须填写原因。
        </div>
      </Modal>

      <Modal
        title="撤销成交"
        open={revokeOpen}
        onCancel={() => setRevokeOpen(false)}
        zIndex={1200}
        destroyOnClose
        okText="确认撤销"
        okButtonProps={{ danger: true, loading: saving }}
        cancelText="取消"
        onOk={doRevoke}
      >
        {info}
        <div style={{ marginBottom: 8 }}>
          撤销后此单回到「待付款（未成交）」，不再计入成交和营收。<b>撤销原因（必填）</b>
        </div>
        <Space wrap size={6} style={{ marginBottom: 8 }}>
          {QUICK_REASONS.map((r) => (
            <Tag
              key={r}
              color={reason === r ? 'blue' : undefined}
              style={{ cursor: 'pointer', padding: '2px 10px' }}
              onClick={() => {
                setReason(r)
                setReasonErr('')
              }}
            >
              {r}
            </Tag>
          ))}
        </Space>
        <Input.TextArea
          rows={3}
          maxLength={200}
          showCount
          value={reason}
          status={reasonErr ? 'error' : undefined}
          placeholder="请填写撤销原因，至少 2 个字"
          onChange={(e) => {
            setReason(e.target.value)
            if (reasonErr && e.target.value.trim().length >= 2) setReasonErr('')
          }}
        />
        {reasonErr && <div style={{ color: '#ff4d4f', fontSize: 13, marginTop: 4 }}>{reasonErr}</div>}
      </Modal>
    </>
  )
}

/** 状态列下面的小字：最近一次谁、什么时候做了什么 */
export function DealLastAction({ deal }: { deal?: DealInfo | null }) {
  if (!deal || !deal.last_action_at) return null
  return (
    <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2, lineHeight: 1.4 }}>
      {deal.last_action_label || ''} · {deal.last_action_by || '系统'}
      <br />
      {String(deal.last_action_at).slice(0, 16)}
    </div>
  )
}

/** 商机详情里的「成交操作记录」 */
export function DealConfirmLogs({ inquiryId, refreshKey }: { inquiryId: number; refreshKey?: any }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!inquiryId) return
    setLoading(true)
    api
      .get('listDealConfirmLogs', { inquiry_id: inquiryId })
      .then((r) => setRows(r.items || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [inquiryId, refreshKey])

  const color: Record<string, string> = { confirm: 'green', revoke: 'red', migrate: 'gray', import: 'gray', migrate_rollback: 'gray' }
  return (
    <section className="inq-card">
      <div className="inq-card-title">
        成交操作记录 <span className="muted">（只能新增，不能修改或删除）</span>
      </div>
      <Spin spinning={loading}>
        {rows.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有确认到账 / 撤销记录" />
        ) : (
          <Timeline
            style={{ marginTop: 8 }}
            items={rows.map((r) => ({
              color: color[r.action] || 'blue',
              children: (
                <div>
                  <Space size={8} wrap>
                    <b>{r.action_label}</b>
                    <span>{r.user_name || '系统'}</span>
                    <span className="muted">{String(r.created_at).slice(0, 16)}</span>
                    {r.order_no && <span className="muted">订单 {r.order_no}</span>}
                    <span className="muted">{fmtMoney(r.currency || 'IDR', Number(r.amount || 0))}</span>
                  </Space>
                  {r.reason && <div style={{ color: r.action === 'revoke' ? '#cf1322' : '#666', marginTop: 2 }}>原因：{r.reason}</div>}
                </div>
              ),
            }))}
          />
        )}
      </Spin>
    </section>
  )
}
