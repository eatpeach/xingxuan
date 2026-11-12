import { useEffect, useState } from 'react'
import { Alert, InputNumber, Modal, Radio, Select, Space, Switch, Typography, message } from 'antd'
import { api } from '../../api'
import { FREIGHT_MODE_HINT, FREIGHT_MODE_OPTIONS } from '../../utils/freight'
import type { FreightMode } from '../../utils/freight'

/**
 * 付款方式 / 收款账户 / 运费方式（20261112）
 * 新建商机、编辑商机概览、开单三个地方共用。
 *
 * 付款方式 → 自动带出（都允许手动改）：
 *   对公         → 对公账户，加 PPN 11%
 *   对私-印尼盾  → 印尼盾私户，不加 PPN
 *   对私-人民币  → 人民币私户，币种切人民币，不加 PPN
 *   客户直付工厂 → 不选、也不在报价单 / 发票上显示我方任何银行账号
 */

export type PaymentChannel = 'company' | 'private_idr' | 'private_cny' | 'factory'

export const PAYMENT_CHANNEL_OPTIONS: { value: PaymentChannel; label: string }[] = [
  { value: 'company', label: '对公' },
  { value: 'private_idr', label: '对私-印尼盾' },
  { value: 'private_cny', label: '对私-人民币' },
  { value: 'factory', label: '客户直付工厂' },
]

/** 付款方式对应的账户类型（payment_accounts.type） */
const CHANNEL_ACCOUNT_TYPES: Record<string, string[]> = {
  company: ['idr_public', 'rmb_public'],
  private_idr: ['idr_private'],
  private_cny: ['rmb_private'],
}

/** 老数据里的 private 按币种归 */
export function normChannel(v?: string, currency?: string): PaymentChannel | '' {
  if (v === 'private') return String(currency).toUpperCase() === 'CNY' ? 'private_cny' : 'private_idr'
  return (['company', 'private_idr', 'private_cny', 'factory'].includes(v || '') ? v : '') as any
}

/** 选了付款方式后自动带出的默认值 */
export function channelDefaults(ch: PaymentChannel, accounts: any[]) {
  const types = CHANNEL_ACCOUNT_TYPES[ch] || []
  const list = accounts.filter((a) => types.includes(a.type))
  const acc = list.find((a) => Number(a.is_default)) || list[0]
  return {
    accountId: ch === 'factory' ? null : acc ? Number(acc.id) : null,
    hasTax: ch === 'company' ? true : ch === 'factory' ? undefined : false,
    currency: ch === 'private_cny' ? 'CNY' : ch === 'factory' ? undefined : 'IDR',
  }
}

export function accountLabel(a: any) {
  return [a.entity_name, a.bank_name, a.account_number, a.account_name && `(${a.account_name})`, a.currency]
    .filter(Boolean)
    .join(' · ')
}

/** 启用的收款账户（主体也启用的才算） */
export function useActiveAccounts() {
  const [accounts, setAccounts] = useState<any[]>([])
  useEffect(() => {
    Promise.all([api.get('listPaymentAccounts', { only_active: 1 }), api.get('listPaymentEntities', { only_active: 1 })])
      .then(([a, e]) => {
        const active = new Set((e.items || []).map((x: any) => Number(x.id)))
        setAccounts((a.items || []).filter((x: any) => active.has(Number(x.entity_id))))
      })
      .catch(() => {})
  }, [])
  return accounts
}

export interface PaymentValue {
  channel: PaymentChannel | ''
  accountId: number | null
}

