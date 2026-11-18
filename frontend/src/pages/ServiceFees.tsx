import { useEffect, useRef, useState } from 'react'
import { ActionType, PageContainer, ProColumns, ProTable } from '@ant-design/pro-components'
import { Alert, Button, Form, Input, InputNumber, Modal, Radio, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { api } from '../api'
import { PaymentPicker, channelDefaults, normChannel, useActiveAccounts } from './inquiry/DealTerms'
import type { PaymentValue } from './inquiry/DealTerms'
import { channelLabel, fmtMoney } from './inquiry/DealConfirm'
import { getPrintLang } from './printI18n'

/**
 * 服务费板块（20261118）
 * 服务费不是建材板块的收入：单独开票、单独收款，数据和商机 / 订单完全分开，
 * 不计入工作台的成交、营收、未收、排名等任何数字。发票号单独前缀 SVC。
 */

const STATUS: Record<string, { color: string; text: string }> = {
  issued: { color: 'warning', text: '待收款' },
  paid: { color: 'success', text: '已到账' },
  void: { color: 'default', text: '已作废' },
}

const blank = () => ({ product_name: '', spec: '', unit: '项', qty: 1, sell_price: 0 })

export default function ServiceFeesPage() {
  const ref = useRef<ActionType>()
  const [stats, setStats] = useState<any[]>([])
  const [editing, setEditing] = useState<any>(null)
  const reload = () => ref.current?.reload()

  const askReason = (title: string, placeholder: string, onOk: (reason: string) => Promise<any>) => {
    let reason = ''
    Modal.confirm({
      title,
      zIndex: 1200,
      content: <Input.TextArea rows={3} placeholder={placeholder} onChange={(e) => (reason = e.target.value)} />,
      okText: '确认',
      okButtonProps: { danger: true },
      onOk: () => {
        if (reason.trim().length < 2) {
          message.warning('请填写原因')
          return Promise.reject()
        }
        return onOk(reason.trim())
      },
    })
  }

  const cols: ProColumns<any>[] = [
    { title: '关键词', dataIndex: 'keyword', hideInTable: true, fieldProps: { placeholder: '发票号 / 客户 / 服务项目' } },
    {
      title: '发票号',
      dataIndex: 'no',
      search: false,
      width: 170,
      render: (_, r) => (
        <div>
          <a onClick={() => window.open(`/service-fees/${r.id}/print?lang=${r.lang || 'cn'}`, '_blank')}><b>{r.no}</b></a>
          {r.legacy_source && <div style={{ fontSize: 11, color: '#999' }}>从商机挪入</div>}
        </div>
      ),
    },
    {
      title: '客户',
      search: false,
      render: (_, r) => (
        <div>
          <div>{r.customer_name}</div>
          {r.customer_tax_no && <div style={{ fontSize: 12, color: '#999' }}>NPWP {r.customer_tax_no}</div>}
        </div>
      ),
    },
    {
      title: '服务项目',
      search: false,
      ellipsis: true,
      render: (_, r) => (
        <div>
          <div>{r.title || r.items_text}</div>
          {r.items_count > 1 && <div style={{ fontSize: 12, color: '#999' }}>{r.items_count} 项：{r.items_text}</div>}
        </div>
      ),
    },
    {
      title: '金额',
      search: false,
      width: 190,
      align: 'right',
      render: (_, r) => (
        <div>
          <b>{fmtMoney(r.currency, r.amount_due)}</b>
          <div style={{ fontSize: 12, color: '#999' }}>
            {fmtMoney(r.currency, r.subtotal)}
            {Number(r.tax) > 0 ? ' + PPN 11%' : ''}
            {Number(r.pph) > 0 ? ' − PPh 2%' : ''}
          </div>
        </div>
      ),
    },
    { title: '付款方式', search: false, width: 110, render: (_, r) => channelLabel(r.payment_channel) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 150,
      valueType: 'select',
      valueEnum: { issued: { text: '待收款' }, paid: { text: '已到账' }, void: { text: '已作废' } },
      render: (_, r) => (
        <div>
          <Tag color={STATUS[r.status]?.color}>{STATUS[r.status]?.text || r.status}</Tag>
          {r.status === 'paid' && (
            <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>
              {r.paid_by_name || '系统'} · {String(r.paid_at || '').slice(0, 16)}
            </div>
          )}
          {r.status === 'void' && r.void_reason && <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>{r.void_reason}</div>}
        </div>
      ),
    },
    {
      title: '开票',
      search: false,
      width: 140,
      render: (_, r) => (
        <div style={{ fontSize: 12 }}>
          <div>{String(r.issued_at || '').slice(0, 10)}</div>
          <div style={{ color: '#999' }}>{r.creator_name || '-'}</div>
        </div>
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 230,
      render: (_, r) => [
        <a key="p" onClick={() => window.open(`/service-fees/${r.id}/print?lang=${r.lang || 'cn'}`, '_blank')}>发票</a>,
        r.status === 'issued' && (
          <a
            key="ok"
            style={{ color: '#389e0d' }}
            onClick={() =>
              Modal.confirm({
                title: '确认这笔服务费已经到账？',
                content: `${r.no} · ${r.customer_name} · ${fmtMoney(r.currency, r.amount_due)}。点错了可以撤销，撤销时要填原因。`,
                okText: '确认到账',
                zIndex: 1200,
                onOk: async () => {
                  await api.post('confirmServicePaid', { id: r.id })
                  message.success('已确认到账')
                  reload()
                },
              })
            }
          >
            确认到账
          </a>
        ),
        r.status === 'issued' && <a key="e" onClick={() => setEditing(r)}>修改</a>,
        r.status === 'issued' && (
          <a
            key="v"
            style={{ color: '#cf1322' }}
            onClick={() =>
              askReason(`作废 ${r.no}？`, '作废原因（必填）', async (reason) => {
                await api.post('voidServiceInvoice', { id: r.id, reason })
                message.success('已作废')
                reload()
              })
            }
          >
            作废
          </a>
        ),
        r.status === 'paid' && (
          <a
            key="r"
            onClick={() =>
              askReason(`撤销 ${r.no} 的到账？`, '撤销原因（必填），如：点错了 / 客户付款被退回', async (reason) => {
                await api.post('revokeServicePaid', { id: r.id, reason })
                message.success('已撤销，回到待收款')
                reload()
              })
            }
          >
            撤销到账
          </a>
        ),
      ],
    },
  ]

  return (
    <PageContainer title="服务费">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="服务费单独开票、单独收款，不是建材板块的收入：这里的金额不计入工作台的成交、营收、未收等任何数字，也不出现在财务管理里。"
      />
      {stats.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          {stats.map((s) => (
            <div key={s.currency} style={{ background: '#fff', borderRadius: 8, padding: '12px 18px', display: 'flex', gap: 28 }}>
              <div>
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>本月开票（{s.currency}）</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtMoney(s.currency, s.month_issued)}</div>
                <div style={{ fontSize: 12, color: '#999' }}>{s.month_count} 张</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>累计已到账</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#389e0d' }}>{fmtMoney(s.currency, s.paid)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>待收款</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#d46b08' }}>{fmtMoney(s.currency, s.unpaid)}</div>
                <div style={{ fontSize: 12, color: '#999' }}>{s.unpaid_count} 张</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ProTable
        actionRef={ref}
        rowKey="id"
        columns={cols}
        headerTitle="服务费发票"
        scroll={{ x: 1200 }}
        request={async (params) => {
          const d = await api.get('listServiceInvoices', {
            keyword: params.keyword || '',
            status: params.status || '',
            page: params.current,
            page_size: params.pageSize,
          })
          setStats(d.stats || [])
          return { data: d.items, total: d.total, success: true }
        }}
        toolBarRender={() => [
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>
            新开服务费
          </Button>,
        ]}
      />
      <ServiceFeeForm
        record={editing}
        onClose={() => setEditing(null)}
        onSaved={(r, lang) => {
          setEditing(null)
          reload()
          window.open(`/service-fees/${r.id}/print?lang=${lang}`, '_blank')
        }}
      />
    </PageContainer>
  )
}

function ServiceFeeForm({ record, onClose, onSaved }: { record: any; onClose: () => void; onSaved: (r: any, lang: string) => void }) {
  const [form] = Form.useForm()
  const accounts = useActiveAccounts()
  const [customers, setCustomers] = useState<any[]>([])
  const [rows, setRows] = useState<any[]>([blank()])
  const [pay, setPay] = useState<PaymentValue>({ channel: 'company', accountId: null })
  const [saving, setSaving] = useState(false)
  const open = !!record
  const isEdit = !!record?.id
  const currency = Form.useWatch('currency', form) || 'IDR'
  const hasTax = Form.useWatch('has_tax', form)
  const pph = Form.useWatch('pph', form)

  useEffect(() => {
    if (!open) return
    api
      .get('listCustomers', { page: 1, page_size: 500 })
      .then((r) => setCustomers(r.items || []))
      .catch(() => {})
    if (isEdit) {
      api.get('getServiceInvoice', { id: record.id }).then((r) => {
        const d = r.data
        form.setFieldsValue({
          customer_id: d.customer_id || undefined,
          customer_name: d.customer_name,
          customer_tax_no: d.customer_tax_no,
          title: d.title,
          currency: d.currency,
          has_tax: Number(d.tax_rate) > 0,
          pph: Number(d.pph_rate) > 0,
          lang: d.lang || 'cn',
          remark: d.remark,
        })
        setRows((d.items || []).map((it: any) => ({ product_name: it.product_name, spec: it.spec, unit: it.unit, qty: Number(it.qty), sell_price: Number(it.sell_price) })))
        setPay({ channel: normChannel(d.payment_channel, d.currency) || 'company', accountId: Number(d.account_id) || null })
      })
    } else {
      form.resetFields()
      form.setFieldsValue({ currency: 'IDR', has_tax: true, pph: false, lang: getPrintLang() })
      setRows([blank()])
      setPay({ channel: 'company', accountId: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.id])

  // 新开时按付款方式自动带一个收款账户
  useEffect(() => {
    if (!open || pay.accountId || !pay.channel || pay.channel === 'factory' || !accounts.length) return
    const d = channelDefaults(pay.channel, accounts)
    if (d.accountId) setPay((p) => ({ ...p, accountId: d.accountId }))
  }, [accounts, open, pay.channel])

  const upd = (i: number, patch: any) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const subtotal = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.sell_price) || 0), 0)
  const tax = hasTax ? Math.round(subtotal * 0.11 * 100) / 100 : 0
  const pphAmt = pph ? Math.round(subtotal * 0.02 * 100) / 100 : 0
  const due = subtotal + tax - pphAmt

  const submit = async () => {
    const v = await form.validateFields()
    const items = rows.filter((r) => String(r.product_name).trim())
    if (!items.length) return message.warning('请至少填一行服务项目')
    if (!pay.channel) return message.warning('请选择付款方式')
    setSaving(true)
    try {
      const r = await api.post('saveServiceInvoice', {
        id: record?.id,
        ...v,
        has_tax: v.has_tax ? 1 : 0,
        pph: v.pph ? 1 : 0,
        items,
        payment_channel: pay.channel,
        account_id: pay.channel === 'factory' ? null : pay.accountId,
      })
      message.success(isEdit ? `已保存 ${r.no}` : `已开具服务费发票 ${r.no}`)
      onSaved(r, v.lang || 'cn')
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={isEdit ? `修改服务费 ${record?.no || ''}` : '新开服务费'}
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText={isEdit ? '保存' : '开具发票'}
      confirmLoading={saving}
      width={920}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="customer_id" label="客户（从客户库选，可不选）">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选了会自动带出抬头和税号"
              options={customers.map((c) => ({ value: c.id, label: `${c.short_name || c.name}${c.company ? `（${c.company}）` : ''}` }))}
              onChange={(id) => {
                const c = customers.find((x) => x.id === id)
                if (c) form.setFieldsValue({ customer_name: c.company || c.name, customer_tax_no: c.tax_no || '' })
              }}
            />
          </Form.Item>
          <Form.Item name="title" label="标题（选填，方便自己查）">
            <Input placeholder="如：11 月代理服务费" />
          </Form.Item>
          <Form.Item name="customer_name" label="客户抬头（印在发票上）" rules={[{ required: true, message: '请填写客户抬头' }]}>
            <Input placeholder="如 PT Maju Jaya" />
          </Form.Item>
          <Form.Item name="customer_tax_no" label="客户税号 NPWP（选填）">
            <Input />
          </Form.Item>
        </div>

        <Table
          size="small"
          rowKey={(_, i) => String(i)}
          pagination={false}
          dataSource={rows}
          style={{ marginBottom: 12 }}
          columns={[
            { title: '服务项目 *', render: (_: any, r: any, i: number) => <Input size="small" placeholder="如：服务费 / Service Fee" value={r.product_name} onChange={(e) => upd(i, { product_name: e.target.value })} /> },
            { title: '说明', width: 220, render: (_: any, r: any, i: number) => <Input size="small" placeholder="选填" value={r.spec} onChange={(e) => upd(i, { spec: e.target.value })} /> },
            { title: '数量', width: 90, render: (_: any, r: any, i: number) => <InputNumber size="small" min={0} style={{ width: '100%' }} value={r.qty} onChange={(v) => upd(i, { qty: Number(v ?? 0) })} /> },
            { title: '单位', width: 70, render: (_: any, r: any, i: number) => <Input size="small" value={r.unit} onChange={(e) => upd(i, { unit: e.target.value })} /> },
            {
              title: `单价（${currency === 'CNY' ? '¥' : 'Rp'}）*`,
              width: 160,
              render: (_: any, r: any, i: number) => (
                <InputNumber
                  size="small"
                  min={0}
                  style={{ width: '100%' }}
                  value={r.sell_price || undefined}
                  formatter={(v) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(v) => Number(String(v || '').replace(/,/g, '')) as any}
                  onChange={(v) => upd(i, { sell_price: Number(v ?? 0) })}
                />
              ),
            },
            { title: '小计', width: 150, align: 'right' as const, render: (_: any, r: any) => fmtMoney(currency, (Number(r.qty) || 0) * (Number(r.sell_price) || 0)) },
            { title: '', width: 40, render: (_: any, __: any, i: number) => rows.length > 1 && <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setRows((p) => p.filter((_, x) => x !== i))} /> },
          ]}
          footer={() => (
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setRows((p) => [...p, blank()])}>
                加一行
              </Button>
              <Space size={16} wrap>
                <span className="muted">小计 {fmtMoney(currency, subtotal)}</span>
                {hasTax && <span className="muted">+ PPN 11% {fmtMoney(currency, tax)}</span>}
                {pph && <span className="muted">− PPh 2% {fmtMoney(currency, pphAmt)}</span>}
                <span>
                  客户实付 <b style={{ fontSize: 16, color: '#1d57e0' }}>{fmtMoney(currency, due)}</b>
                </span>
              </Space>
            </Space>
          )}
        />

        <Form.Item label="付款方式" extra="选好后自动带出收款账户、PPN 和币种，都可以再手动改">
          <PaymentPicker
            value={pay}
            onChange={setPay}
            accounts={accounts}
            onDefaults={(d) => {
              if (d.hasTax !== undefined) form.setFieldsValue({ has_tax: d.hasTax })
              if (d.currency) form.setFieldsValue({ currency: d.currency })
            }}
          />
        </Form.Item>
        <Space size={28} wrap align="start">
          <Form.Item name="currency" label="货币">
            <Radio.Group optionType="button" options={[{ label: '印尼盾 Rp', value: 'IDR' }, { label: '人民币 ¥', value: 'CNY' }]} />
          </Form.Item>
          <Form.Item name="has_tax" label="PPN" valuePropName="checked">
            <Switch checkedChildren="加 PPN 11%" unCheckedChildren="不加 PPN" />
          </Form.Item>
          <Form.Item name="pph" label="PPh 预扣" valuePropName="checked" tooltip="客户从服务费里代扣 2% 替我们缴税，实付会少这一截">
            <Switch checkedChildren="扣 PPh 2%" unCheckedChildren="不扣" />
          </Form.Item>
          <Form.Item name="lang" label="发票语言">
            <Radio.Group optionType="button" options={[{ label: '中文', value: 'cn' }, { label: 'English', value: 'en' }, { label: 'Bahasa', value: 'id' }]} />
          </Form.Item>
        </Space>
        <Form.Item name="remark" label="备注（选填，会印在发票条款下面）" style={{ marginBottom: 0 }}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          发票号自动生成，前缀 SVC，和建材发票分开编号。
        </Typography.Text>
      </Form>
    </Modal>
  )
}
