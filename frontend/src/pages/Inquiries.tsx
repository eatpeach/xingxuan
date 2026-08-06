import { useEffect, useRef, useState } from 'react'
import {
  ActionType,
  ModalForm,
  PageContainer,
  ProColumns,
  ProFormDateTimePicker,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components'
import { Alert, Button, DatePicker, Drawer, Dropdown, Form, InputNumber, Input, Modal, Radio, Space, Steps, Switch, Table, Tag, Typography, Upload, message } from 'antd'
import { PlusOutlined, SendOutlined, FileDoneOutlined, EditOutlined, PictureOutlined, FileExcelOutlined, CopyOutlined, LockOutlined, GlobalOutlined, StopOutlined, DownOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { api } from '../api'
import { copyText } from '../utils/copyText'
import CustomerCodeSearch from '../components/CustomerCodeSearch'
import { QuoteDetail } from './Quotes'
import { OrderDetail, ORDER_STATUS } from './Orders'
import { customerCellMergeWithClass, customerRowClass, groupByCustomer } from '../utils/groupByCustomer'
import InquiryComparePage from './InquiryCompare'

function fmtAmt(cur: string, n: number): string {
  if (cur === 'CNY') return `¥${Math.round(n).toLocaleString()}`
  if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toFixed(1)}B`
  if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}jt`
  return `Rp ${Math.round(n).toLocaleString()}`
}

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  to_dispatch: { color: 'orange', text: '待派单' },
  dispatching: { color: 'processing', text: '派单中' },
  quoted: { color: 'cyan', text: '已收齐报价' },
  delivered: { color: 'blue', text: '已发送客户' },
  won: { color: 'success', text: '已成交' },
  closed: { color: 'default', text: '已关闭' },
}

interface Inquiry {
  id: number
  no: string
  customer_id: number
  customer_name?: string
  customer_short_name?: string
  customer_code?: string
  title: string
  status: string
  created_at: string
  items?: any[]
}

