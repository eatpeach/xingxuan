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
import { Alert, Button, DatePicker, Drawer, Dropdown, Form, InputNumber, Input, Modal, Popover, Radio, Space, Spin, Steps, Switch, Table, Tag, Tooltip, Typography, Upload, message } from 'antd'
import { PlusOutlined, SendOutlined, FileDoneOutlined, EditOutlined, PictureOutlined, FileExcelOutlined, CopyOutlined, LockOutlined, GlobalOutlined, StopOutlined, DownOutlined, DownloadOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { api } from '../api'
import { copyText } from '../utils/copyText'
import CustomerCodeSearch from '../components/CustomerCodeSearch'
import { OrderDetail, ORDER_STATUS } from './Orders'
import { customerCellMergeWithClass, customerRowClass, groupByCustomer } from '../utils/groupByCustomer'
import InquiryComparePage from './InquiryCompare'
import IssueInvoiceButton from './IssueInvoiceButton'
import SendQuoteButton from './SendQuoteButton'
import SupplierQuoteActions from './SupplierQuoteActions'
import { isQuoteExpired, quoteStatusTag, quoteValidUntilText } from '../utils/quoteLifecycle'
import EditQuoteItemsButton from './EditQuoteItemsButton'
import { DragHandle, dndStyles, reorder, useRowDnd } from '../utils/rowDnd'
import SupplierBreakdown, { SupplierTags } from './SupplierBreakdown'
import DispatchModal, { DispatchCoverageHint } from './DispatchModal'

function fmtAmt(cur: string, n: number): string {
  if (cur === 'CNY') return `¥${Math.round(n).toLocaleString()}`
  if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toFixed(1)}B`
  if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}jt`
  return `Rp ${Math.round(n).toLocaleString()}`
}

/** 印尼增值税率。税点只有「含税 = 报价外加这个百分比」和「不含税 = 不涉税」两种，不让手填 */
const VAT_PCT = 11