/** 付款方式 + 收款账户。选付款方式时调用 onDefaults 让外层顺带改 PPN / 币种 */
export function PaymentPicker({
  value,
  onChange,
  accounts,
  onDefaults,
}: {
  value: PaymentValue
  onChange: (v: PaymentValue) => void
  accounts: any[]
  onDefaults?: (d: { hasTax?: boolean; currency?: string }) => void
}) {
  const isFactory = value.channel === 'factory'
  return (
    <div>
      <Radio.Group
        optionType="button"
        buttonStyle="solid"
        value={value.channel || undefined}
        options={PAYMENT_CHANNEL_OPTIONS}
        onChange={(e) => {
          const ch = e.target.value as PaymentChannel
          const d = channelDefaults(ch, accounts)
          onChange({ channel: ch, accountId: d.accountId })
          onDefaults?.({ hasTax: d.hasTax, currency: d.currency })
        }}
      />
      {isFactory ? (
        <div style={{ fontSize: 12, color: '#d46b08', marginTop: 6 }}>
          客户直接打款给工厂：报价单和发票上不显示我方任何银行账号，这单也不计入未收金额和发票应收 / 逾期。
        </div>
      ) : value.channel ? (
        <div style={{ marginTop: 8 }}>
          <Select
            style={{ width: '100%' }}
            placeholder="选择收款账户"
            allowClear
            value={value.accountId ?? undefined}
            onChange={(v) => onChange({ ...value, accountId: v ? Number(v) : null })}
            options={accounts.map((a) => ({ value: Number(a.id), label: accountLabel(a) }))}
            notFoundContent="还没有可用的收款账户，请先到「系统设置 → 收款主体 / 账户」添加"
          />
          {!value.accountId && (
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>
              系统里没有这一类的账户，可以手动选一个，或先去系统设置添加
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export interface FreightValue {
  mode: FreightMode
  amount: number
}

export function FreightPicker({
  value,
  onChange,
  currency,
}: {
  value: FreightValue
  onChange: (v: FreightValue) => void
  currency?: string
}) {
  const sym = currency === 'CNY' ? '¥' : 'Rp'
  return (
    <div>
      <Space wrap>
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          value={value.mode}
          options={FREIGHT_MODE_OPTIONS}
          onChange={(e) => onChange({ ...value, mode: e.target.value })}
        />
        {value.mode === 'in_price' && (
          <InputNumber
            min={0}
            style={{ width: 200 }}
            addonBefore="总运费"
            prefix={sym}
            value={value.amount || undefined}
            formatter={(v) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(v) => Number(String(v || '').replace(/,/g, '')) as any}
            onChange={(v) => onChange({ ...value, amount: Number(v || 0) })}
          />
        )}
        {value.mode === 'absorb' && (
          <InputNumber
            min={0}
            style={{ width: 220 }}
            addonBefore="运费成本"
            prefix={sym}
            value={value.amount || undefined}
            placeholder="可后补"
            formatter={(v) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(v) => Number(String(v || '').replace(/,/g, '')) as any}
            onChange={(v) => onChange({ ...value, amount: Number(v || 0) })}
          />
        )}
      </Space>
      <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>{FREIGHT_MODE_HINT[value.mode]}</div>
    </div>
  )
}

/**
 * 开单前确认付款方式 / 收款账户 / PPN。
 * 默认值取自商机（新建商机时选的），都允许改；确认后调 setDealStatus 开单。
 */
export function OpenOrderModal({
  quote,
  inquiry,
  open,
  onClose,
  onDone,
}: {
  quote: any
  inquiry: any
  open: boolean
  onClose: () => void
  onDone: (r: any) => void
}) {
  const accounts = useActiveAccounts()
  const currency = quote?.currency || inquiry?.currency || 'IDR'
  const [pay, setPay] = useState<PaymentValue>({ channel: '', accountId: null })
  const [hasTax, setHasTax] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const ch = normChannel(quote?.payment_channel || inquiry?.payment_channel, currency) || 'company'
    setPay({
      channel: ch,
      accountId: Number(quote?.payment_account_id || inquiry?.payment_account_id || 0) || null,
    })
    setHasTax(Number(quote?.tax_rate ?? inquiry?.tax_rate ?? 0.11) > 0)
  }, [open])

  // 没有预选账户时按付款方式自动带一个
  useEffect(() => {
    if (!open || pay.accountId || !pay.channel || pay.channel === 'factory' || !accounts.length) return
    const d = channelDefaults(pay.channel, accounts)
    if (d.accountId) setPay((p) => ({ ...p, accountId: d.accountId }))
  }, [accounts, open, pay.channel])

  const submit = async () => {
    if (!pay.channel) return message.warning('请选择付款方式')
    setSaving(true)
    try {
      const r = await api.post('setDealStatus', {
        quote_id: quote.id,
        status: 'won',
        payment_channel: pay.channel,
        payment_account_id: pay.channel === 'factory' ? null : pay.accountId,
        tax_rate: hasTax ? 0.11 : 0,
      })
      onDone(r)
    } catch {
      // 拦截器已提示
    } finally {
      setSaving(false)
    }
  }

  const taxChanged = hasTax !== Number(quote?.tax_rate ?? 0.11) > 0

  return (
    <Modal
      title={`开单 · ${quote?.no || ''}`}
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="确认开单"
      cancelText="取消"
      confirmLoading={saving}
      zIndex={1200}
      destroyOnClose
      width={560}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <div>
          <Typography.Text strong>付款方式</Typography.Text>
          <div style={{ marginTop: 6 }}>
            <PaymentPicker
              value={pay}
              onChange={setPay}
              accounts={accounts}
              onDefaults={(d) => {
                if (d.hasTax !== undefined) setHasTax(d.hasTax)
              }}
            />
          </div>
        </div>
        <div>
          <Typography.Text strong>PPN</Typography.Text>
          <div style={{ marginTop: 6 }}>
            <Switch checked={hasTax} onChange={setHasTax} checkedChildren="加 PPN 11%" unCheckedChildren="不加 PPN" />
          </div>
        </div>
        {pay.channel === 'private_cny' && currency !== 'CNY' && (
          <Alert
            type="warning"
            showIcon
            message="这张报价单的币种是印尼盾"
            description="开单不会换算币种。要按人民币收款，请先在「编辑商机概览」里把币种改成人民币、按人民币重新报价，再开单。"
          />
        )}
        {taxChanged && (
          <Alert type="info" showIcon message="PPN 和报价单上的不一样，开单后报价单和发票都按这里的设置算税" />
        )}
        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
          开单后是「待付款（未成交）」，客户付款后在商机管理里点「确认到账」才算成交。
        </div>
      </Space>
    </Modal>
  )
}