export default function InquiriesPage() {
  const ref = useRef<ActionType>()
  const [detailId, setDetailId] = useState<number | null>(null)
  const location = useLocation()
  const [presetCustomerId, setPresetCustomerId] = useState<number | null>(null)
  const [companyName, setCompanyName] = useState('星选建材')
  const [pool, setPool] = useState<'private' | 'public' | 'lost'>('private')
  const [editBasic, setEditBasic] = useState<any>(null)

  const setInquiryPool = async (id: number, target: string, reason = '') => {
    await api.post('setInquiryPool', { id, pool: target, reason })
    message.success('已更新')
    ref.current?.reload()
  }

  const markLost = (row: any) => {
    let reason = ''
    Modal.confirm({
      title: `标记流失：${row.title || row.no}`,
      zIndex: 9999,
      content: (
        <Input.TextArea
          rows={3}
          placeholder="流失原因（选填）"
          onChange={(e) => { reason = e.target.value }}
        />
      ),
      okText: '标记流失',
      okType: 'danger',
      onOk: () => setInquiryPool(row.id, 'lost', reason),
    })
  }

  useEffect(() => {
    api.get('listSettings').then((r) => {
      const sm: Record<string, string> = Object.fromEntries((r.items || []).map((s: any) => [s.key, s.value]))
      if (sm.company_name) setCompanyName(sm.company_name)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const cid = (location.state as any)?.newInquiryCustomerId
    if (cid) {
      setPresetCustomerId(cid)
      window.history.replaceState({}, document.title)
    }
    // 从对比页生成报价后带回来的商机 id：直接打开详情，落在「对客报价」步骤
    const oid = (location.state as any)?.openInquiryId
    if (oid) {
      setDetailId(Number(oid))
      window.history.replaceState({}, document.title)
    }
  }, [location.state])

  const cols: ProColumns<Inquiry>[] = [
    {
      title: '商机编号',
      search: false,
      width: 90,
      render: (_, r: any) => <strong>{r.id}</strong>,
    },
    {
      title: '群编号',
      dataIndex: 'code',
      key: 'code_search',
      hideInTable: true,
      renderFormItem: () => <CustomerCodeSearch />,
    },
    { title: '单号', dataIndex: 'no', hideInTable: true },
    {
      title: '客户群',
      width: 265,
      search: false,
      render: (_, r: any) => (
        <div>
          <Tag
            color="blue"
            icon={<CopyOutlined />}
            style={{ cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }}
            title="点击复制群编号"
            onClick={() => {
              const code = String(r.customer_code || r.customer_id || '')
              copyText(code)
                .then(() => message.success(`已复制群编号：${code}`))
                .catch(() => message.error('复制失败，请手动复制'))
            }}
          >
            [{companyName}{r.customer_code || r.customer_id}] {r.customer_short_name || r.customer_name || '-'}
          </Tag>
          {r._gs > 1 && (
            <div style={{ fontSize: 11, color: '#1d57e0', marginTop: 2 }}>共 {r._gs} 单</div>
          )}
        </div>
      ),
      onCell: customerCellMergeWithClass,
    },
    {
      title: '商机名称',
      dataIndex: 'title',
      render: (_, r: any) => (
        <div>
          <Space size={6} wrap>
            <span style={{ fontWeight: 500 }}>{r.title || r.no}</span>
            {r.latest_quote_total > 0 && (
              <Tag color="blue" bordered style={{ marginInlineEnd: 0 }}>
                {fmtAmt(r.latest_quote_currency || 'IDR', Number(r.latest_quote_total))}
              </Tag>
            )}
          </Space>
          <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>
            {Number(r.items_count || 0)} 项 · {r.no}
          </div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      valueType: 'select',
      valueEnum: Object.fromEntries(Object.entries(STATUS_TAG).map(([k, v]) => [k, { text: v.text }])),
      render: (_, r) => {
        const t = STATUS_TAG[r.status]
        return <Tag color={t?.color}>{t?.text || r.status}</Tag>
      },
    },
    {
      title: pool === 'lost' ? '流失原因' : '负责人',
      width: pool === 'lost' ? 160 : 100,
      search: false,
      render: (_, r: any) =>
        pool === 'lost'
          ? (r.lost_reason || '-')
          : (r.owner_name || r.owner_username || r.creator_name || r.creator_username || '-'),
    },
    { title: '创建时间', dataIndex: 'created_at', width: 165, search: false },
    {
      title: '操作',
      valueType: 'option',
      width: 160,
      fixed: 'right',
      render: (_, row: any) => (
        <Space size={10}>
          <a onClick={() => setDetailId(row.id)}>商机详情</a>
        <Dropdown
          menu={{
            items: [
              { key: 'edit', label: '编辑' },
              pool === 'private' ? { key: 'to-public', label: '移入公海' } : null,
              pool === 'public' ? { key: 'claim', label: '认领' } : null,
              pool !== 'lost'
                ? { key: 'lost', label: <span style={{ color: '#fa8c16' }}>标记流失</span> }
                : { key: 'recover', label: '恢复到私海' },
              { type: 'divider' as const },
              { key: 'del', label: '删除', danger: true },
            ].filter(Boolean) as any,
            onClick: ({ key }) => {
              if (key === 'edit') setEditBasic(row)
              else if (key === 'to-public') setInquiryPool(row.id, 'public')
              else if (key === 'claim' || key === 'recover') setInquiryPool(row.id, 'private')
              else if (key === 'lost') markLost(row)
              else if (key === 'del')
                Modal.confirm({
                  title: `删除商机 ${row.no}？`,
                  content: '将同时删除明细、派单、供应商报价、客户报价。该操作不可撤销。',
                  okText: '删除',
                  okType: 'danger',
                  cancelText: '取消',
                  zIndex: 9999,
                  onOk: async () => {
                    await api.post('deleteInquiry', { id: row.id })
                    message.success('已删除')
                    ref.current?.reload()
                  },
                })
            },
          }}
        >
          <a onClick={(e) => e.preventDefault()}>
            操作 <DownOutlined style={{ fontSize: 10 }} />
          </a>
        </Dropdown>
        </Space>
      ),
    },
  ]

  return (
    <PageContainer title="商机管理">
      <ProTable<Inquiry>
        actionRef={ref}
        rowKey="id"
        columns={cols}
        bordered
        scroll={{ x: 1210 }}
        onRow={(r: any) => customerRowClass(r)}
        params={{ pool }}
        request={async (params) => {
          const data = await api.get('listInquiries', {
            keyword: params.code_search || params.code || params.title || params.no || '',
            status: params.status,
            pool: params.pool,
            page: params.current,
            page_size: params.pageSize,
          })
          return { data: groupByCustomer(data.items || []), total: data.total, success: true }
        }}
        headerTitle={
          <Radio.Group value={pool} onChange={(e) => setPool(e.target.value)} buttonStyle="solid">
            <Radio.Button value="private"><LockOutlined /> 私海</Radio.Button>
            <Radio.Button value="public"><GlobalOutlined /> 公海</Radio.Button>
            <Radio.Button value="lost"><StopOutlined /> 已流失</Radio.Button>
          </Radio.Group>
        }
        toolBarRender={() => [
          <NewInquiry
            key="add"
            presetCustomerId={presetCustomerId}
            onOpened={() => setPresetCustomerId(null)}
            onOk={() => ref.current?.reload()}
          />,
        ]}
      />
      <EditInquiryBasic
        record={editBasic}
        onClose={() => setEditBasic(null)}
        onOk={() => ref.current?.reload()}
      />
      <InquiryDetail
        id={detailId}
        onClose={() => {
          setDetailId(null)
          ref.current?.reload()
        }}
      />
    </PageContainer>
  )
}

function NewInquiry({
  onOk,
  presetCustomerId,
  onOpened,
}: {
  onOk: () => void
  presetCustomerId?: number | null
  onOpened?: () => void
}) {
  const [form] = Form.useForm()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [aiParsing, setAiParsing] = useState(false)
  const [parsedItems, setParsedItems] = useState<any[]>([])
  const [aiText, setAiText] = useState('')
  const [currency, setCurrency] = useState<'IDR' | 'CNY'>('IDR')
  const [taxIncluded, setTaxIncluded] = useState<boolean>(true)
  const [taxRate, setTaxRate] = useState<number>(11)

  useEffect(() => {
    if (presetCustomerId) {
      setOpen(true)
      setTimeout(() => form.setFieldsValue({ customer_id: presetCustomerId }), 0)
      onOpened?.()
    }
  }, [presetCustomerId])

  const applyAiResult = (res: any) => {
    if (!res.items || res.items.length === 0) {
      message.warning('AI 没识别到产品行，请检查内容或直接手填')
    } else {
      message.success(`AI 识别到 ${res.items.length} 行产品`)
    }
    setParsedItems(res.items || [])
    const oldRemark = form.getFieldValue('remark') || ''
    const newRemark = res.remark
      ? oldRemark
        ? `${oldRemark}\n${res.remark}`
        : res.remark
      : oldRemark
    form.setFieldsValue({ remark: newRemark })
  }

  const aiParse = async () => {
    if (!aiText.trim()) {
      message.warning('请先粘贴客户的询价文本')
      return
    }
    setAiParsing(true)
    try {
      const res = await api.post('aiParseInquiryText', { text: aiText })
      applyAiResult(res)
    } catch (e: any) {
      message.error(e?.response?.data?.message || e.message || 'AI 解析失败')
    } finally {
      setAiParsing(false)
    }
  }

  const aiParseFile = async (file: File) => {
    setAiParsing(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (aiText.trim()) fd.append('hint', aiText.trim())
      const res = await api.upload('aiParseInquiryFile', fd)
      applyAiResult(res)
    } catch (e: any) {
      message.error(e?.response?.data?.message || e.message || 'AI 图片解析失败')
    } finally {
      setAiParsing(false)
    }
  }

  const updateItem = (idx: number, patch: any) =>
    setParsedItems((p) => p.map((x, i) => (i === idx ? { ...x, ...patch } : x)))

  const removeItem = (idx: number) =>
    setParsedItems((p) => p.filter((_, i) => i !== idx))

  const addBlankItem = () =>
    setParsedItems((p) => [...p, { product_name: '', spec: '', qty: 1, unit: '件' }])

  const submit = async () => {
    try {
      const v = await form.validateFields(['customer_id', 'title'])
      const items = parsedItems
        .map((it, i) => ({ ...it, line_no: i + 1 }))
        .filter((it) => it.product_name && Number(it.qty) > 0)
      if (items.length === 0) {
        message.warning('至少要有一行有效产品')
        return
      }
      setSubmitting(true)
      await api.post('createInquiry', {
        ...v,
        remark: form.getFieldValue('remark') || '',
        items,
        currency,
        tax_included: taxIncluded ? 1 : 0,
        tax_rate: taxRate / 100,
      })
      message.success('已创建')
      setOpen(false)
      setParsedItems([])
      setAiText('')
      setCurrency('IDR')
      setTaxIncluded(true)
      setTaxRate(11)
      form.resetFields()
      onOk()
    } catch (e: any) {
      if (e?.errorFields) return
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
        新建商机
      </Button>
      <Modal
        title="新建商机"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        width={920}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <ProFormSelect
            name="customer_id"
            label="客户"
            rules={[{ required: true }]}
            showSearch
            request={async () => {
              const [data, settings] = await Promise.all([
                api.get('listCustomers', { page_size: 200 }),
                api.get('listSettings'),
              ])
              const sm: Record<string, string> = Object.fromEntries(
                (settings.items || []).map((s: any) => [s.key, s.value]),
              )
              const companyName = sm.company_name || '星选建材'
              return data.items.map((c: any) => {
                const groupName = `[${companyName}${c.code || c.id}] ${c.short_name || c.name}`
                const suffix = c.company ? `（${c.company}）` : ''
                return { label: `${groupName}${suffix}`, value: c.id }
              })
            }}
          />
          <ProFormText name="title" label="标题" />

          <Form.Item label="货币 / 含税 / 税率" style={{ marginBottom: 8 }}>
            <Space wrap size={16}>
              <span>
                <Typography.Text type="secondary" style={{ marginRight: 8 }}>货币</Typography.Text>
                <Radio.Group value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <Radio.Button value="IDR">印尼盾 Rp</Radio.Button>
                  <Radio.Button value="CNY">人民币 ¥</Radio.Button>
                </Radio.Group>
              </span>
              <span>
                <Typography.Text type="secondary" style={{ marginRight: 8 }}>含税单价</Typography.Text>
                <Switch checked={taxIncluded} onChange={setTaxIncluded} />
              </span>
              <span>
                <Typography.Text type="secondary" style={{ marginRight: 8 }}>税率</Typography.Text>
                <InputNumber
                  value={taxRate}
                  onChange={(v) => setTaxRate(Number(v ?? 11))}
                  addonAfter="%"
                  min={0}
                  max={100}
                  style={{ width: 110 }}
                />
              </span>
            </Space>
            <div style={{ marginTop: 4, fontSize: 12, color: '#8c8c8c' }}>
              此设置会发送给所有供应商；客户报价单也沿用同样设置。
            </div>
          </Form.Item>

          <Form.Item label={<span>客户原文 / 询价文本（粘贴文字 或 上传图片，<a onClick={aiParse}>AI 智能解析 →</a>）</span>}>
            <Input.TextArea
              rows={5}
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              placeholder={`粘贴客户微信里发的清单，比如：\n插座： 124 个\n明装接线盒： 91 个\n15W 嵌入式筒灯： 12 个\n灯光颜色全部用白光 6500K\n\n或者点下方按钮上传截图 / 报价单照片`}
            />
            <div style={{ marginTop: 8 }}>
              <Space wrap>
                <Button size="small" type="primary" loading={aiParsing} onClick={aiParse}>
                  AI 解析文字
                </Button>
                <Upload
                  accept="image/*,.pdf,.xlsx,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    if (file.size > 20 * 1024 * 1024) {
                      message.error('文件不能超过 20MB')
                      return Upload.LIST_IGNORE
                    }
                    aiParseFile(file)
                    return false
                  }}
                >
                  <Button size="small" icon={<PictureOutlined />} loading={aiParsing}>
                    AI 识别文件（图片 / PDF / Excel）
                  </Button>
                </Upload>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  需要先在「系统设置」配置 OpenAI API Key
                </Typography.Text>
              </Space>
            </div>
          </Form.Item>

          <Form.Item label={`询价明细（${parsedItems.length} 行）`}>
            <Table
              size="small"
              rowKey={(_, idx) => String(idx)}
              dataSource={parsedItems}
              pagination={false}
              locale={{ emptyText: '点击上方"AI 解析为明细"，或下方"添加一行"手动填写' }}
              columns={[
                { title: '#', width: 40, render: (_, _r, idx) => idx + 1 },
                {
                  title: '产品名',
                  width: 200,
                  render: (_, r: any, idx) => (
                    <Input
                      size="small"
                      value={r.product_name}
                      onChange={(e) => updateItem(idx, { product_name: e.target.value })}
                    />
                  ),
                },
                {
                  title: '规格',
                  width: 140,
                  render: (_, r: any, idx) => (
                    <Input
                      size="small"
                      value={r.spec}
                      onChange={(e) => updateItem(idx, { spec: e.target.value })}
                    />
                  ),
                },
                {
                  title: '数量',
                  width: 90,
                  render: (_, r: any, idx) => (
                    <InputNumber
                      size="small"
                      min={0}
                      value={r.qty}
                      onChange={(v) => updateItem(idx, { qty: Number(v ?? 0) })}
                      style={{ width: '100%' }}
                    />
                  ),
                },
                {
                  title: '单位',
                  width: 80,
                  render: (_, r: any, idx) => (
                    <Input
                      size="small"
                      value={r.unit}
                      onChange={(e) => updateItem(idx, { unit: e.target.value })}
                    />
                  ),
                },
                {
                  title: '',
                  width: 50,
                  render: (_, _r, idx) => (
                    <Button size="small" type="link" danger onClick={() => removeItem(idx)}>
                      删除
                    </Button>
                  ),
                },
              ]}
              footer={() => (
                <Button size="small" type="dashed" onClick={addBlankItem}>
                  + 添加一行
                </Button>
              )}
            />
          </Form.Item>

          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="客户的额外说明 / AI 提取的整体备注会自动追加到这里" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function EditInquiryBasic({ record, onClose, onOk }: { record: any; onClose: () => void; onOk: () => void }) {
  return (
    <ModalForm
      key={record?.id || 0}
      title={record ? `编辑商机 ${record.no}` : '编辑商机'}
      open={!!record}
      modalProps={{ destroyOnClose: true, onCancel: onClose, zIndex: 9999 }}
      width={520}
      initialValues={
        record
          ? {
              title: record.title,
              deadline: record.deadline ? dayjs(record.deadline) : undefined,
              remark: record.remark,
            }
          : undefined
      }
      onFinish={async (v) => {
        await api.post('updateInquiryBasic', {
          id: record.id,
          title: v.title || '',
          deadline: v.deadline ? dayjs(v.deadline).format('YYYY-MM-DD HH:mm:ss') : null,
          remark: v.remark || '',
        })
        message.success('已保存')
        onOk()
        onClose()
        return true
      }}
    >
      <ProFormText name="title" label="商机名称" placeholder="如：巴淡岛数据中心 电缆一批" />
      <ProFormDateTimePicker name="deadline" label="截止时间（选填）" fieldProps={{ style: { width: '100%' } }} />
      <ProFormTextArea name="remark" label="备注（选填）" fieldProps={{ rows: 3 }} />
    </ModalForm>
  )
}

function InquiryDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const nav = useNavigate()
  const [data, setData] = useState<any>(null)
  const [dispatches, setDispatches] = useState<any[]>([])
  const [shareLinks, setShareLinks] = useState<any[]>([])
  const [quotes, setQuotes] = useState<any[]>([])
  const [step, setStep] = useState(0)
  const [delivery, setDelivery] = useState({ receiver: '', schedule: '', expected: '', remark: '' })
  const [savingDelivery, setSavingDelivery] = useState(false)
  const [orders, setOrders] = useState<any[]>([])
  const [quoteDetailId, setQuoteDetailId] = useState<number | null>(null)
  const [orderDetailId, setOrderDetailId] = useState<number | null>(null)

  const load = async () => {
    if (!id) return
    const [a, b, c, q, o] = await Promise.all([
      api.get('getInquiry', { id }),
      api.get('listDispatches', { id }),
      api.get('shareLinks', { id }),
      api.get('listCustomerQuotes', { inquiry_id: id, page: 1, page_size: 50 }),
      api.get('listOrders', { inquiry_id: id, page: 1, page_size: 50 }),
    ])
    setData(a.data)
    setDispatches(b.items)
    setShareLinks(c.items)
    setQuotes(q.items || [])
    setOrders(o.items || [])
    setDelivery({
      receiver: a.data?.delivery_receiver || '',
      schedule: a.data?.delivery_schedule || '',
      expected: a.data?.delivery_expected_at || '',
      remark: a.data?.delivery_remark || '',
    })
  }

  if (id && !data) load()

  const saveDelivery = async () => {
    setSavingDelivery(true)
    try {
      await api.post('saveInquiryDelivery', {
        id,
        delivery_receiver: delivery.receiver,
        delivery_schedule: delivery.schedule,
        delivery_expected_at: delivery.expected || null,
        delivery_remark: delivery.remark,
      })
      message.success('交付信息已保存')
    } finally {
      setSavingDelivery(false)
    }
  }

  const QUOTE_STATUS: Record<string, { color: string; text: string }> = {
    draft: { color: 'default', text: '草稿' },
    to_review: { color: 'orange', text: '待审' },
    sent: { color: 'blue', text: '已发送' },
    won: { color: 'success', text: '已成交' },
    lost: { color: 'default', text: '未成交' },
  }

  const dispatch = async (supplier_ids: number[]) => {
    await api.post('dispatchInquiry', { id, supplier_ids, expire_days: 7 })
    message.success('已派单')
    load()
  }

  const STATUS_LABEL: Record<string, { color: string; text: string }> = {
    draft: { color: 'default', text: '草稿' },
    to_dispatch: { color: 'orange', text: '待派单' },
    dispatching: { color: 'processing', text: '派单中' },
    quoted: { color: 'cyan', text: '已收齐报价' },
    delivered: { color: 'blue', text: '已发送客户' },
    won: { color: 'success', text: '已成交' },
    closed: { color: 'default', text: '已关闭' },
  }
  const DISPATCH_STATUS: Record<string, { color: string; text: string }> = {
    pending: { color: 'orange', text: '等待报价' },
    submitted: { color: 'processing', text: '已提交' },
    adopted: { color: 'success', text: '已采纳' },
    rejected: { color: 'default', text: '未采纳' },
    expired: { color: 'red', text: '已过期' },
  }
  const sym = data?.currency === 'CNY' ? '¥' : 'Rp'

  return (
    <Drawer
      title={
        data ? (
          <Space size="small">
            <span>商机详情 {data.no}</span>
            <Tag color={STATUS_LABEL[data.status]?.color}>{STATUS_LABEL[data.status]?.text || data.status}</Tag>
          </Space>
        ) : (
          '商机详情'
        )
      }
      width="min(1390px, 96vw)"
      open={!!id}
      onClose={() => {
        setData(null)
        setStep(0)
        onClose()
      }}
      destroyOnClose
      styles={{ body: { background: '#f5f7fa', padding: 20 } }}
    >
      {data && (
        <div className="inq-detail">
          <style>{detailStyles}</style>

          {/* 概览卡 */}
          <section className="inq-card">
            <div className="inq-card-title">概览</div>
            <div className="inq-meta-grid">
              <div><span className="k">标题</span><span className="v">{data.title || '-'}</span></div>
              <div><span className="k">客户</span><span className="v">{data.customer_name || '-'}</span></div>
              <div><span className="k">货币</span>
                <span className="v">
                  <Tag color="blue" bordered={false}>{data.currency} ({sym})</Tag>
                </span>
              </div>
              <div><span className="k">税点</span>
                <span className="v">
                  <Tag color={Number(data.tax_included) ? 'cyan' : 'default'} bordered={false}>
                    {Number(data.tax_included) ? '含税' : '不含税'} · VAT {(Number(data.tax_rate) * 100).toFixed(0)}%
                  </Tag>
                </span>
              </div>
              {data.deadline && (
                <div><span className="k">截止</span><span className="v">{data.deadline.slice(0, 16)}</span></div>
              )}
              {data.remark && (
                <div className="full"><span className="k">备注</span><span className="v" style={{ whiteSpace: 'pre-wrap' }}>{data.remark}</span></div>
              )}
            </div>
          </section>

          {/* 步骤导航 */}
          <section className="inq-card" style={{ paddingBottom: 12 }}>
            <Steps
              size="small"
              current={step}
              onChange={setStep}
              items={[
                { title: '供应商报价' },
                { title: '对客报价' },
                { title: '订单履约' },
                { title: '交付流程' },
              ]}
            />
          </section>

          {step === 0 && (
          <>
          {/* 明细 */}
          <section className="inq-card">
            <div className="inq-card-title">明细 <span className="muted">（{data.items?.length || 0} 行）</span></div>
            <Table
              size="small"
              rowKey="id"
              dataSource={data.items}
              pagination={false}
              columns={[
                { title: '#', dataIndex: 'line_no', width: 50 },
                { title: '产品名', dataIndex: 'product_name', render: (v: string) => <strong>{v}</strong> },
                { title: '规格', dataIndex: 'spec', render: (v: string) => v || <span className="muted">-</span> },
                { title: '数量', width: 100, render: (_, r: any) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.qty} {r.unit}</span> },
                { title: '备注', dataIndex: 'remark', render: (v: string) => v || <span className="muted">-</span> },
              ]}
            />
          </section>

          {/* 派单 */}
          <section className="inq-card">
            <div className="inq-card-title">
              派单
              <span className="muted" style={{ marginLeft: 8 }}>
                链接 = 在线填；Excel = 离线填后回传
              </span>
            </div>
            <Space wrap size={12}>
              <ModalForm
                title="选择供应商派单"
                trigger={
                  <Button type="primary" icon={<SendOutlined />}>
                    派单（生成链接）
                  </Button>
                }
                modalProps={{ destroyOnClose: true }}
                onFinish={async (v) => {
                  await dispatch(v.supplier_ids)
                  return true
                }}
              >
                <ProFormSelect
                  name="supplier_ids"
                  label="供应商"
                  mode="multiple"
                  rules={[{ required: true }]}
                  request={async () => {
                    const r = await api.get('listSuppliers', { page_size: 200 })
                    return r.items.map((s: any) => ({ label: `${s.name}（${s.category || '通用'}）`, value: s.id }))
                  }}
                />
              </ModalForm>
              <Button
                icon={<FileExcelOutlined />}
                onClick={async () => {
                  try {
                    await api.download('exportInquiryExcel', { id: data.id }, `询价_${data.no}.xlsx`)
                  } catch (e: any) {
                    message.error(e?.message || '下载失败')
                  }
                }}
              >
                下载 Excel 模板
              </Button>
            </Space>

            {dispatches.length > 0 && (
              <div className="dispatch-list">
                {dispatches.map((d) => {
                  const link = shareLinks.find((l) => l.dispatch_id === d.id)
                  const st = DISPATCH_STATUS[d.status] || { color: 'default', text: d.status }
                  return (
                    <div key={d.id} className="dispatch-row">
                      <div className="dispatch-left">
                        <Tag color={st.color}>{st.text}</Tag>
                        <strong>{d.supplier_name}</strong>
                      </div>
                      <div className="dispatch-right">
                        <Typography.Text
                          ellipsis
                          copyable={{ text: link?.url, tooltips: ['复制链接', '已复制'] }}
                          style={{ fontSize: 12, color: '#8c8c8c', maxWidth: 360 }}
                        >
                          {link?.url}
                        </Typography.Text>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 代录入 */}
          <section className="inq-card">
            <div className="inq-card-title">代录入供应商报价</div>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
              供应商不方便用链接 / 不会上传图片时，销售拿到报价后可在这里手动录入。
            </Typography.Paragraph>
            <InternalQuoteEntry inquiry={data} onSaved={load} />
          </section>
          </>
          )}

          {step === 1 && (
            <section className="inq-card">
              <div className="inq-card-title">对客报价 <span className="muted">（{quotes.length} 单）</span></div>
              {/* 询价对比 / 生成报价：直接嵌在本步骤内，不再跳出去另开一页 */}
              <div style={{ marginBottom: 16 }}>
                <InquiryComparePage inquiryId={Number(data.id)} embedded onGenerated={load} />
              </div>
              <Table
                size="small"
                rowKey="id"
                dataSource={quotes}
                pagination={false}
                locale={{ emptyText: '还没有对客报价，先在上一步收齐供应商报价，再点上方按钮生成' }}
                columns={[
                  { title: '报价单号', dataIndex: 'no', width: 150 },
                  {
                    title: '金额',
                    align: 'right' as const,
                    width: 150,
                    render: (_, q: any) => (
                      <strong style={{ whiteSpace: 'nowrap' }}>
                        {(q.currency === 'CNY' ? '¥ ' : 'Rp ') + Math.round(Number(q.total)).toLocaleString()}
                      </strong>
                    ),
                  },
                  {
                    title: '状态',
                    width: 90,
                    render: (_, q: any) => {
                      const t = QUOTE_STATUS[q.status]
                      return <Tag color={t?.color}>{t?.text || q.status}</Tag>
                    },
                  },
                  { title: '发送时间', dataIndex: 'sent_at', render: (v: any) => v || '-' },
                  {
                    title: '操作',
                    width: 170,
                    render: (_, q: any) => (
                      <Space>
                        <a onClick={() => setQuoteDetailId(q.id)}>管理</a>
                        <a onClick={() => window.open(`/quotes/${q.id}/print`, '_blank')}>报价单</a>
                      </Space>
                    ),
                  },
                ]}
              />
            </section>
          )}

          {step === 2 && (
            <section className="inq-card">
              <div className="inq-card-title">订单履约 <span className="muted">（{orders.length} 单）</span></div>
              <Table
                size="small"
                rowKey="id"
                dataSource={orders}
                pagination={false}
                locale={{
                  emptyText: '还没有订单。回到上一步打开报价单点「标记已成交」，系统会自动生成订单',
                }}
                columns={[
                  { title: '订单号', dataIndex: 'no', width: 150 },
                  { title: '报价单', dataIndex: 'quote_no', width: 140, render: (v: any) => v || '-' },
                  {
                    title: '金额',
                    align: 'right' as const,
                    width: 140,
                    render: (_, o: any) => (
                      <strong style={{ whiteSpace: 'nowrap' }}>
                        {(o.currency === 'CNY' ? '¥ ' : 'Rp ') + Math.round(Number(o.total_amount || 0)).toLocaleString()}
                      </strong>
                    ),
                  },
                  {
                    title: '已收',
                    align: 'right' as const,
                    width: 140,
                    render: (_, o: any) => {
                      const paid = Number(o.paid_sum || 0)
                      const total = Number(o.total_amount || 0)
                      const done = paid >= total && total > 0
                      return (
                        <span style={{ whiteSpace: 'nowrap', color: done ? '#52c41a' : '#fa8c16' }}>
                          {(o.currency === 'CNY' ? '¥ ' : 'Rp ') + Math.round(paid).toLocaleString()}
                        </span>
                      )
                    },
                  },
                  {
                    title: '合同',
                    width: 90,
                    render: (_, o: any) =>
                      Number(o.contracts_signed || 0) > 0 ? (
                        <Tag color="success">已签</Tag>
                      ) : Number(o.contracts_count || 0) > 0 ? (
                        <Tag color="orange">待签</Tag>
                      ) : (
                        <span className="muted">无</span>
                      ),
                  },
                  {
                    title: '状态',
                    width: 100,
                    render: (_, o: any) => (
                      <Tag color={ORDER_STATUS[o.status]?.color}>{ORDER_STATUS[o.status]?.text || o.status}</Tag>
                    ),
                  },
                  {
                    title: '操作',
                    width: 90,
                    render: (_, o: any) => <a onClick={() => setOrderDetailId(o.id)}>履约管理</a>,
                  },
                ]}
              />
              <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                合同、收款、发票、返佣、完成五个阶段都在「履约管理」里操作。
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="inq-card">
              <div className="inq-card-title">交付流程</div>
              <div style={{ display: 'grid', gap: 14 }}>
                <div>
                  <div style={{ marginBottom: 6, color: '#666' }}>客户收货信息（收货人 / 电话 / 地址）</div>
                  <Input.TextArea
                    rows={2}
                    value={delivery.receiver}
                    onChange={(e) => setDelivery((d) => ({ ...d, receiver: e.target.value }))}
                    placeholder="如：刘总 0812xxxx 雅加达北区 xx 仓库"
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 6, color: '#666' }}>工厂生产排期</div>
                  <Input.TextArea
                    rows={2}
                    value={delivery.schedule}
                    onChange={(e) => setDelivery((d) => ({ ...d, schedule: e.target.value }))}
                    placeholder="如：8/1 排产，8/10 出厂，8/12 装柜"
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 6, color: '#666' }}>预计交付时间</div>
                  <DatePicker
                    style={{ width: 220 }}
                    value={delivery.expected ? dayjs(delivery.expected) : null}
                    onChange={(d) => setDelivery((x) => ({ ...x, expected: d ? d.format('YYYY-MM-DD') : '' }))}
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 6, color: '#666' }}>交付备注</div>
                  <Input.TextArea
                    rows={2}
                    value={delivery.remark}
                    onChange={(e) => setDelivery((d) => ({ ...d, remark: e.target.value }))}
                    placeholder="物流单号 / 验收要求 / 尾款条件等"
                  />
                </div>
                <div>
                  <Button type="primary" loading={savingDelivery} onClick={saveDelivery}>
                    保存交付信息
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* 报价 / 订单详情：复用独立页的抽屉组件，关闭后刷新本页数据 */}
          <QuoteDetail
            id={quoteDetailId}
            onClose={() => {
              setQuoteDetailId(null)
              load()
            }}
          />
          <OrderDetail
            id={orderDetailId}
            onClose={() => {
              setOrderDetailId(null)
              load()
            }}
          />
        </div>
      )}
    </Drawer>
  )
}

const detailStyles = `
.inq-detail .inq-card {
  background: #fff;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 14px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.inq-detail .inq-card-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
  padding-bottom: 10px;
  margin-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
  position: relative;
  padding-left: 10px;
}
.inq-detail .inq-card-title::before {
  content: '';
  position: absolute;
  left: 0; top: 1px;
  width: 3px; height: 14px;
  background: #1d57e0;
  border-radius: 2px;
}
.inq-detail .muted { color: #bfbfbf; font-weight: 400; font-size: 12px; }
.inq-meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 24px;
  font-size: 13px;
}
.inq-meta-grid .full { grid-column: 1 / -1; }
.inq-meta-grid .k { color: #8c8c8c; margin-right: 12px; min-width: 48px; display: inline-block; }
.inq-meta-grid .v { color: #1f1f1f; }
.dispatch-list { margin-top: 12px; border: 1px solid #f0f0f0; border-radius: 6px; }
.dispatch-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
  gap: 12px;
}
.dispatch-row:last-child { border-bottom: none; }
.dispatch-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dispatch-right { flex: 1; min-width: 0; text-align: right; }
`

function InternalQuoteEntry({
  inquiry,
  onSaved,
}: {
  inquiry: any
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [supplierId, setSupplierId] = useState<number | undefined>()
  const [supplierOptions, setSupplierOptions] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [existingQuote, setExistingQuote] = useState<any>(null)
  const [aiBusy, setAiBusy] = useState(false)

  const aiParseFile = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      message.error('文件不能超过 20MB')
      return false
    }
    setAiBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('inquiry_id', String(inquiry.id))
      const res = await api.upload('aiParseSupplierQuoteForInquiry', fd)
      const aiItems = res.items || []
      if (aiItems.length === 0) {
        message.warning('AI 没识别到能匹配的行，请手填或换张更清晰的图')
        return false
      }
      const map: Record<number, any> = {}
      for (const it of aiItems) map[it.inquiry_item_id] = it
      setItems((prev) =>
        prev.map((it) => {
          const m = map[it.inquiry_item_id]
          if (!m) return it
          return {
            ...it,
            brand: m.brand || it.brand,
            model: m.model || it.model,
            supplier_price: m.supplier_price > 0 ? Number(m.supplier_price) : it.supplier_price,
            lead_time: m.lead_time || it.lead_time,
            remark: m.remark || it.remark,
          }
        }),
      )
      if (res.remark) setRemark((r) => (r ? `${r}\n${res.remark}` : res.remark))
      message.success(`AI 识别 ${aiItems.length}/${res.total_inquiry_items} 行，请核对单价后保存`)
    } catch (e: any) {
      message.error(e?.response?.data?.message || e.message || 'AI 识别失败')
    } finally {
      setAiBusy(false)
    }
    return false
  }

  const blankRows = () =>
    (inquiry.items || []).map((it: any) => ({
      inquiry_item_id: it.id,
      product_name: it.product_name,
      spec: it.spec,
      unit: it.unit,
      qty: Number(it.qty),
      brand: '',
      model: '',
      supplier_price: null,
      lead_time: '',
      remark: '',
    }))

  /** 选定供应商后：若该供应商已录过报价，回填上次的值，避免重复手敲 */
  const loadExisting = async (sid: number) => {
    setItems(blankRows())
    setRemark('')
    setExistingQuote(null)
    if (!sid) return
    try {
      const r = await api.get('listSupplierQuotes', {
        inquiry_id: inquiry.id,
        supplier_id: sid,
        page_size: 1,
      })
      const q = (r.items || [])[0]
      if (!q) return
      const detail = await api.get('getSupplierQuote', { id: q.id })
      const d = detail.data || {}
      const byItem: Record<string, any> = {}
      for (const x of d.items || []) byItem[String(x.inquiry_item_id)] = x
      setItems((rows) =>
        rows.map((it) => {
          const m = byItem[String(it.inquiry_item_id)]
          if (!m) return it
          return {
            ...it,
            brand: m.brand || '',
            model: m.model || '',
            supplier_price: Number(m.supplier_price) > 0 ? Number(m.supplier_price) : null,
            lead_time: m.lead_time || '',
            remark: m.remark || '',
          }
        }),
      )
      if (d.remark) setRemark(d.remark)
      setExistingQuote({ id: q.id, no: q.no, status: q.status, created_at: q.created_at })
    } catch {
      /* 拉不到就当新录入，不打断操作 */
    }
  }

  const init = async () => {
    setOpen(true)
    setSupplierId(undefined)
    setExistingQuote(null)
    setItems(blankRows())
    setRemark('')
    const r = await api.get('listSuppliers', { page_size: 200 })
    setSupplierOptions(
      r.items.map((s: any) => ({ label: `${s.name}（${s.category || '通用'}）`, value: s.id })),
    )
  }

  const submit = async () => {
    if (!supplierId) return message.warning('请选择供应商')
    const empty = items.find((it) => !it.supplier_price || it.supplier_price <= 0)
    if (empty) return message.warning('请确认每行都填了单价')
    setSubmitting(true)
    try {
      await api.post('internalSubmitQuote', {
        inquiry_id: inquiry.id,
        supplier_id: supplierId,
        remark,
        items,
      })
      message.success('已录入')
      setOpen(false)
      setSupplierId(undefined)
      onSaved()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button icon={<EditOutlined />} onClick={init}>
        代录入报价
      </Button>
      <Modal
        title="代录入供应商报价"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        width={920}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Typography.Text>供应商 *</Typography.Text>
            <div>
              <ProFormSelect
                noStyle
                fieldProps={{ style: { width: 360 } }}
                options={supplierOptions}
                onChange={(v: any) => {
                  setSupplierId(v)
                  loadExisting(Number(v))
                }}
                showSearch
                placeholder="选择供应商"
              />
            </div>
            {existingQuote && (
              <Alert
                style={{ marginTop: 10 }}
                type={existingQuote.status === 'adopted' ? 'warning' : 'info'}
                showIcon
                message={`该供应商已录入过报价（${existingQuote.no}），已带出上次填写的内容`}
                description={
                  existingQuote.status === 'adopted'
                    ? '这份报价已被采纳，保存会另建一份新报价单，原件保留不动。'
                    : `保存将覆盖这份报价，单号 ${existingQuote.no} 保持不变。`
                }
              />
            )}
          </div>

          <div style={{ background: '#f0f5ff', padding: 12, borderRadius: 6, borderLeft: '3px solid #1d57e0' }}>
            <Typography.Text strong style={{ color: '#1d57e0' }}>AI 识别供应商报价单</Typography.Text>
            <span style={{ marginLeft: 8, color: '#8c8c8c', fontSize: 12 }}>
              上传图片 / PDF / Excel / CSV，自动按产品名+规格匹配询价行，填进下方单价
            </span>
            <div style={{ marginTop: 8 }}>
              <Upload
                accept="image/*,.pdf,.xlsx,.csv,.txt"
                showUploadList={false}
                beforeUpload={(f) => { aiParseFile(f); return false }}
              >
                <Button
                  type="primary"
                  ghost
                  icon={<PictureOutlined />}
                  loading={aiBusy}
                >
                  {aiBusy ? '识别中...' : '上传报价文件让 AI 识别'}
                </Button>
              </Upload>
            </div>
          </div>

          <Table
            rowKey="inquiry_item_id"
            dataSource={items}
            pagination={false}
            size="small"
            columns={[
              { title: '产品', dataIndex: 'product_name', width: 160 },
              { title: '规格', dataIndex: 'spec', width: 120 },
              {
                title: '需求',
                width: 90,
                render: (_, r: any) => `${r.qty} ${r.unit}`,
              },
              {
                title: '品牌',
                width: 130,
                render: (_, r: any, idx) => (
                  <Input
                    size="small"
                    value={r.brand}
                    onChange={(e) =>
                      setItems((p) => p.map((x, i) => (i === idx ? { ...x, brand: e.target.value } : x)))
                    }
                  />
                ),
              },
              {
                title: '型号',
                width: 130,
                render: (_, r: any, idx) => (
                  <Input
                    size="small"
                    value={r.model}
                    onChange={(e) =>
                      setItems((p) => p.map((x, i) => (i === idx ? { ...x, model: e.target.value } : x)))
                    }
                  />
                ),
              },
              {
                title: '单价 *',
                width: 140,
                render: (_, r: any, idx) => (
                  <InputNumber
                    size="small"
                    min={0}
                    style={{ width: '100%' }}
                    controls={false}
                    formatter={(v) => (v == null || v === '' ? '' : `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','))}
                    parser={(v) => (v ? Number(String(v).replace(/,/g, '')) : ('' as any))}
                    value={r.supplier_price ?? undefined}
                    onChange={(v) =>
                      setItems((p) =>
                        p.map((x, i) => (i === idx ? { ...x, supplier_price: v == null ? null : Number(v) } : x)),
                      )
                    }
                  />
                ),
              },
              {
                title: '货期',
                width: 100,
                render: (_, r: any, idx) => (
                  <Input
                    size="small"
                    value={r.lead_time}
                    onChange={(e) =>
                      setItems((p) => p.map((x, i) => (i === idx ? { ...x, lead_time: e.target.value } : x)))
                    }
                  />
                ),
              },
            ]}
          />

          <div>
            <Typography.Text>备注</Typography.Text>
            <Input.TextArea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
        </Space>
      </Modal>
    </>
  )
}