/** 秒 → 「3天2小时」这种好读的时长；不足 1 分钟按刚刚算 */
function humanDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  if (s < 60) return '刚刚'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return h > 0 ? `${d}天${h}小时` : `${d}天`
  if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`
  return `${m}分钟`
}

/**
 * 状态标签 + 已停留时长；悬浮拉一次完整流转（各阶段耗时）。
 * 列表本身只带 status_since，避免每行都查一遍日志表拖慢列表。
 */
function StatusWithDuration({
  inquiryId,
  color,
  text,
  since,
}: {
  inquiryId: number
  color?: string
  text: string
  since?: string
}) {
  const [flow, setFlow] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (flow !== null || loading) return
    setLoading(true)
    try {
      const r = await api.get('getInquiryStatusFlow', { id: inquiryId })
      setFlow(r.items || [])
    } catch {
      setFlow([])
    } finally {
      setLoading(false)
    }
  }

  const stayed = since ? (Date.now() - new Date(since.replace(' ', 'T')).getTime()) / 1000 : 0

  return (
    <Popover
      trigger="hover"
      onOpenChange={(o) => o && load()}
      title="状态流转"
      content={
        <div style={{ width: 300, maxHeight: 320, overflowY: 'auto' }}>
          {loading && <Spin size="small" />}
          {flow && flow.length === 0 && <span className="muted">暂无流转记录</span>}
          {flow &&
            flow.map((f: any, i: number) => {
              const st = STATUS_TAG[f.status]
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '4px 0',
                    borderBottom: i < flow.length - 1 ? '1px dashed #f0f0f0' : undefined,
                  }}
                >
                  <span>
                    <Tag color={st?.color} style={{ marginRight: 4 }}>{st?.text || f.status}</Tag>
                    <span style={{ fontSize: 11, color: '#999' }}>{String(f.at || '').slice(5, 16)}</span>
                  </span>
                  <span style={{ fontSize: 12, color: i === flow.length - 1 ? '#fa8c16' : '#666' }}>
                    {humanDuration(f.seconds)}
                    {i === flow.length - 1 && '（至今）'}
                  </span>
                </div>
              )
            })}
        </div>
      }
    >
      <span style={{ cursor: 'default' }}>
        <Tag color={color}>{text}</Tag>
        {since && (
          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>已 {humanDuration(stayed)}</div>
        )}
      </span>
    </Popover>
  )
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
            {r.latest_quote_status && (
              <Tag color={quoteStatusTag(r.latest_quote_status).color} style={{ marginInlineEnd: 0 }}>
                {quoteStatusTag(r.latest_quote_status).text}
              </Tag>
            )}
            {/* 过期只提示不拦截 —— 列表里也要看得见，否则销售得点进去才知道 */}
            {isQuoteExpired({
              valid_until: r.latest_quote_valid_until,
              deal_status: r.latest_quote_deal_status,
            }) && (
              <Tag color="red" style={{ marginInlineEnd: 0 }}>
                报价已过期
              </Tag>
            )}
          </Space>
          <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>
            {Number(r.items_count || 0)} 项 · {r.no}
            {r.latest_quote_sent_at && ` · 报价发送于 ${String(r.latest_quote_sent_at).slice(0, 10)}`}
          </div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 150,
      valueType: 'select',
      valueEnum: Object.fromEntries(Object.entries(STATUS_TAG).map(([k, v]) => [k, { text: v.text }])),
      render: (_, r: any) => {
        const t = STATUS_TAG[r.status]
        return (
          <StatusWithDuration
            inquiryId={r.id}
            color={t?.color}
            text={t?.text || r.status}
            since={r.status_since}
          />
        )
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
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 165,
      // 按创建时间区间筛：ProTable 的 dateRange 会把值传成 [起, 止]，
      // 在 request 里转成 created_from / created_to 交给后端
      valueType: 'dateRange',
      sorter: (a: any, b: any) => String(a.created_at || '').localeCompare(String(b.created_at || '')),
      search: {
        transform: (v: any) => ({ created_from: v?.[0], created_to: v?.[1] }),
      },
      render: (_, r: any) => r.created_at || '-',
    },
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
        // 搜索区默认展开：筛选项（编号/标题/状态/创建时间区间）常用，收起来还要多点一次
        search={{ defaultCollapsed: false, labelWidth: 'auto' }}
        request={async (params) => {
          const data = await api.get('listInquiries', {
            keyword: params.code_search || params.code || params.title || params.no || '',
            status: params.status,
            pool: params.pool,
            // 创建时间区间（列上 search.transform 出来的两个字段）
            created_from: (params as any).created_from,
            created_to: (params as any).created_to,
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
  // 税只有「加」和「没有」两种：税率 > 0 就在报价基础上加，= 0 就是不涉税。
  // tax_included 恒为 0（价外加税），列还在是为了兼容存量数据，UI 不再暴露。
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
        tax_included: 0,
        tax_rate: taxRate / 100,
      })
      message.success('已创建')
      setOpen(false)
      setParsedItems([])
      setAiText('')
      setCurrency('IDR')
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
              {/* 不让手填税率：含税 = 在报价外加 VAT_PCT%，不含税 = 不涉税 */}
              <span>
                <Typography.Text type="secondary" style={{ marginRight: 8 }}>税点</Typography.Text>
                <Switch
                  checked={taxRate > 0}
                  onChange={(on) => setTaxRate(on ? VAT_PCT : 0)}
                  checkedChildren="含税"
                  unCheckedChildren="不含税"
                />
                <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {taxRate > 0 ? `报价外加 ${VAT_PCT}% VAT` : '不涉税，单据不显示 VAT'}
                </Typography.Text>
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
  const [supplierQuotes, setSupplierQuotes] = useState<any[]>([])
  const [editSupplierId, setEditSupplierId] = useState<number | null>(null)
  const [itemsEditOpen, setItemsEditOpen] = useState(false)
  const [overviewEditOpen, setOverviewEditOpen] = useState(false)
  const [shareLinks, setShareLinks] = useState<any[]>([])
  const [quotes, setQuotes] = useState<any[]>([])
  const [step, setStep] = useState(0)
  const [delivery, setDelivery] = useState({ receiver: '', schedule: '', expected: '', remark: '' })
  const [savingDelivery, setSavingDelivery] = useState(false)
  const [orders, setOrders] = useState<any[]>([])
  const [orderDetailId, setOrderDetailId] = useState<number | null>(null)
  /** 收款步骤里当前展开的订单：没手动切过就默认第一单（绝大多数商机只有一单） */
  const activeOrderId = orderDetailId ?? (orders[0]?.id ?? null)

  /**
   * 明细排序（20260824）：本地先动，后台异步落库。
   * 走 reorderInquiryItems（只 UPDATE line_no），所以已派单的商机也能排——
   * 供应商报价是按 inquiry_item_id 关联的，不会被打散。
   */
  const [itemRows, setItemRows] = useState<any[]>([])
  const [reordering, setReordering] = useState(false)

  useEffect(() => {
    setItemRows(data?.items || [])
  }, [data?.items])

  const persistOrder = async (rows: any[]) => {
    if (!id) return
    setReordering(true)
    try {
      await api.post('reorderInquiryItems', {
        inquiry_id: id,
        item_ids: rows.map((r) => r.id),
      })
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '顺序保存失败')
      setItemRows(data?.items || []) // 失败回滚到服务端顺序
    } finally {
      setReordering(false)
    }
  }

  const moveItem = (from: number, to: number) => {
    setItemRows((prev) => {
      const next = reorder(prev, from, to)
      persistOrder(next)
      return next
    })
  }

  const itemDnd = useRowDnd(moveItem)

  const load = async () => {
    if (!id) return
    const [a, b, c, q, o, sq] = await Promise.all([
      api.get('getInquiry', { id }),
      api.get('listDispatches', { id }),
      api.get('shareLinks', { id }),
      api.get('listCustomerQuotes', { inquiry_id: id, page: 1, page_size: 50 }),
      api.get('listOrders', { inquiry_id: id, page: 1, page_size: 50 }),
      api.get('listSupplierQuotes', { inquiry_id: id, page: 1, page_size: 50 }),
    ])
    setData(a.data)
    setDispatches(b.items)
    setShareLinks(c.items)
    setQuotes(q.items || [])
    setOrders(o.items || [])
    setSupplierQuotes(sq.items || [])
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

  // 报价状态 / 过期口径统一放 utils/quoteLifecycle.ts —— 详情和列表两处共用，
  // 各写一份迟早不一致。原先这里的局部映射表漏了 confirmed，界面直接印英文原文。

  // 未成交的报价单——「收款」步骤的开单入口（原先藏在报价管理抽屉里）
  const pendingQuotes = quotes.filter((q: any) => q.deal_status !== 'won')

  const markWon = async (q: any) => {
    const r = await api.post('setDealStatus', { quote_id: q.id, status: 'won' })
    message.success(`已标记成交，订单号 ${r.order_no}`)
    load()
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
  /**
   * 派单（dispatches）的状态标签。
   *
   * 🔴 既有缺陷，13 号单顺手修的，不是 13 号单引入的：
   * 这张表原先只有下面标「死键」的那五个，而 `dispatches.status` 实际写入的
   * 只有 `sent` 和 `responded` —— **两个真值一个都没有**，于是每一行派单
   * 都在界面上直接印英文原文（`Inquiries.tsx` 里是 `|| { text: d.status }` 回落打原文）。
   *
   * 死键保留不删（和 12 号单 `to_review` 的处理一致，清理死值是另一回事），
   * 但逐个标注清楚，免得下一个人又照着它们写代码：
   */
  const DISPATCH_STATUS: Record<string, { color: string; text: string }> = {
    // —— 真值：dispatches.status 实际只会是这两个 ——
    sent: { color: 'processing', text: '已派单' },       // inquiry.php:457 派单时写
    responded: { color: 'success', text: '已回报' },     // supplier_quote.php:103 / public_quote.php:205
    // —— 死键：从未被写入，留着不删，别照着它们写代码 ——
    pending: { color: 'orange', text: '等待报价' },      // 只是 schema DEFAULT，两处 INSERT 都显式写值
    submitted: { color: 'processing', text: '已提交' },  // 供应商报价的词汇，混进来的
    adopted: { color: 'success', text: '已采纳' },       // 同上
    rejected: { color: 'default', text: '未采纳' },      // 同上
    expired: { color: 'red', text: '已过期' },           // token 过期只拒绝访问，不回写 status
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
            <div className="inq-card-title" style={{ display: 'flex', alignItems: 'center' }}>
              <span>概览</span>
              <Button
                size="small"
                style={{ marginLeft: 'auto' }}
                icon={<EditOutlined />}
                onClick={() => setOverviewEditOpen(true)}
              >
                编辑
              </Button>
            </div>
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
                  <Tag color={Number(data.tax_rate) > 0 ? 'cyan' : 'default'} bordered={false}>
                    {/* 税率 0 = 不涉税，别再显示「不含税 · VAT 0%」这种自相矛盾的标签 */}
                    {Number(data.tax_rate) > 0 ? `加 VAT ${(Number(data.tax_rate) * 100).toFixed(0)}%` : '不涉税'}
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
                { title: '收款' },
                { title: '交付流程' },
              ]}
            />
          </section>

          {step === 0 && (
          <>
          {/* 明细 —— 支持拖拽排序（只改 line_no，派单后也安全） */}
          <section className="inq-card">
            <div className="inq-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>明细 <span className="muted">（{data.items?.length || 0} 行）</span></span>
              <span className="muted" style={{ fontSize: 12 }}>· 按住 ⠿ 上下拖动可调整顺序</span>
              {reordering && <Tag color="processing" style={{ marginInlineEnd: 0 }}>保存顺序中…</Tag>}
              {['draft', 'to_dispatch'].includes(data.status) ? (
                <Button size="small" style={{ marginLeft: 'auto' }} icon={<EditOutlined />} onClick={() => setItemsEditOpen(true)}>
                  编辑明细
                </Button>
              ) : (
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
                  已派单，内容锁定（顺序仍可调）
                </span>
              )}
            </div>
            <Table
              size="small"
              rowKey="id"
              dataSource={itemRows}
              pagination={false}
              onRow={(_, index) => itemDnd.rowProps(index as number)}
              columns={[
                { title: '', width: 34, align: 'center' as const, render: () => <DragHandle /> },
                { title: '#', width: 46, render: (_: any, __: any, i: number) => i + 1 },
                { title: '产品名', dataIndex: 'product_name', render: (v: string) => <strong>{v}</strong> },
                { title: '规格', dataIndex: 'spec', render: (v: string) => v || <span className="muted">-</span> },
                { title: '数量', width: 100, render: (_, r: any) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.qty} {r.unit}</span> },
                { title: '备注', dataIndex: 'remark', render: (v: string) => v || <span className="muted">-</span> },
                {
                  title: '排序',
                  width: 76,
                  align: 'center' as const,
                  render: (_: any, __: any, i: number) => (
                    <Space size={2}>
                      <Button size="small" type="text" disabled={i === 0}
                        onClick={() => moveItem(i, i - 1)}>↑</Button>
                      <Button size="small" type="text" disabled={i === itemRows.length - 1}
                        onClick={() => moveItem(i, i + 1)}>↓</Button>
                    </Space>
                  ),
                },
              ]}
            />
          </section>

          {/* 派单 */}
          <section className="inq-card">
            <div className="inq-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>派单</span>
              <span className="muted" style={{ fontSize: 12 }}>
                一张清单可拆开派给多家：电缆给 A、管材给 B
              </span>
              <span style={{ marginLeft: 'auto' }}>
                <DispatchCoverageHint inquiryId={Number(data.id)} refreshKey={dispatches.length} />
              </span>
            </div>
            <Space wrap size={12}>
              <DispatchModal inquiry={data} onDispatched={load} />
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
                        {d.scoped_count > 0 ? (
                          <Tooltip title="只派了部分明细给这家，他打开链接只看得到这几行">
                            <Tag color="blue" style={{ marginInlineEnd: 0, cursor: 'help' }}>
                              {d.scoped_count} / {d.total_items} 行
                            </Tag>
                          </Tooltip>
                        ) : (
                          <Tag style={{ marginInlineEnd: 0 }}>整单 {d.total_items} 行</Tag>
                        )}
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

          {/* 供应商报价（含代录入） */}
          <section className="inq-card">
            <div className="inq-card-title">
              供应商报价 <span className="muted">（{supplierQuotes.length} 单）</span>
            </div>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
              {supplierQuotes.length === 0
                ? '供应商通过链接提交、或销售代录入的报价都会列在这里。供应商不方便用链接时点下方按钮手动录入。'
                : '已有报价可点行尾「编辑」修改；还有别家供应商要录入，点下方链接。'}
            </Typography.Paragraph>
            {/* 已录入报价后收起醒目按钮，只留轻量入口，避免和每行「编辑」抢注意力 */}
            <div style={{ marginBottom: 12 }}>
              <InternalQuoteEntry
                inquiry={data}
                onSaved={load}
                editSupplierId={editSupplierId}
                onEditConsumed={() => setEditSupplierId(null)}
                compact={supplierQuotes.length > 0}
              />
            </div>
            <Table
              size="small"
              rowKey="id"
              dataSource={supplierQuotes}
              pagination={false}
              locale={{ emptyText: '还没有供应商报价' }}
              expandable={{
                expandedRowRender: (sq: any) => <SupplierQuoteItems quoteId={sq.id} currency={sq.currency} />,
              }}
              columns={[
                { title: '单号', dataIndex: 'no', width: 150 },
                { title: '供应商', dataIndex: 'supplier_name', width: 180 },
                {
                  title: '金额',
                  align: 'right' as const,
                  width: 150,
                  render: (_, sq: any) => (
                    <strong style={{ whiteSpace: 'nowrap' }}>
                      {(sq.currency === 'CNY' ? '¥ ' : 'Rp ') + Math.round(Number(sq.total)).toLocaleString()}
                    </strong>
                  ),
                },
                {
                  title: '状态',
                  width: 90,
                  render: (_, sq: any) => {
                    const m: Record<string, { color: string; text: string }> = {
                      submitted: { color: 'processing', text: '已提交' },
                      adopted: { color: 'success', text: '已采纳' },
                      // rejected 是 13 号单引入的：采纳一条时可把其余标为「未采纳」。
                      // 它和 void 的区别是「没中标但报价仍有效」，仍留在对比页。
                      rejected: { color: 'default', text: '未采纳' },
                      void: { color: 'default', text: '已作废' },
                    }
                    const t = m[sq.status]
                    return <Tag color={t?.color}>{t?.text || sq.status}</Tag>
                  },
                },
                { title: '提交时间', dataIndex: 'created_at', width: 165 },
                {
                  title: '操作',
                  width: 150,
                  render: (_, sq: any) => (
                    <Space size={8}>
                      <SupplierQuoteActions quote={sq} siblings={supplierQuotes} onDone={load} />
                      <a onClick={() => setEditSupplierId(Number(sq.supplier_id))}>编辑</a>
                    </Space>
                  ),
                },
              ]}
            />
          </section>
          </>
          )}

          {step === 1 && (
            <>
            {/* 上半：对比选价并生成 */}
            <section className="inq-card">
              <div className="inq-card-title">对比供应商报价 · 生成对客报价</div>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
                勾选每行采用的供应商报价并设定加价，生成后将覆盖下方现有对客报价。
              </Typography.Paragraph>
              <InquiryComparePage inquiryId={Number(data.id)} embedded onGenerated={load} />
            </section>

            {/* 下半：当前对客报价——只留下载入口，状态流转在「收款」步骤 */}
            <section className="inq-card">
              <div className="inq-card-title">
                当前对客报价 <span className="muted">（{quotes.length} 单）</span>
              </div>
              {quotes.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  还没有对客报价，先在上一步收齐供应商报价，再用上方对比表生成
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {quotes.map((q: any) => (
                    <div
                      key={q.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '12px 14px',
                        border: '1px solid #f0f0f0',
                        borderRadius: 8,
                        background: '#fafbfc',
                      }}
                    >
                      <strong>{q.no}</strong>
                      <strong style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {(q.currency === 'CNY' ? '¥ ' : 'Rp ') + Math.round(Number(q.total)).toLocaleString()}
                      </strong>
                      <Tag color={quoteStatusTag(q.status).color} style={{ marginInlineEnd: 0 }}>
                        {quoteStatusTag(q.status).text}
                      </Tag>
                      {/* 过期只是提示，不拦截任何操作（CTO 裁决：业务上经常按老报价成交） */}
                      {isQuoteExpired(q) && (
                        <Tag color="red" style={{ marginInlineEnd: 0 }}>
                          已过期 {quoteValidUntilText(q)}
                        </Tag>
                      )}
                      {q.sent_at && (
                        <span className="muted" style={{ fontSize: 12 }}>
                          发送于 {String(q.sent_at).slice(0, 16)}
                        </span>
                      )}
                      {!q.sent_at && !isQuoteExpired(q) && q.valid_until && (
                        <span className="muted" style={{ fontSize: 12 }}>
                          有效期至 {quoteValidUntilText(q)}
                        </span>
                      )}
                      {q.invoice_no && (
                        <span className="muted" style={{ fontSize: 12 }}>发票 {q.invoice_no}</span>
                      )}
                      {/* 多供应商：长清单常常几家分供，这里直接标出来 */}
                      <QuoteSupplierTags quoteId={q.id} />
                      <Space size={8} style={{ marginLeft: 'auto' }}>
                        <EditQuoteItemsButton quote={q} onSaved={load} />
                        <SendQuoteButton quote={q} onSent={load} />
                        <Button
                          type="primary"
                          icon={<DownloadOutlined />}
                          onClick={() => window.open(`/quotes/${q.id}/print`, '_blank')}
                        >
                          下载报价单
                        </Button>
                      </Space>
                    </div>
                  ))}
                </div>
              )}
            </section>
            </>
          )}

          {step === 2 && (
            <section className="inq-card">
              <div className="inq-card-title">收款 <span className="muted">（{orders.length} 单）</span></div>
              {pendingQuotes.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Space wrap size={8}>
                    {pendingQuotes.map((q: any) => (
                      <Button key={q.id} type="primary" icon={<FileDoneOutlined />} onClick={() => markWon(q)}>
                        {quotes.length > 1 ? `${q.no} 成交并生成订单` : '标记成交并生成订单'}
                      </Button>
                    ))}
                  </Space>
                  <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                    客户确认报价后点这里，系统自动开单，再办合同 / 收款 / 发票 / 返佣。
                  </div>
                </div>
              )}
              <Table
                size="small"
                rowKey="id"
                dataSource={orders}
                pagination={false}
                locale={{
                  emptyText: '还没有订单。客户确认报价后，点上方「标记成交并生成订单」',
                }}
                columns={[
                  {
                    title: '订单号',
                    dataIndex: 'no',
                    width: 150,
                    // 多单时点单号切换下方操作区（不再弹抽屉，内容就在本页平铺）
                    render: (v: any, o: any) => (
                      <a
                        style={{ fontWeight: o.id === activeOrderId ? 700 : undefined }}
                        onClick={() => setOrderDetailId(o.id)}
                      >
                        {v}
                      </a>
                    ),
                  },
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
                    title: '发票',
                    width: 130,
                    render: (_, o: any) =>
                      o.invoice_no ? (
                        <a onClick={() => window.open(`/quotes/${o.quote_id}/invoice`, '_blank')}>
                          {o.invoice_no}
                        </a>
                      ) : (
                        <span className="muted">未开</span>
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
                    width: 130,
                    render: (_, o: any) => (
                      <Space size={10}>
                        {/* 开票入口原先藏在「履约管理」抽屉的发票 Tab 里，两层太深，提到列表这一层。
                            已开票也保留入口＝重开：后端 issueInvoice 对已开票单不换号，只更新主体/银行快照 */}
                        <IssueInvoiceButton
                          quoteId={o.quote_id}
                          onIssued={load}
                          openAfterIssue
                          asLink
                        >
                          {o.invoice_no ? '重开发票' : '开发票'}
                        </IssueInvoiceButton>
                      </Space>
                    ),
                  },
                ]}
              />
              {/* 订单操作区直接平铺在这一页：录款 / 传付款凭证 / 发票 / 退款 / 返佣 / 完成
                  都在下面这块，不再弹订单抽屉（弹窗套弹窗层级太深，东西找不到） */}
              {activeOrderId && (
                <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                  <OrderDetail
                    id={activeOrderId}
                    embedded
                    defaultTab="payment"
                    onClose={() => { setOrderDetailId(null); load() }}
                  />
                </div>
              )}
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

          {/* 订单详情：复用独立页的抽屉组件，关闭后刷新本页数据 */}
          <InquiryItemsEdit
            open={itemsEditOpen}
            inquiry={data}
            onClose={() => setItemsEditOpen(false)}
            onSaved={() => {
              setItemsEditOpen(false)
              load()
            }}
          />
          <InquiryOverviewEdit
            open={overviewEditOpen}
            inquiry={data}
            onClose={() => setOverviewEditOpen(false)}
            onSaved={() => {
              setOverviewEditOpen(false)
              load()
            }}
          />
        </div>
      )}
    </Drawer>
  )
}

/** 编辑概览：标题/截止/备注任何状态可改；货币/税点仅未派单可改（供应商报价继承币种税率，派单后改会对不上口径） */
function InquiryOverviewEdit({
  open,
  inquiry,
  onClose,
  onSaved,
}: {
  open: boolean
  inquiry: any
  onClose: () => void
  onSaved: () => void
}) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  // 税点/币种一律可改：填错往往开票时才发现，锁死的话只能作废订单重来（05 号单硬拦）。
  // 已派单的只给警告，不再禁用——后端 updateInquiryBasic 会把新税点同步到报价单和发票。
  const taxLocked = !['draft', 'to_dispatch'].includes(inquiry?.status)

  useEffect(() => {
    if (!open || !inquiry) return
    form.setFieldsValue({
      title: inquiry.title || '',
      deadline: inquiry.deadline ? dayjs(inquiry.deadline) : undefined,
      remark: inquiry.remark || '',
      currency: inquiry.currency || 'IDR',
      has_tax: Number(inquiry.tax_rate ?? 0.11) > 0,
    })
  }, [open, inquiry, form])

  const submit = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      const basic = {
        id: inquiry.id,
        title: v.title || '',
        deadline: v.deadline ? dayjs(v.deadline).format('YYYY-MM-DD HH:mm:ss') : null,
        remark: v.remark || '',
      }
      const tax = {
        currency: v.currency,
        // 恒为价外加税；含税就是报价外加 VAT_PCT%，不含税就是 0。
        // 老单子若是价内含税，编辑保存一次就统一过来了
        tax_included: 0,
        tax_rate: v.has_tax ? VAT_PCT / 100 : 0,
      }
      // 未派单走 updateInquiry（还能改客户）；已派单走 updateInquiryBasic，
      // 它同样接税点，并把新税点同步到已生成的报价单 / 发票
      const r: any = taxLocked
        ? await api.post('updateInquiryBasic', { ...basic, ...tax })
        : await api.post('updateInquiry', { ...basic, customer_id: inquiry.customer_id, ...tax })
      const synced = Number(r?.synced_quotes || 0)
      message.success(synced > 0 ? `已保存，${synced} 张报价单/ 发票已按新税点更新` : '已保存')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="编辑商机概览"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      width={520}
      zIndex={9999}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="title" label="商机名称">
          <Input placeholder="如：巴淡岛数据中心 电缆一批" />
        </Form.Item>
        <Form.Item name="deadline" label="截止时间（选填）">
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="remark" label="备注（选填）">
          <Input.TextArea rows={3} />
        </Form.Item>
        {taxLocked && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="已派单，改税点会影响已生成的报价单和发票"
            description="供应商报价是按商机当时的币种和税率提交的，改完口径可能对不上。保存后，该商机下的报价单与发票会按新税点重新计算金额（明细和订单不动）。"
          />
        )}
        <Space size={16} align="start">
          <Form.Item name="currency" label="货币">
            <Radio.Group>
              <Radio.Button value="IDR">IDR</Radio.Button>
              <Radio.Button value="CNY">CNY</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="has_tax" label="税点" valuePropName="checked">
            <Switch checkedChildren="含税" unCheckedChildren="不含税" />
          </Form.Item>
        </Space>
        {/* 「不含税」是价外加税，不是不涉税——这一条不写清楚，
            用户以为关掉开关单据就没税了，实际只是从倒推变成外加 */}
        <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.8 }}>
          <strong>含税</strong> = 报价单和发票都在报价基础上<strong>外加 {VAT_PCT}% VAT</strong>，合计 = 报价 × {(1 + VAT_PCT / 100).toFixed(2)}。
          <br />
          <strong>不含税</strong> = 不涉税，单据不出现任何 VAT 行。
        </div>
      </Form>
    </Modal>
  )
}

/** 编辑商机产品明细（仅未派单可用；保存走 updateInquiry 全量替换） */
function InquiryItemsEdit({
  open,
  inquiry,
  onClose,
  onSaved,
}: {
  open: boolean
  inquiry: any
  onClose: () => void
  onSaved: () => void
}) {
  const [rows, setRows] = useState<any[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setRows(
      (inquiry?.items || []).map((it: any) => ({
        product_name: it.product_name || '',
        spec: it.spec || '',
        unit: it.unit || '件',
        qty: Number(it.qty) || 1,
        remark: it.remark || '',
      })),
    )
  }, [open, inquiry])

  const setCell = (idx: number, key: string, v: any) =>
    setRows((p) => p.map((r, i) => (i === idx ? { ...r, [key]: v } : r)))

  // 弹窗内拖拽排序：纯前端调顺序，点保存时按数组顺序重排 line_no
  const moveRow = (from: number, to: number) => setRows((p) => reorder(p, from, to))
  const rowDnd = useRowDnd(moveRow)

  const submit = async () => {
    const valid = rows.filter((r) => String(r.product_name).trim() !== '')
    if (!valid.length) return message.warning('至少保留一行有产品名的明细')
    const bad = valid.find((r) => !(Number(r.qty) > 0))
    if (bad) return message.warning(`「${bad.product_name}」数量需大于 0`)
    setSaving(true)
    try {
      await api.post('updateInquiry', {
        id: inquiry.id,
        customer_id: inquiry.customer_id,
        title: inquiry.title || '',
        deadline: inquiry.deadline || null,
        remark: inquiry.remark || '',
        items: valid.map((r, i) => ({ ...r, line_no: i + 1 })),
      })
      message.success('明细已保存')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="编辑产品明细"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      width={860}
      zIndex={9999}
      destroyOnClose
    >
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        按住 ⠿ 上下拖动可调整顺序，保存后序号按新顺序重排
      </div>
      <style>{dndStyles}</style>
      <Table
        size="small"
        rowKey={(_, i) => String(i)}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: '没有明细，点下方添加' }}
        onRow={(_, index) => rowDnd.rowProps(index as number)}
        columns={[
          { title: '', width: 34, align: 'center' as const, render: () => <DragHandle /> },
          { title: '#', width: 42, render: (_: any, __: any, i: number) => i + 1 },
          {
            title: '产品名 *',
            render: (_, r: any, idx) => (
              <Input size="small" value={r.product_name} onChange={(e) => setCell(idx, 'product_name', e.target.value)} />
            ),
          },
          {
            title: '规格',
            width: 160,
            render: (_, r: any, idx) => (
              <Input size="small" value={r.spec} onChange={(e) => setCell(idx, 'spec', e.target.value)} />
            ),
          },
          {
            title: '数量 *',
            width: 100,
            render: (_, r: any, idx) => (
              <InputNumber
                size="small"
                min={0}
                style={{ width: '100%' }}
                value={r.qty}
                onChange={(v) => setCell(idx, 'qty', v == null ? null : Number(v))}
              />
            ),
          },
          {
            title: '单位',
            width: 90,
            render: (_, r: any, idx) => (
              <Input size="small" value={r.unit} onChange={(e) => setCell(idx, 'unit', e.target.value)} />
            ),
          },
          {
            title: '备注',
            width: 160,
            render: (_, r: any, idx) => (
              <Input size="small" value={r.remark} onChange={(e) => setCell(idx, 'remark', e.target.value)} />
            ),
          },
          {
            title: '排序',
            width: 72,
            align: 'center' as const,
            render: (_: any, __: any, idx: number) => (
              <Space size={2}>
                <Button size="small" type="text" disabled={idx === 0} onClick={() => moveRow(idx, idx - 1)}>↑</Button>
                <Button size="small" type="text" disabled={idx === rows.length - 1} onClick={() => moveRow(idx, idx + 1)}>↓</Button>
              </Space>
            ),
          },
          {
            title: '',
            width: 50,
            render: (_, __, idx) => (
              <a style={{ color: '#ff4d4f' }} onClick={() => setRows((p) => p.filter((_, i) => i !== idx))}>
                删
              </a>
            ),
          },
        ]}
      />
      <Button
        type="dashed"
        block
        style={{ marginTop: 10 }}
        icon={<PlusOutlined />}
        onClick={() => setRows((p) => [...p, { product_name: '', spec: '', unit: '件', qty: 1, remark: '' }])}
      >
        添加一行
      </Button>
    </Modal>
  )
}

/** 报价行上的供应商标签：按需拉取拆分（一个商机通常就 1-2 张报价，开销可忽略） */
function QuoteSupplierTags({ quoteId }: { quoteId: number }) {
  const [sups, setSups] = useState<any[]>([])
  useEffect(() => {
    let alive = true
    api
      .get('getQuoteSupplierBreakdown', { quote_id: quoteId })
      .then((r) => { if (alive) setSups(r.suppliers || []) })
      .catch(() => {})
    return () => { alive = false }
  }, [quoteId])
  if (sups.length === 0) return null
  const named = sups.filter((g: any) => g.supplier_id !== null)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {named.length > 1 && (
        <Tag color="gold" style={{ marginInlineEnd: 0 }}>{named.length} 家供货</Tag>
      )}
      <SupplierTags suppliers={sups} max={2} />
    </span>
  )
}

const detailStyles = `
${dndStyles}
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

