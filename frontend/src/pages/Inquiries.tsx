import { useEffect, useRef, useState } from 'react'
import {
  ActionType,
  ModalForm,
  PageContainer,
  ProColumns,
  ProFormSelect,
  ProFormText,
  ProTable,
} from '@ant-design/pro-components'
import { Button, Drawer, Form, InputNumber, Input, Modal, Space, Table, Tag, Typography, message } from 'antd'
import { PlusOutlined, SendOutlined, FileDoneOutlined, EditOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'

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

  useEffect(() => {
    const cid = (location.state as any)?.newInquiryCustomerId
    if (cid) {
      setPresetCustomerId(cid)
      window.history.replaceState({}, document.title)
    }
  }, [location.state])

  const cols: ProColumns<Inquiry>[] = [
    { title: '单号', dataIndex: 'no' },
    { title: '客户', dataIndex: 'customer_name', search: false },
    { title: '标题', dataIndex: 'title' },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: Object.fromEntries(Object.entries(STATUS_TAG).map(([k, v]) => [k, { text: v.text }])),
      render: (_, r) => {
        const t = STATUS_TAG[r.status]
        return <Tag color={t?.color}>{t?.text || r.status}</Tag>
      },
    },
    { title: '创建时间', dataIndex: 'created_at', search: false },
    {
      title: '操作',
      valueType: 'option',
      render: (_, row) => [
        <a key="view" onClick={() => setDetailId(row.id)}>
          详情/派单
        </a>,
        <a
          key="del"
          style={{ color: '#ff4d4f' }}
          onClick={() =>
            Modal.confirm({
              title: `删除询价单 ${row.no}？`,
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
          }
        >
          删除
        </a>,
      ],
    },
  ]

  return (
    <PageContainer title="询价管理">
      <ProTable<Inquiry>
        actionRef={ref}
        rowKey="id"
        columns={cols}
        request={async (params) => {
          const data = await api.get('listInquiries', {
            keyword: params.title || params.no || '',
            status: params.status,
            page: params.current,
            page_size: params.pageSize,
          })
          return { data: data.items, total: data.total, success: true }
        }}
        toolBarRender={() => [
          <NewInquiry
            key="add"
            presetCustomerId={presetCustomerId}
            onOpened={() => setPresetCustomerId(null)}
            onOk={() => ref.current?.reload()}
          />,
        ]}
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

  useEffect(() => {
    if (presetCustomerId) {
      setOpen(true)
      setTimeout(() => form.setFieldsValue({ customer_id: presetCustomerId }), 0)
      onOpened?.()
    }
  }, [presetCustomerId])

  const aiParse = async () => {
    if (!aiText.trim()) {
      message.warning('请先粘贴客户的询价文本')
      return
    }
    setAiParsing(true)
    try {
      const res = await api.post('aiParseInquiryText', { text: aiText })
      if (!res.items || res.items.length === 0) {
        message.warning('AI 没识别到产品行，请检查文本或直接手填')
      } else {
        message.success(`AI 识别到 ${res.items.length} 行产品`)
      }
      setParsedItems(res.items || [])
      // 把 AI 识别的备注追加到表单（不覆盖用户已填的）
      const oldRemark = form.getFieldValue('remark') || ''
      const newRemark = res.remark
        ? (oldRemark ? `${oldRemark}\n${res.remark}` : res.remark)
        : oldRemark
      form.setFieldsValue({ remark: newRemark })
    } catch (e: any) {
      message.error(e?.response?.data?.message || e.message || 'AI 解析失败')
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
      })
      message.success('已创建')
      setOpen(false)
      setParsedItems([])
      setAiText('')
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
        新建询价
      </Button>
      <Modal
        title="新建询价单"
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
                const groupName = `[${companyName} ${c.code || c.id}] ${c.short_name || c.name}`
                const suffix = c.company ? `（${c.company}）` : ''
                return { label: `${groupName}${suffix}`, value: c.id }
              })
            }}
          />
          <ProFormText name="title" label="标题" />

          <Form.Item label={<span>客户原文 / 询价文本（粘贴整段，<a onClick={aiParse}>AI 智能解析 →</a>）</span>}>
            <Input.TextArea
              rows={5}
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              placeholder={`粘贴客户微信里发的清单，比如：\n插座： 124 个\n明装接线盒： 91 个\n15W 嵌入式筒灯： 12 个\n灯光颜色全部用白光 6500K`}
            />
            <div style={{ marginTop: 8 }}>
              <Button size="small" type="primary" loading={aiParsing} onClick={aiParse}>
                AI 解析为明细
              </Button>
              <Typography.Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
                需要先在「系统设置」配置 OpenAI API Key
              </Typography.Text>
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

function InquiryDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const nav = useNavigate()
  const [data, setData] = useState<any>(null)
  const [dispatches, setDispatches] = useState<any[]>([])
  const [shareLinks, setShareLinks] = useState<any[]>([])

  const load = async () => {
    if (!id) return
    const [a, b, c] = await Promise.all([
      api.get('getInquiry', { id }),
      api.get('listDispatches', { id }),
      api.get('shareLinks', { id }),
    ])
    setData(a.data)
    setDispatches(b.items)
    setShareLinks(c.items)
  }

  if (id && !data) load()

  const dispatch = async (supplier_ids: number[]) => {
    await api.post('dispatchInquiry', { id, supplier_ids, expire_days: 7 })
    message.success('已派单')
    load()
  }

  return (
    <Drawer
      title={data ? `询价单 ${data.no}` : '询价详情'}
      width={760}
      open={!!id}
      onClose={() => {
        setData(null)
        onClose()
      }}
      destroyOnClose
    >
      {data && (
        <div>
          <Typography.Title level={5}>明细</Typography.Title>
          <ul>
            {data.items.map((it: any) => (
              <li key={it.id}>
                {it.line_no}. {it.product_name} | {it.spec} | {it.qty} {it.unit}
              </li>
            ))}
          </ul>

          <Button
            type="primary"
            icon={<FileDoneOutlined />}
            style={{ marginRight: 8 }}
            onClick={() => nav(`/inquiries/${data.id}/compare`)}
          >
            对比 / 生成客户报价
          </Button>

          <Typography.Title level={5} style={{ marginTop: 24 }}>
            派单
          </Typography.Title>
          <ModalForm
            title="选择供应商派单"
            trigger={<Button icon={<SendOutlined />}>派单给供应商</Button>}
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
                const data = await api.get('listSuppliers', { page_size: 200 })
                return data.items.map((s: any) => ({ label: `${s.name}（${s.category || '通用'}）`, value: s.id }))
              }}
            />
          </ModalForm>

          <ul style={{ marginTop: 12 }}>
            {dispatches.map((d) => {
              const link = shareLinks.find((l) => l.dispatch_id === d.id)
              return (
                <li key={d.id} style={{ marginBottom: 6 }}>
                  <Tag>{d.status}</Tag>
                  {d.supplier_name}：
                  <Typography.Text copyable={{ text: link?.url }} style={{ fontSize: 12 }}>
                    {link?.url}
                  </Typography.Text>
                </li>
              )
            })}
          </ul>

          <Typography.Title level={5} style={{ marginTop: 24 }}>
            代录入供应商报价
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            供应商不方便用链接时，销售拿到报价后可以在这里代录。
          </Typography.Paragraph>
          <InternalQuoteEntry inquiry={data} onSaved={load} />
        </div>
      )}
    </Drawer>
  )
}

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

  const init = async () => {
    setOpen(true)
    setItems(
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
      })),
    )
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
                onChange={(v: any) => setSupplierId(v)}
                showSearch
                placeholder="选择供应商"
              />
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
                width: 120,
                render: (_, r: any, idx) => (
                  <InputNumber
                    size="small"
                    min={0}
                    style={{ width: '100%' }}
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
