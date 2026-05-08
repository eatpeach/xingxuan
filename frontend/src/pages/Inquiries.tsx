import { useRef, useState } from 'react'
import {
  ActionType,
  ModalForm,
  PageContainer,
  ProColumns,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components'
import { Button, Drawer, InputNumber, Input, Modal, Space, Table, Tag, Typography, message } from 'antd'
import { PlusOutlined, SendOutlined, FileDoneOutlined, EditOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
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
        toolBarRender={() => [<NewInquiry key="add" onOk={() => ref.current?.reload()} />]}
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

function NewInquiry({ onOk }: { onOk: () => void }) {
  return (
    <ModalForm
      title="新建询价单"
      trigger={
        <Button type="primary" icon={<PlusOutlined />}>
          新建询价
        </Button>
      }
      modalProps={{ destroyOnClose: true, width: 720 }}
      onFinish={async (v) => {
        const items = (v.items_text || '')
          .split('\n')
          .map((s: string) => s.trim())
          .filter(Boolean)
          .map((line: string, i: number) => {
            const [product_name, spec = '', qty = '1', unit = '件'] = line.split('|').map((s) => s.trim())
            return { line_no: i + 1, product_name, spec, qty: Number(qty) || 1, unit }
          })
        await api.post('createInquiry', { ...v, items })
        message.success('已创建')
        onOk()
        return true
      }}
    >
      <ProFormSelect
        name="customer_id"
        label="客户"
        rules={[{ required: true }]}
        showSearch
        request={async () => {
          const data = await api.get('listCustomers', { page_size: 200 })
          return data.items.map((c: any) => ({ label: `${c.name}（${c.company || c.phone || ''}）`, value: c.id }))
        }}
      />
      <ProFormText name="title" label="标题" />
      <ProFormTextArea
        name="items_text"
        label="明细（每行：产品|规格|数量|单位）"
        fieldProps={{ rows: 6, placeholder: '抛光砖 800x800|哑光|200|片\n实木地板|18mm|150|平方米' }}
        rules={[{ required: true }]}
      />
      <ProFormTextArea name="remark" label="备注" />
    </ModalForm>
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
