import { useRef } from 'react'
import {
  ActionType,
  ModalForm,
  PageContainer,
  ProColumns,
  ProFormDigit,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components'
import { Button, Popconfirm, Space, Tag, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api } from '../api'

interface Channel {
  id: number
  name: string
  contact: string
  phone: string
  wechat: string
  commission_pct: number
  remark: string
  is_active: number
  customer_count: number
  created_at: string
}

export default function ChannelsPage() {
  const ref = useRef<ActionType>()

  const cols: ProColumns<Channel>[] = [
    { title: '渠道名称', dataIndex: 'name', width: 180 },
    { title: '联系人', dataIndex: 'contact', width: 120, search: false, render: (v) => v || '-' },
    { title: '微信', dataIndex: 'wechat', width: 130, search: false, render: (v) => v || '-' },
    {
      title: '分润比例',
      dataIndex: 'commission_pct',
      width: 100,
      search: false,
      render: (v: any) => (Number(v) > 0 ? <Tag color="gold">{Number(v)}%</Tag> : <span style={{ color: '#bfbfbf' }}>-</span>),
    },
    {
      title: '介绍客户数',
      dataIndex: 'customer_count',
      width: 110,
      search: false,
      render: (v: any) => (Number(v) > 0 ? <Tag color="blue">{v}</Tag> : <span style={{ color: '#bfbfbf' }}>0</span>),
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      search: false,
      render: (v) => (v ? <Tag color="success">启用</Tag> : <Tag color="error">停用</Tag>),
    },
    { title: '备注', dataIndex: 'remark', ellipsis: true, search: false, render: (v) => v || '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 165, search: false },
    {
      title: '操作',
      valueType: 'option',
      width: 180,
      fixed: 'right',
      render: (_, row) => [
        <EditChannel key="edit" record={row} onOk={() => ref.current?.reload()} />,
        <a
          key="toggle"
          onClick={async () => {
            await api.post('toggleChannelActive', { id: row.id })
            ref.current?.reload()
          }}
        >
          {row.is_active ? '停用' : '启用'}
        </a>,
        <Popconfirm
          key="del"
          title="确认删除该渠道？"
          onConfirm={async () => {
            await api.post('deleteChannel', { id: row.id })
            message.success('已删除')
            ref.current?.reload()
          }}
        >
          <a style={{ color: '#cf1322' }}>删除</a>
        </Popconfirm>,
      ],
    },
  ]

  return (
    <PageContainer title="渠道管理">
      <ProTable<Channel>
        actionRef={ref}
        rowKey="id"
        columns={cols}
        scroll={{ x: 1100 }}
        request={async (params) => {
          const data = await api.get('listChannels', { keyword: params.name || '' })
          return { data: data.items || [], success: true }
        }}
        pagination={false}
        headerTitle="渠道管理"
        toolBarRender={() => [
          <EditChannel
            key="add"
            onOk={() => ref.current?.reload()}
            trigger={
              <Button type="primary" icon={<PlusOutlined />}>
                新增渠道
              </Button>
            }
          />,
        ]}
      />
    </PageContainer>
  )
}

function EditChannel({
  record,
  onOk,
  trigger,
}: {
  record?: Channel
  onOk: () => void
  trigger?: JSX.Element
}) {
  return (
    <ModalForm
      title={record ? '编辑渠道' : '新增渠道'}
      trigger={trigger ?? <a>编辑</a>}
      initialValues={record}
      modalProps={{ destroyOnClose: true }}
      width={560}
      grid
      rowProps={{ gutter: [16, 0] }}
      onFinish={async (v) => {
        await api.post('saveChannel', { id: record?.id, ...v })
        message.success('已保存')
        onOk()
        return true
      }}
    >
      <ProFormText name="name" label="渠道名称" rules={[{ required: true }]} colProps={{ span: 12 }} />
      <ProFormText name="contact" label="联系人" colProps={{ span: 12 }} />
      <ProFormText name="phone" label="电话" colProps={{ span: 12 }} />
      <ProFormText name="wechat" label="微信" colProps={{ span: 12 }} />
      <ProFormDigit
        name="commission_pct"
        label="分润比例（%）"
        colProps={{ span: 12 }}
        min={0}
        max={100}
        fieldProps={{ precision: 1, addonAfter: '%' }}
        placeholder="如 10"
      />
      <ProFormTextArea name="remark" label="备注" colProps={{ span: 24 }} fieldProps={{ rows: 2 }} />
    </ModalForm>
  )
}
