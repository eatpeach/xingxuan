import { useEffect, useRef, useState } from 'react'
import {
  ActionType,
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components'
import {
  Button,
  Cascader,
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
  Space,
  Table,
  Tag,
  Upload,
  message,
} from 'antd'
import type { UploadFile } from 'antd'
import {
  ApartmentOutlined,
  ClearOutlined,
  ExclamationCircleOutlined,
  ExperimentOutlined,
  FileExcelOutlined,
  PercentageOutlined,
  PictureOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { api } from '../api'
import CategoryManager from './CategoryManager'
import { catPath, toCascaderOptions } from './vendor/ProductFormDrawer'
import type { CatNode } from './vendor/ProductFormDrawer'
import ProductSheetImport from './products/ProductSheetImport'
import {
  MarginTag,
  PointsPicker,
  SELL_FROM_OPTS,
  fmtRp,
  moneyInputProps,
  rangeFromCost,
  sellFromRange,
  usePoints,
} from './products/pricing'

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
  // 内部定价（只在后台显示）
  cost_price: number | null
  quote_min: number | null
  quote_max: number | null
  quote_pt_min: number | null
  quote_pt_max: number | null
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
  const [catTree, setCatTree] = useState<CatNode[]>([])
  const [catMgrOpen, setCatMgrOpen] = useState(false)
  const flatCats = catTree.flatMap((c) => [c.name, ...(c.children || []).map((x) => x.name)])
  const [editing, setEditing] = useState<Partial<ProductRow> | null>(null)
  const [logsFor, setLogsFor] = useState<{ id: number; name: string } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [ptsOpen, setPtsOpen] = useState(false)
  const reload = () => ref.current?.reload()

  useEffect(() => {
    api.get('listSuppliers', { page: 1, page_size: 500 }).then((r) =>
      setSuppliers((r.items || []).map((s: any) => ({
        label: `${s.name}${s.code ? ` [${s.code}]` : ''}`,
        value: s.id,
      }))),
    )
    api.get('shelfMeta').then((r) => setCatTree(r.categories || []))
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
    { title: '品类', dataIndex: 'category', valueType: 'select', fieldProps: { options: flatCats.map((c) => ({ label: c, value: c })) }, width: 90 },
    {
      title: '成本价',
      search: false,
      width: 130,
      tooltip: '供应商给我们的价，只有后台能看到。点一下直接改',
      render: (_, r) => (
        <InlinePrice id={r.id} field="cost_price" value={r.cost_price} placeholder="填成本价" onSaved={reload} />
      ),
    },
    {
      title: '出售价',
      search: false,
      width: 130,
      tooltip: '我们卖给客户的价，对外货架也按这个价展示',
      render: (_, r) => (
        <div>
          <InlinePrice id={r.id} field="base_price" value={r.base_price || null} placeholder="未定价" strong onSaved={reload} />
          <div style={{ fontSize: 12, color: '#999' }}>/{r.unit}</div>
        </div>
      ),
    },
    {
      title: '毛利点位',
      search: false,
      width: 100,
      render: (_, r) => <MarginTag cost={r.cost_price} sell={r.base_price} />,
    },
    {
      title: '对客报价区间',
      search: false,
      width: 170,
      render: (_, r) =>
        r.quote_min != null || r.quote_max != null ? (
          <div>
            <div style={{ whiteSpace: 'nowrap' }}>{fmtRp(r.quote_min)}</div>
            <div style={{ whiteSpace: 'nowrap' }}>~ {fmtRp(r.quote_max)}</div>
            {r.quote_pt_min != null && r.quote_pt_max != null ? (
              <Tag color="blue" style={{ marginTop: 2 }}>
                {r.quote_pt_min}% ~ {r.quote_pt_max}%
              </Tag>
            ) : null}
          </div>
        ) : (
          <span style={{ color: '#bbb' }}>-</span>
        ),
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
                // 后端有上架价格闸门，未定价会被拒；不接住的话点了没反应，看不到原因
                try {
                  await api.post('adminReviewProduct', { id: r.id, decision: 'approve' })
                } catch (e: any) {
                  message.error(e?.message || '审核失败')
                  return
                }
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
                // 同上：上架方向会撞价格闸门，必须把后端原因透出来
                try {
                  await api.post('adminSaveProduct', { ...rowPayload(r), status: r.status === 'on' ? 'off' : 'on' })
                } catch (e: any) {
                  message.error(e?.message || '操作失败')
                  return
                }
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
        scroll={{ x: 1300 }}
        rowSelection={{
          selectedRowKeys: selected,
          preserveSelectedRowKeys: true,
          onChange: (keys) => setSelected(keys as number[]),
        }}
        tableAlertOptionRender={() => (
          <Space>
            <Button size="small" type="primary" icon={<PercentageOutlined />} onClick={() => setPtsOpen(true)}>
              按点位设报价区间
            </Button>
            <a onClick={() => setSelected([])}>取消选择</a>
          </Space>
        )}
        toolBarRender={() => [
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>
            新增商品（代录）
          </Button>,
          <Button key="import" icon={<FileExcelOutlined />} onClick={() => setImportOpen(true)}>
            表格录入
          </Button>,
          <Button key="flagged" icon={<ExclamationCircleOutlined />} onClick={() => setLogsFor({ id: 0, name: '' })}>
            改价记录
          </Button>,
          <Button key="cats" icon={<ApartmentOutlined />} onClick={() => setCatMgrOpen(true)}>
            品类管理
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
        categories={catTree}
        onClose={() => setEditing(null)}
        onOk={() => {
          setEditing(null)
          ref.current?.reload()
        }}
      />
      <PriceLogsModal target={logsFor} onClose={() => setLogsFor(null)} />
      <ProductSheetImport
        open={importOpen}
        suppliers={suppliers}
        categories={catTree}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false)
          reload()
        }}
      />
      <BatchPointsModal
        ids={ptsOpen ? selected : null}
        onClose={() => setPtsOpen(false)}
        onOk={() => {
          setPtsOpen(false)
          setSelected([])
          reload()
        }}
      />
      <CategoryManager
        open={catMgrOpen}
        onClose={() => {
          setCatMgrOpen(false)
          api.get('shelfMeta').then((r) => setCatTree(r.categories || []))
        }}
      />
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
  categories: CatNode[]
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
      category_path: record.category ? catPath(categories, record.category) : undefined,
      name: record.name,
      spec: record.spec,
      brand: record.brand,
      model: record.model,
      unit: record.unit || '件',
      moq: record.moq || undefined,
      base_price: record.base_price || undefined,
      cost_price: record.cost_price ?? undefined,
      quote_min: record.quote_min ?? undefined,
      quote_max: record.quote_max ?? undefined,
      quote_pt_min: record.quote_pt_min ?? undefined,
      quote_pt_max: record.quote_pt_max ?? undefined,
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
      const path = (v.category_path as string[] | undefined) || []
      delete v.category_path
      await api.post('adminSaveProduct', {
        id: record?.id,
        ...v,
        category: path[path.length - 1] || '',
        images: fileList.filter((f) => f.status === 'done' && f.url).map((f) => f.url),
      })
      message.success('已保存')
      onOk()
    } catch (e: any) {
      // 保存时选了「上架」但没填底价，后端会拒；原来只有 finally，错误被吞掉
      message.error(e?.message || '保存失败')
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
        <Form.Item name="category_path" label="品类">
          <Cascader
            allowClear
            changeOnSelect
            showSearch
            placeholder="选择品类（大类 / 中类 / 小类）"
            options={toCascaderOptions(categories)}
          />
        </Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="brand" label="品牌"><Input /></Form.Item>
          <Form.Item name="model" label="型号"><Input /></Form.Item>
        </div>
        <Form.Item name="spec" label="规格"><Input placeholder="如：800×800mm" /></Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="cost_price" label="成本价" tooltip="供应商给我们的价，只有后台能看到">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="我们自己填" {...moneyInputProps} />
          </Form.Item>
          <Form.Item
            name="base_price"
            label="出售价"
            tooltip="我们卖给客户的价；上架到货架必须有出售价"
            dependencies={['cost_price']}
            rules={[
              ({ getFieldValue }) => ({
                validator: (_, v) =>
                  Number(v) > 0 || Number(getFieldValue('cost_price')) > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error('出售价和成本价至少填一个')),
              }),
            ]}
          >
            <InputNumber min={0} style={{ width: '100%' }} {...moneyInputProps} />
          </Form.Item>
        </div>
        <QuoteRangeBlock form={form} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
        {/* 产品通用信息：与 Excel 收集表的列一一对应，都是选填 */}
        <Form.Item name="material" label="材质"><Input placeholder="如：瓷质 / PVC / 304 不锈钢" /></Form.Item>
        <Form.Item name="package_spec" label="包装规格"><Input placeholder="如：4片/箱（1.44㎡）" /></Form.Item>
        <Form.Item name="origin" label="产地"><Input placeholder="如：Indonesia / 广东" /></Form.Item>
        <Form.Item name="weight" label="重量"><Input placeholder="如：28kg/箱" /></Form.Item>
        <Form.Item name="certification" label="认证 / 标准"><Input placeholder="如：SNI / ISO 9001，多个用 / 分隔" /></Form.Item>
        <Form.Item name="warranty" label="质保期"><Input placeholder="如：1年" /></Form.Item>
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

/** 表格里点一下就能改的价格格子（成本价 / 出售价） */
function InlinePrice({
  id,
  field,
  value,
  placeholder,
  strong,
  onSaved,
}: {
  id: number
  field: 'cost_price' | 'base_price'
  value: number | null
  placeholder: string
  strong?: boolean
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState<number | null>(value)
  const [saving, setSaving] = useState(false)
  useEffect(() => setV(value), [value])

  const save = async () => {
    const next = v == null ? null : Number(v)
    if ((next ?? null) === (value ?? null) || (next === 0 && !value)) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await api.post('adminPatchProductPricing', { id, [field]: next })
      message.success('已保存')
      setEditing(false)
      onSaved()
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <InputNumber
        size="small"
        autoFocus
        min={0}
        disabled={saving}
        value={v ?? undefined}
        style={{ width: 120 }}
        {...moneyInputProps}
        onChange={(n) => setV(n == null ? null : Number(n))}
        onBlur={save}
        onPressEnter={save}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setV(value)
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <a
      onClick={() => setEditing(true)}
      style={{
        color: value ? (strong ? '#e64545' : '#1f2329') : '#bbb',
        fontWeight: strong && value ? 600 : undefined,
        borderBottom: '1px dashed #ccc',
        whiteSpace: 'nowrap',
      }}
    >
      {value ? fmtRp(value) : placeholder}
    </a>
  )
}

/** 编辑抽屉里的「对客报价参考区间」：点位按钮一点，按成本价算好并四舍五入 */
function QuoteRangeBlock({ form }: { form: any }) {
  const [pts, setPts] = usePoints()
  const [sellFrom, setSellFrom] = useState('')
  const cost = Form.useWatch('cost_price', form)

  const apply = (p = pts, from = sellFrom) => {
    const c = Number(form.getFieldValue('cost_price') || 0)
    if (c <= 0) {
      message.warning('先填成本价，才能按点位算')
      return
    }
    const rg = rangeFromCost(c, p.ptMin, p.ptMax, p.unit)
    const patch: any = { quote_min: rg.min, quote_max: rg.max, quote_pt_min: rg.ptMin, quote_pt_max: rg.ptMax }
    const s = sellFromRange(rg.min, rg.max, from, p.unit)
    if (s != null) patch.base_price = s
    form.setFieldsValue(patch)
    form.validateFields(['base_price']).catch(() => {})
  }

  return (
    <div style={{ background: '#f7f8fa', borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        对客报价参考区间
        <span style={{ fontWeight: 400, color: '#999', fontSize: 12, marginLeft: 6 }}>
          按成本价 × (1 + 点位%) 计算，可以再手动改
        </span>
      </div>
      <PointsPicker
        value={pts}
        onChange={(p) => {
          setPts(p)
          if (Number(cost) > 0) apply(p)
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
        <span style={{ width: 64, color: '#666', flexShrink: 0 }}>出售价</span>
        <Radio.Group
          size="small"
          optionType="button"
          value={sellFrom}
          onChange={(e) => {
            setSellFrom(e.target.value)
            if (Number(cost) > 0) apply(pts, e.target.value)
          }}
          options={SELL_FROM_OPTS}
        />
        <Button size="small" type="primary" ghost onClick={() => apply()}>
          按点位计算
        </Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Form.Item name="quote_min" label="区间下限" style={{ marginBottom: 0 }}>
          <InputNumber
            min={0}
            style={{ width: '100%' }}
            {...moneyInputProps}
            onChange={() => form.setFieldsValue({ quote_pt_min: null })}
          />
        </Form.Item>
        <Form.Item name="quote_max" label="区间上限" style={{ marginBottom: 0 }}>
          <InputNumber
            min={0}
            style={{ width: '100%' }}
            {...moneyInputProps}
            onChange={() => form.setFieldsValue({ quote_pt_max: null })}
          />
        </Form.Item>
      </div>
      <Form.Item name="quote_pt_min" hidden><InputNumber /></Form.Item>
      <Form.Item name="quote_pt_max" hidden><InputNumber /></Form.Item>
    </div>
  )
}

/** 勾选多个商品，一键按点位生成报价区间 */
function BatchPointsModal({ ids, onClose, onOk }: { ids: number[] | null; onClose: () => void; onOk: () => void }) {
  const [pts, setPts] = usePoints()
  const [sellFrom, setSellFrom] = useState('')
  const [saving, setSaving] = useState(false)
  const example = rangeFromCost(123456, pts.ptMin, pts.ptMax, pts.unit)
  return (
    <Modal
      title={`按点位设报价区间（已选 ${ids?.length || 0} 个商品）`}
      open={!!ids}
      onCancel={onClose}
      zIndex={1100}
      width={640}
      okText="应用"
      confirmLoading={saving}
      onOk={async () => {
        setSaving(true)
        try {
          const r = await api.post('adminApplyPricePoints', {
            ids,
            pt_min: pts.ptMin,
            pt_max: pts.ptMax,
            round_unit: pts.unit,
            sell_from: sellFrom,
          })
          if (r.no_cost) message.warning(`已更新 ${r.updated} 个；${r.no_cost} 个没填成本价，跳过了`)
          else message.success(`已更新 ${r.updated} 个商品`)
          onOk()
        } catch (e: any) {
          message.error(e?.message || '操作失败')
        } finally {
          setSaving(false)
        }
      }}
    >
      <PointsPicker value={pts} onChange={setPts} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ width: 64, color: '#666', flexShrink: 0 }}>出售价</span>
        <Radio.Group
          size="small"
          optionType="button"
          value={sellFrom}
          onChange={(e) => setSellFrom(e.target.value)}
          options={SELL_FROM_OPTS}
        />
      </div>
      <div style={{ marginTop: 12, padding: 10, background: '#f7f8fa', borderRadius: 6, fontSize: 13, color: '#666' }}>
        举例：成本价 Rp 123.456 → 区间 <b>{fmtRp(example.min)} ~ {fmtRp(example.max)}</b>
        <div style={{ fontSize: 12, marginTop: 4 }}>没填成本价的商品会跳过。</div>
      </div>
    </Modal>
  )
}
