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
import { Button, Drawer, Tag, Typography, message } from 'antd'
import { PlusOutlined, SendOutlined } from '@ant-design/icons'
import { api, Page } from '../api'

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
  title: string
  status: string
  created_at: string
  items: any[]
}

export default function InquiriesPage() {
  const ref = useRef<ActionType>()
  const [detailId, setDetailId] = useState<number | null>(null)

  const cols: ProColumns<Inquiry>[] = [
    { title: '单号', dataIndex: 'no' },
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
    { title: '创建时间', dataIndex: 'created_at', valueType: 'dateTime', search: false },
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
          const { data } = await api.get<Page<Inquiry>>('/inquiries', {
            params: {
              keyword: params.title || params.no || '',
              status: params.status,
              page: params.current,
              page_size: params.pageSize,
            },
          })
          return { data: data.items, total: data.total, success: true }
        }}
        toolBarRender={() => [
          <NewInquiry key="add" onOk={() => ref.current?.reload()} />,
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
        await api.post('/inquiries', { ...v, items })
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
          const { data } = await api.get('/customers', { params: { page_size: 200 } })
          return data.items.map((c: any) => ({ label: `${c.name}（${c.company || c.phone}）`, value: c.id }))
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
  const [data, setData] = useState<any>(null)
  const [dispatches, setDispatches] = useState<any[]>([])
  const [shareLinks, setShareLinks] = useState<any[]>([])

  const load = async () => {
    if (!id) return
    const [a, b, c] = await Promise.all([
      api.get(`/inquiries/${id}`),
      api.get(`/inquiries/${id}/dispatches`),
      api.get(`/inquiries/${id}/share-links`),
    ])
    setData(a.data)
    setDispatches(b.data)
    setShareLinks(c.data)
  }

  if (id && !data) load()

  const dispatch = async (supplier_ids: number[]) => {
    await api.post(`/inquiries/${id}/dispatch`, { supplier_ids, expire_days: 7 })
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
                const { data } = await api.get('/suppliers', { params: { page_size: 200 } })
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
                  {link?.supplier_name}：
                  <Typography.Text copyable={{ text: link?.url }} style={{ fontSize: 12 }}>
                    {link?.url}
                  </Typography.Text>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Drawer>
  )
}
