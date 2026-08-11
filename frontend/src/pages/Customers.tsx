import { useEffect, useRef, useState } from 'react'
import {
  ActionType,
  ModalForm,
  PageContainer,
  ProColumns,
  ProFormDependency,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components'
import { AutoComplete, Button, Col, Form, Popconfirm, Select, Space, Tag, Typography, message } from 'antd'
import { CopyOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { copyText } from '../utils/copyText'
import CustomerCodeSearch from '../components/CustomerCodeSearch'



const DEFAULT_SOURCES = ['抖音-阿星在印尼', '抖音-星选建材', '视频号-阿星在印尼', '视频号-星选建材']
const DEFAULT_CATEGORIES = ['项目业主', '项目总包', '项目分包', '物资公司', '装修公司']
const CHANNEL_SOURCE = '渠道客户'

interface Customer {
  id: number
  code: string
  name: string
  short_name: string
  company: string
  phone: string
  email: string
  wechat: string
  address: string
  source: string
  remark: string
  material_needs: string
}

export default function CustomersPage() {
  const ref = useRef<ActionType>()
  const nav = useNavigate()
  const [companyName, setCompanyName] = useState('星选建材')

  const [sources, setSources] = useState<string[]>(DEFAULT_SOURCES)
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES)
  const [channels, setChannels] = useState<{ label: string; value: number }[]>([])

  useEffect(() => {
    api.get('listSettings').then((r) => {
      const sm: Record<string, string> = Object.fromEntries(
        (r.items || []).map((s: any) => [s.key, s.value]),
      )
      if (sm.company_name) setCompanyName(sm.company_name)
      const parse = (v: string) => (v || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
      const list = parse(sm.customer_sources)
      if (list.length) setSources(list)
      const cats = parse(sm.customer_categories)
      if (cats.length) setCategories(cats)
    })
    api.get('listChannels', { active_only: 1 })
      .then((r) => setChannels((r.items || []).map((ch: any) => ({ label: ch.name, value: ch.id }))))
      .catch(() => {})
  }, [])

  const groupName = (c: Customer) =>
    `[${companyName}${c.code || c.id}] ${c.short_name || c.name}`

  const cols: ProColumns<Customer>[] = [
    {
      title: '群编号',
      dataIndex: 'code',
      key: 'code_search',
      hideInTable: true,
      renderFormItem: () => <CustomerCodeSearch />,
    },
    {
      title: '编号',
      dataIndex: 'code',
      width: 70,
      search: false,
      render: (v) => <Typography.Text strong>{v || '-'}</Typography.Text>,
    },
    {
      title: '客户名',
      dataIndex: 'name',
      width: 120,
      ellipsis: true,
      render: (_, r) => r.short_name || r.name,
    },
    { title: '公司名称', dataIndex: 'company', width: 160, ellipsis: true, search: false },
    {
      title: '客户分类',
      dataIndex: 'category',
      width: 110,
      renderFormItem: () => (
        <Select
          allowClear
          placeholder="请选择"
          options={categories.map((s) => ({ value: s, label: s }))}
        />
      ),
      render: (v: any) => (v ? <Tag color="geekblue">{v}</Tag> : <span style={{ color: '#bfbfbf' }}>-</span>),
    },
    {
      title: '群名（点击复制）',
      width: 230,
      search: false,
      render: (_, r) => (
        <Tag
          color="blue"
          style={{ cursor: 'pointer' }}
          onClick={() => {
            const t = groupName(r)
            copyText(t)
              .then(() => message.success(`已复制：${t}`))
              .catch(() => message.error('复制失败，请手动选中文本复制'))
          }}
          icon={<CopyOutlined />}
        >
          {groupName(r)}
        </Tag>
      ),
    },
    { title: '微信', dataIndex: 'wechat', width: 110, ellipsis: true, search: false },
    {
      title: '建材需求',
      dataIndex: 'material_needs',
      width: 220,
      search: false,
      render: (v: any) => {
        if (!v) return <span style={{ color: '#bfbfbf' }}>-</span>
        const tags = String(v).split(/[\s、,，\/]+/).filter(Boolean).slice(0, 4)
        return (
          <Space size={[2, 2]} wrap>
            {tags.map((t, i) => (
              <Tag key={i} color="cyan" style={{ marginRight: 0 }}>{t}</Tag>
            ))}
            {String(v).split(/[\s、,，\/]+/).filter(Boolean).length > 4 && (
              <Tag style={{ marginRight: 0 }}>...</Tag>
            )}
          </Space>
        )
      },
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 130,
      search: false,
      render: (_, r: any) =>
        r.source === CHANNEL_SOURCE ? (
          <Tag color="purple">渠道 · {r.channel_name || '-'}</Tag>
        ) : (
          r.source || <span style={{ color: '#bfbfbf' }}>-</span>
        ),
    },
    {
      title: '报价情况',
      width: 180,
      search: false,
      render: (_, r: any) => {
        const cnt = Number(r.quote_count || 0)
        if (cnt === 0) {
          return <Tag>未报价</Tag>
        }
        const sym = (r.latest_quote_currency || 'IDR') === 'IDR' ? 'Rp' : '¥'
        const latest = Number(r.latest_quote_total || 0)
        const total = Number(r.total_quoted || 0)
        const wonCnt = Number(r.won_count || 0)
        return (
          <div style={{ lineHeight: 1.4 }}>
            <Space size={4} wrap>
              <Tag color="blue">已报价 {cnt}</Tag>
              {wonCnt > 0 && <Tag color="success">成交 {wonCnt}</Tag>}
            </Space>
            <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>
              最新 {sym} {latest.toLocaleString()}
              {cnt > 1 && (
                <span style={{ marginLeft: 6 }}>· 累计 {sym} {total.toLocaleString()}</span>
              )}
            </div>
          </div>
        )
      },
    },
    {
      title: '操作',
      valueType: 'option',
      width: 200,
      fixed: 'right',
      render: (_, row) => [
        <a
          key="new-inquiry"
          onClick={() =>
            nav('/admin/inquiries', { state: { newInquiryCustomerId: row.id } })
          }
        >
          新建商机
        </a>,
        <EditCustomer key="edit" record={row} sources={sources} categories={categories} channels={channels} onOk={() => ref.current?.reloadAndRest?.()} />,
        <Popconfirm
          key="del"
          title="确认删除？"
          onConfirm={async () => {
            await api.post('deleteCustomer', { id: row.id })
            message.success('已删除')
            ref.current?.reload()
          }}
        >
          <a>删除</a>
        </Popconfirm>,
      ],
    },
  ]

  return (
    <PageContainer title="客户管理">
      <ProTable<Customer>
        actionRef={ref}
        rowKey="id"
        columns={cols}
        scroll={{ x: 1480 }}
        request={async (params) => {
          const data = await api.get('listCustomers', {
            keyword: params.code_search || params.code || params.name || '',
            category: params.category || '',
            page: params.current,
            page_size: params.pageSize,
          })
          return { data: data.items, total: data.total, success: true }
        }}
        headerTitle="客户管理"
        toolBarRender={() => [
          <EditCustomer
            key="add"
            sources={sources}
            categories={categories}
            channels={channels}
            onOk={() => ref.current?.reloadAndRest?.()}
            trigger={
              <Button type="primary" icon={<PlusOutlined />}>
                新建客户
              </Button>
            }
          />,
        ]}
      />
    </PageContainer>
  )
}

function EditCustomer({
  record,
  onOk,
  trigger,
  sources = DEFAULT_SOURCES,
  categories = DEFAULT_CATEGORIES,
  channels = [],
}: {
  record?: Customer
  onOk: () => void
  trigger?: JSX.Element
  sources?: string[]
  categories?: string[]
  channels?: { label: string; value: number }[]
}) {
  const isEdit = !!record
  return (
    <ModalForm
      title={
        isEdit ? (
          <span>
            编辑客户 <Tag color="blue">编号 {record!.code || '未分配'}</Tag>
          </span>
        ) : (
          '新建客户'
        )
      }
      trigger={trigger ?? <a>编辑</a>}
      initialValues={record ? { ...record, short_name: record.short_name || record.name } : undefined}
      modalProps={{ destroyOnClose: true }}
      width={720}
      grid
      rowProps={{ gutter: [16, 0] }}
      onFinish={async (v) => {
        const payload = { ...v, name: v.short_name, channel_id: v.source === CHANNEL_SOURCE ? v.channel_id : 0 }
        if (isEdit) {
          await api.post('updateCustomer', { id: record!.id, ...payload })
        } else {
          await api.post('createCustomer', payload)
        }
        message.success('已保存')
        onOk()
        return true
      }}
    >
      <ProFormText
        name="short_name"
        label="客户名 / 简称"
        tooltip="用于客户列表展示和群名拼接。群名格式：[公司抬头 编号] 客户名"
        rules={[{ required: true }]}
        colProps={{ span: 12 }}
      />
      <ProFormText name="company" label="公司名称" colProps={{ span: 12 }} />
      {/* 开发票买方抬头要用；这里存了，开票弹窗就自动带出来 */}
      <ProFormText name="tax_no" label="税号 NPWP" colProps={{ span: 12 }} />
      <ProFormText name="wechat" label="微信" colProps={{ span: 12 }} />
      <ProFormText name="address" label="项目地址" colProps={{ span: 12 }} />
      <Col span={12}>
        <Form.Item name="category" label="客户分类">
          <AutoComplete
            allowClear
            style={{ width: '100%' }}
            options={categories.map((s) => ({ value: s }))}
            placeholder="选择预设或直接输入自定义"
            filterOption={(input, opt) => String(opt?.value ?? '').toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item name="source" label="客户来源">
          <AutoComplete
            allowClear
            style={{ width: '100%' }}
            options={[...sources, CHANNEL_SOURCE].map((s) => ({ value: s }))}
            placeholder="选媒体来源 / 渠道客户，或输入自定义"
            filterOption={(input, opt) => String(opt?.value ?? '').toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>
      </Col>
      <ProFormDependency name={['source']}>
        {({ source }) =>
          source === CHANNEL_SOURCE ? (
            <Col span={12}>
              <Form.Item name="channel_id" label="介绍渠道" rules={[{ required: true, message: '请选择渠道' }]}>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择介绍客户的渠道"
                  options={channels}
                />
              </Form.Item>
            </Col>
          ) : null
        }
      </ProFormDependency>
      <ProFormTextArea
        name="material_needs"
        label="建材需求"
        tooltip="客户主要采购什么建材，用顿号或空格分开，如：电缆 / 管材 / 五金"
        placeholder="电缆 PVC 管材 五金 灯具 ..."
        colProps={{ span: 24 }}
        fieldProps={{ rows: 2 }}
      />
      <ProFormTextArea name="remark" label="备注" colProps={{ span: 24 }} fieldProps={{ rows: 2 }} />

    </ModalForm>
  )
}
