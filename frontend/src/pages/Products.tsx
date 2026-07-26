import { useEffect, useRef, useState } from 'react'
import {
  ActionType,
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components'
import {
  Button,
  Drawer,
  Dropdown,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Table,
  Tag,
  Upload,
  message,
} from 'antd'
import type { UploadFile } from 'antd'
import {
  ClearOutlined,
  ExclamationCircleOutlined,
  ExperimentOutlined,
  PictureOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { api } from '../api'

interface ProductRow {
  id: number
  supplier_id: number
  supplier_name: string
  supplier_code: string
  category: string
  name: string
  spec: string
  brand: string
  model: string
  unit: string
  moq: number
  base_price: number
  currency: string
  stock_status: string
  lead_time: string
  freight_note: string
  images: string[]
  description: string
  status: string
  reject_reason: string
  markup_pct_override: number | null
  sort_weight: number
  markup_pct: number
  sell_price: number
  price_updated_at: string
  updated_at: string
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: '待审核', color: 'orange' },
  on: { label: '已上架', color: 'green' },
  off: { label: '已下架', color: 'default' },
  rejected: { label: '已驳回', color: 'red' },
}

function fmtPrice(n: number, currency: string) {
  if (currency === 'IDR') return 'Rp ' + Math.round(n).toLocaleString('id-ID')
  if (currency === 'CNY') return '¥' + Number(n).toFixed(2)
  return '$' + Number(n).toFixed(2)
}

export default function ProductsPage() {
  const ref = useRef<ActionType>()
  const [status, setStatus] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [suppliers, setSuppliers] = useState<{ label: string; value: number }[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [editing, setEditing] = useState<Partial<ProductRow> | null>(null)
  const [logsFor, setLogsFor] = useState<{ id: number; name: string } | null>(null)

  useEffect(() => {
    api.get('listSuppliers', { page: 1, page_size: 500 }).then((r) =>
      setSuppliers((r.items || []).map((s: any) => ({
        label: `${s.name}${s.code ? ` [${s.code}]` : ''}`,
        value: s.id,
      }))),
    )
    api.get('shelfMeta').then((r) => setCategories((r.categories || []).map((c: any) => c.name)))
  }, [])

  const tabTitle = (key: string, label: string) => {
    const n = key === ''
      ? Object.values(counts).reduce((a, b) => a + b, 0)
      : counts[key] || 0
    return n > 0 ? `${label} (${n})` : label
  }

  const cols: ProColumns<ProductRow>[] = [
    {
      title: '图片',
      width: 56,
      search: false,
      render: (_, r) =>
        r.images?.[0] ? (
          <Image src={r.images[0]} width={44} height={44} style={{ objectFit: 'cover', borderRadius: 4 }} />
        ) : (
          <div style={{ width: 44, height: 44, background: '#f2f3f5', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>
            <PictureOutlined />
          </div>
        ),
    },
    {
      title: '商品',
      dataIndex: 'keyword',
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name}</div>
          <div style={{ fontSize: 12, color: '#999' }}>
            {[r.brand, r.model, r.spec].filter(Boolean).join(' / ') || '-'}
          </div>
        </div>
      ),
    },
    {
      title: '供应商',
      dataIndex: 'supplier_id',
      valueType: 'select',
      fieldProps: { options: suppliers, showSearch: true, optionFilterProp: 'label' },
      render: (_, r) => (
        <span>
          {r.supplier_name}
          {r.supplier_code ? <span style={{ color: '#999' }}> [{r.supplier_code}]</span> : null}
        </span>
      ),
    },
    { title: '品类', dataIndex: 'category', valueType: 'select', fieldProps: { options: categories.map((c) => ({ label: c, value: c })) }, width: 90 },
    {
      title: '底价',
      search: false,
      width: 110,
      render: (_, r) => <span>{fmtPrice(r.base_price, r.currency)}<span style={{ color: '#999', fontSize: 12 }}>/{r.unit}</span></span>,
    },
    {
      title: '加价',
      search: false,
      width: 70,
      render: (_, r) => (
        <span style={{ color: r.markup_pct_override != null ? '#e6822c' : undefined }}>
          {r.markup_pct}%{r.markup_pct_override != null ? '*' : ''}
        </span>
      ),
    },
    {
      title: '对外价',
      search: false,
      width: 110,
      render: (_, r) => <b style={{ color: '#e64545' }}>{fmtPrice(r.sell_price, r.currency)}</b>,
    },
    {
      title: '货期',
      search: false,
      width: 90,
      render: (_, r) =>
        r.stock_status === 'in_stock' ? <Tag color="green">现货</Tag> : <Tag color="orange">订货{r.lead_time ? ` ${r.lead_time}` : ''}</Tag>,
    },
    {
      title: '状态',
      search: false,
      width: 90,
      render: (_, r) => {
        const m = STATUS_META[r.status] || { label: r.status, color: 'default' }
        return (
          <div>
            <Tag color={m.color}>{m.label}</Tag>
            {r.status === 'rejected' && r.reject_reason ? (
              <div style={{ fontSize: 12, color: '#e64545' }}>{r.reject_reason}</div>
            ) : null}
          </div>
        )
      },
    },
    {
      title: '操作',
      valueType: 'option',
      width: 210,
      render: (_, r) => {
        const ops = []
        if (r.status === 'pending') {
          ops.push(
            <a
              key="ok"
              onClick={async () => {
                await api.post('adminReviewProduct', { id: r.id, decision: 'approve' })
                message.success('已上架')
                ref.current?.reload()
              }}
            >
              通过
            </a>,
            <RejectBtn key="no" id={r.id} onOk={() => ref.current?.reload()} />,
          )
        } else {
          ops.push(
            <a
              key="toggle"
              onClick={async () => {
                await api.post('adminSaveProduct', { ...rowPayload(r), status: r.status === 'on' ? 'off' : 'on' })
                message.success(r.status === 'on' ? '已下架' : '已上架')
                ref.current?.reload()
              }}
            >
              {r.status === 'on' ? '下架' : '上架'}
            </a>,
          )
        }
        ops.push(
          <a key="edit" onClick={() => setEditing(r)}>编辑</a>,
          <a key="logs" onClick={() => setLogsFor({ id: r.id, name: r.name })}>改价</a>,
          <Popconfirm
            key="del"
            title="确认删除该商品？"
            onConfirm={async () => {
              await api.post('adminDeleteProduct', { id: r.id })
              message.success('已删除')
              ref.current?.reload()
            }}
          >
            <a style={{ color: '#e64545' }}>删除</a>
          </Popconfirm>,
        )
        return ops
      },
    },
  ]

  return (
    <PageContainer
      title="商品库"
      tabList={[
        { key: '', tab: tabTitle('', '全部') },
        { key: 'pending', tab: tabTitle('pending', '待审核') },
        { key: 'on', tab: tabTitle('on', '已上架') },
        { key: 'off', tab: tabTitle('off', '已下架') },
        { key: 'rejected', tab: tabTitle('rejected', '已驳回') },
      ]}
      tabActiveKey={status}
      onTabChange={(k) => {
        setStatus(k)
        ref.current?.reload()
      }}
    >
      <ProTable<ProductRow>
        actionRef={ref}
        rowKey="id"
        columns={cols}
        request={async (params) => {
          const data = await api.get('adminListProducts', {
            keyword: params.keyword || '',
            supplier_id: params.supplier_id || '',
            category: params.category || '',
            status,
            page: params.current,
            page_size: params.pageSize,
          })
          setCounts(data.status_counts || {})
          return { data: data.items, total: data.total, success: true }
        }}
        headerTitle="商品库"
        toolBarRender={() => [
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>
            新增商品（代录）
          </Button>,
          <Button key="flagged" icon={<ExclamationCircleOutlined />} onClick={() => setLogsFor({ id: 0, name: '' })}>
            改价记录
          </Button>,
          ...(localStorage.getItem('role') === 'admin'
            ? [
                <Dropdown
                  key="demo"
                  menu={{
                    items: [
                      {
                        key: 'seed',
                        icon: <ExperimentOutlined />,
                        label: '生成演示数据',
                        onClick: async () => {
                          const r = await api.post('seedDemoProducts')
                          message.success(`已生成 ${r.suppliers} 家演示供应商、${r.products} 条演示商品（已上架）`)
                          ref.current?.reload()
                        },
                      },
                      {
                        key: 'clear',
                        icon: <ClearOutlined />,
                        label: '一键清除演示数据',
                        danger: true,
                        onClick: () => {
                          Modal.confirm({
                            title: '清除所有演示数据？',
                            content: '将删除全部演示商品、演示供应商及占位图片，真实数据不受影响。',
                            okButtonProps: { danger: true },
                            zIndex: 9999,
                            onOk: async () => {
                              const r = await api.post('clearDemoProducts')
                              message.success(`已清除 ${r.products} 条演示商品、${r.suppliers} 家演示供应商`)
                              ref.current?.reload()
                            },
                          })
                        },
                      },
                    ],
                  }}
                >
                  <Button>演示数据</Button>
                </Dropdown>,
              ]
            : []),
        ]}
      />
      <EditProductDrawer
        record={editing}
        suppliers={suppliers}
        categories={categories}
        onClose={() => setEditing(null)}
        onOk={() => {
          setEditing(null)
          ref.current?.reload()
        }}
      />
      <PriceLogsModal target={logsFor} onClose={() => setLogsFor(null)} />
    </PageContainer>
  )
}

/** 编辑保存时带全量字段（adminSaveProduct 是整行覆盖式保存） */
function rowPayload(r: ProductRow) {
  return {
    id: r.id,
    supplier_id: r.supplier_id,
    category: r.category,
    name: r.name,
    spec: r.spec,
    brand: r.brand,
    model: r.model,
    unit: r.unit,
    moq: r.moq,
    base_price: r.base_price,
    currency: r.currency,
    stock_status: r.stock_status,
    lead_time: r.lead_time,
    freight_note: r.freight_note,
    images: r.images || [],
    description: r.description,
    markup_pct_override: r.markup_pct_override,
    sort_weight: r.sort_weight,
  }
}

function RejectBtn({ id, onOk }: { id: number; onOk: () => void }) {
  return (
    <a
      style={{ color: '#e64545' }}
      onClick={() => {
        let reason = ''
        Modal.confirm({
          title: '驳回商品',
          zIndex: 9999,
          content: (
            <Input.TextArea
              placeholder="驳回原因（供应商门户可见）"
              onChange={(e) => {
                reason = e.target.value
              }}
            />
          ),
          onOk: async () => {
            await api.post('adminReviewProduct', { id, decision: 'reject', reason })
            message.success('已驳回')
            onOk()
          },
        })
      }}
    >
      驳回
    </a>
  )
}

function EditProductDrawer({
  record,
  suppliers,
  categories,
  onClose,
  onOk,
}: {
  record: Partial<ProductRow> | null
  suppliers: { label: string; value: number }[]
  categories: string[]
  onClose: () => void
  onOk: () => void
}) {
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [saving, setSaving] = useState(false)
  const isEdit = !!record?.id

  useEffect(() => {
    if (!record) return
    form.setFieldsValue({
      supplier_id: record.supplier_id,
      category: record.category || undefined,
      name: record.name,
      spec: record.spec,
      brand: record.brand,
      model: record.model,
      unit: record.unit || '件',
      moq: record.moq || undefined,
      base_price: record.base_price,
      currency: record.currency || 'IDR',
      stock_status: record.stock_status || 'in_stock',
      lead_time: record.lead_time,
      freight_note: record.freight_note,
      description: record.description,
      markup_pct_override: record.markup_pct_override,
      sort_weight: record.sort_weight || 0,
      status: record.status,
    })
    setFileList(
      (record.images || []).map((url, i) => ({
        uid: `img-${i}`,
        name: url.split('/').pop() || `img-${i}`,
        status: 'done',
        url,
      })),
    )
  }, [record, form])

  const save = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      await api.post('adminSaveProduct', {
        id: record?.id,
        ...v,
        images: fileList.filter((f) => f.status === 'done' && f.url).map((f) => f.url),
      })
      message.success('已保存')
      onOk()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      title={isEdit ? '编辑商品' : '新增商品（代供应商录入）'}
      open={!!record}
      onClose={onClose}
      width={Math.min(640, window.innerWidth)}
      destroyOnClose
      extra={
        <Button type="primary" loading={saving} onClick={save}>
          保存
        </Button>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="supplier_id" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}>
          <Select options={suppliers} showSearch optionFilterProp="label" disabled={isEdit} placeholder="选择供应商" />
        </Form.Item>
        <Form.Item name="name" label="商品名称" rules={[{ required: true, message: '请填写商品名称' }]}>
          <Input placeholder="如：全瓷通体大理石瓷砖" />
        </Form.Item>
        <Form.Item name="category" label="品类">
          <Select options={categories.map((c) => ({ label: c, value: c }))} allowClear placeholder="选择品类" />
        </Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="brand" label="品牌"><Input /></Form.Item>
          <Form.Item name="model" label="型号"><Input /></Form.Item>
        </div>
        <Form.Item name="spec" label="规格"><Input placeholder="如：800×800mm" /></Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Form.Item name="base_price" label="供货底价" rules={[{ required: true, message: '请填写底价' }]}>
            <InputNumber min={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="currency" label="货币">
            <Select options={['IDR', 'CNY', 'USD'].map((c) => ({ label: c, value: c }))} />
          </Form.Item>
          <Form.Item name="unit" label="单位"><Input /></Form.Item>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="moq" label="起订量"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="stock_status" label="库存状态">
            <Radio.Group
              options={[
                { label: '现货', value: 'in_stock' },
                { label: '需订货', value: 'pre_order' },
              ]}
            />
          </Form.Item>
        </div>
        <Form.Item noStyle shouldUpdate={(a, b) => a.stock_status !== b.stock_status}>
          {({ getFieldValue }) =>
            getFieldValue('stock_status') === 'pre_order' ? (
              <Form.Item name="lead_time" label="交期"><Input placeholder="如：7 天" /></Form.Item>
            ) : null
          }
        </Form.Item>
        <Form.Item name="freight_note" label="运费说明"><Input placeholder="如：雅加达市区包送，外岛另议" /></Form.Item>
        <Form.Item label="商品图片（最多 6 张）">
          <Upload
            listType="picture-card"
            fileList={fileList}
            maxCount={6}
            customRequest={async ({ file, onSuccess, onError }) => {
              const sid = form.getFieldValue('supplier_id')
              if (!sid) {
                message.warning('请先选择供应商')
                onError?.(new Error('no supplier'))
                return
              }
              const fd = new FormData()
              fd.append('file', file as File)
              fd.append('supplier_id', String(sid))
              try {
                const r = await api.upload('adminUploadProductImage', fd)
                onSuccess?.(r)
              } catch (e) {
                onError?.(e as Error)
              }
            }}
            onChange={({ fileList: fl }) =>
              setFileList(
                fl.map((f) => (f.response?.url ? { ...f, url: f.response.url, status: 'done' } : f)),
              )
            }
            onRemove={(f) => setFileList((l) => l.filter((x) => x.uid !== f.uid))}
          >
            {fileList.length >= 6 ? null : <div><PlusOutlined /><div style={{ marginTop: 4 }}>上传</div></div>}
          </Upload>
        </Form.Item>
        <Form.Item name="description" label="详细描述"><Input.TextArea rows={3} /></Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Form.Item name="markup_pct_override" label="加价率覆盖 %" tooltip="留空走品类/默认加价率">
            <InputNumber style={{ width: '100%' }} placeholder="留空" />
          </Form.Item>
          <Form.Item name="sort_weight" label="排序权重" tooltip="越大越靠前">
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={Object.entries(STATUS_META).map(([v, m]) => ({ label: m.label, value: v }))}
              allowClear
              placeholder={isEdit ? '保持不变' : '默认直接上架'}
            />
          </Form.Item>
        </div>
      </Form>
    </Drawer>
  )
}

function PriceLogsModal({
  target,
  onClose,
}: {
  target: { id: number; name: string } | null
  onClose: () => void
}) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!target) return
    setLoading(true)
    api
      .get('adminListPriceLogs', { product_id: target.id || '', page: 1, page_size: 100 })
      .then((r) => setRows(r.items || []))
      .finally(() => setLoading(false))
  }, [target])

  return (
    <Modal
      title={target?.id ? `改价记录 · ${target.name}` : '改价记录（全部）'}
      open={!!target}
      onCancel={onClose}
      footer={null}
      width={720}
      zIndex={9999}
    >
      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '时间', dataIndex: 'created_at', width: 150 },
          { title: '商品', dataIndex: 'product_name', ellipsis: true },
          { title: '供应商', dataIndex: 'supplier_name', ellipsis: true },
          { title: '原价', dataIndex: 'old_price', width: 100 },
          { title: '新价', dataIndex: 'new_price', width: 100 },
          {
            title: '幅度',
            dataIndex: 'change_pct',
            width: 90,
            render: (v: number, r: any) => (
              <span style={{ color: Number(r.flagged) ? '#e64545' : undefined }}>
                {v > 0 ? '+' : ''}
                {v}%{Number(r.flagged) ? ' ⚠' : ''}
              </span>
            ),
          },
          {
            title: '操作人',
            dataIndex: 'changed_by',
            width: 90,
            render: (v: string) => (v === 'vendor' ? '供应商' : '平台'),
          },
        ]}
      />
    </Modal>
  )
}