/** 供应商报价展开明细：展开时才拉取，避免详情页一次性打多个请求 */
function SupplierQuoteItems({ quoteId, currency }: { quoteId: number; currency?: string }) {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => {
    let alive = true
    api
      .get('getSupplierQuote', { id: quoteId })
      .then((r) => {
        if (alive) setRows(r.data?.items || [])
      })
      .catch(() => {
        if (alive) setRows([])
      })
    return () => {
      alive = false
    }
  }, [quoteId])
  const sym = currency === 'CNY' ? '¥ ' : 'Rp '
  return (
    <Table
      size="small"
      rowKey="id"
      loading={rows === null}
      dataSource={rows || []}
      pagination={false}
      columns={[
        { title: '品牌', dataIndex: 'brand', width: 120, render: (v: string) => v || '-' },
        { title: '型号', dataIndex: 'model', width: 120, render: (v: string) => v || '-' },
        { title: '规格', dataIndex: 'spec', render: (v: string) => v || '-' },
        {
          title: '数量',
          width: 90,
          render: (_, r: any) => `${Number(r.qty).toLocaleString()} ${r.unit || ''}`,
        },
        {
          title: '单价',
          align: 'right' as const,
          width: 130,
          render: (_, r: any) => sym + Math.round(Number(r.supplier_price)).toLocaleString(),
        },
        { title: '货期', dataIndex: 'lead_time', width: 90, render: (v: string) => v || '-' },
        { title: '备注', dataIndex: 'remark', render: (v: string) => v || '-' },
      ]}
    />
  )
}

function InternalQuoteEntry({
  inquiry,
  onSaved,
  editSupplierId,
  onEditConsumed,
  compact = false,
}: {
  inquiry: any
  onSaved: () => void
  /** 从供应商报价列表点「编辑」时传入，打开弹窗并带出该供应商已录内容 */
  editSupplierId?: number | null
  onEditConsumed?: () => void
  /** 已有报价时收起成文字链接，不再占用醒目按钮位 */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [supplierId, setSupplierId] = useState<number | undefined>()
  const [supplierOptions, setSupplierOptions] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [existingQuote, setExistingQuote] = useState<any>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiText, setAiText] = useState('')

  const applyAiResult = (res: any) => {
    const aiItems = res.items || []
    if (aiItems.length === 0) {
      message.warning('AI 没识别到能匹配的行')
      return
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
    message.success(`AI 识别 ${aiItems.length}/${res.total_inquiry_items || items.length} 行，请核对单价后保存`)
  }

  const aiParseText = async () => {
    if (!aiText.trim()) {
      message.warning('请粘贴报价文本')
      return
    }
    setAiBusy(true)
    try {
      const fd = new FormData()
      fd.append('text', aiText.trim())
      fd.append('inquiry_id', String(inquiry.id))
      const res = await api.upload('aiParseSupplierQuoteForInquiry', fd)
      applyAiResult(res)
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || 'AI 识别失败')
    } finally {
      setAiBusy(false)
    }
  }

  const aiParseFile = async (file: File) => {
    if (file.size > 30 * 1024 * 1024) {
      message.error('文件不能超过 30MB')
      return false
    }
    setAiBusy(true)
    try {
      // PDF → 浏览器内转图，绕过服务器 poppler 依赖
      let uploadFile = file
      try {
        const { convertPdfToImageIfNeeded } = await import('../utils/pdfToImages')
        uploadFile = await convertPdfToImageIfNeeded(file)
        if (uploadFile !== file) message.info('PDF 已在浏览器内转为图片', 1.5)
      } catch (e: any) {
        message.error('PDF 转图失败：' + (e?.message || ''))
        setAiBusy(false)
        return false
      }
      const fd = new FormData()
      fd.append('file', uploadFile)
      fd.append('inquiry_id', String(inquiry.id))
      const res = await api.upload('aiParseSupplierQuoteForInquiry', fd)
      applyAiResult(res)
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

  // 外部点「编辑」：开弹窗 → 载供应商列表 → 预选并带出已录内容
  useEffect(() => {
    if (!editSupplierId) return
    ;(async () => {
      await init()
      setSupplierId(editSupplierId)
      await loadExisting(editSupplierId)
      onEditConsumed?.()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSupplierId])


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
      {compact ? (
        <a onClick={init} style={{ fontSize: 13 }}>
          <PlusOutlined /> 再录一家供应商报价
        </a>
      ) : (
        <Button icon={<EditOutlined />} onClick={init}>
          代录入报价
        </Button>
      )}
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
                fieldProps={{
                  style: { width: 360 },
                  value: supplierId,
                  onChange: (v: any) => {
                    setSupplierId(v)
                    loadExisting(Number(v))
                  },
                }}
                options={supplierOptions}
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
              自动按产品名+规格匹配询价行，填进下方单价
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
                  {aiBusy ? '识别中...' : '📎 上传文件（图/PDF/Excel）'}
                </Button>
              </Upload>
            </div>
            <div style={{ marginTop: 10 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                或者直接粘贴供应商发的文字（微信、邮件复制的都行）：
              </Typography.Text>
              <Input.TextArea
                rows={4}
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder={`如：\n铜电缆 NYA 1x35   200米   Rp 85,000\n角铝 3.5           30支   Rp 220,000\n交货 7 天，付款方式：定金 30% 尾款货前付清`}
                style={{ marginTop: 4 }}
              />
              <div style={{ marginTop: 6, textAlign: 'right' }}>
                <Button size="small" type="primary" loading={aiBusy} onClick={aiParseText}>
                  📝 识别粘贴的文字
                </Button>
              </div>
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
