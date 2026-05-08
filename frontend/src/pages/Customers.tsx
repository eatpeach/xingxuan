import { useEffect, useRef, useState } from 'react'
import {
  ActionType,
  ModalForm,
  PageContainer,
  ProColumns,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components'
import { Button, Popconfirm, Tag, Typography, message } from 'antd'
import { CopyOutlined, PlusOutlined } from '@ant-design/icons'
import { api } from '../api'

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
}

export default function CustomersPage() {
  const ref = useRef<ActionType>()
  const [companyName, setCompanyName] = useState('星选建材')

  useEffect(() => {
    api.get('listSettings').then((r) => {
      const sm: Record<string, string> = Object.fromEntries(
        (r.items || []).map((s: any) => [s.key, s.value]),
      )
      if (sm.company_name) setCompanyName(sm.company_name)
    })
  }, [])

  const groupName = (c: Customer) =>
    `[${companyName} ${c.code || c.id}] ${c.short_name || c.name}`

  const cols: ProColumns<Customer>[] = [
    { title: '编号', dataIndex: 'code', width: 80, search: false, render: (v) => <Typography.Text strong>{v || '-'}</Typography.Text> },
    { title: '姓名', dataIndex: 'name' },
    { title: '简称', dataIndex: 'short_name', search: false, render: (v, r) => v || r.name },
    { title: '公司', dataIndex: 'company', search: false },
    { title: '电话', dataIndex: 'phone' },
    {
      title: '群名（点击复制）',
      width: 280,
      search: false,
      render: (_, r) => (
        <Tag
          color="blue"
          style={{ cursor: 'pointer' }}
          onClick={() => {
            const t = groupName(r)
            navigator.clipboard.writeText(t).then(() => message.success(`已复制：${t}`))
          }}
          icon={<CopyOutlined />}
        >
          {groupName(r)}
        </Tag>
      ),
    },
    { title: '微信', dataIndex: 'wechat', search: false },
    { title: '来源', dataIndex: 'source', search: false },
    {
      title: '操作',
      valueType: 'option',
      width: 160,
      render: (_, row) => [
        <EditCustomer key="edit" record={row} onOk={() => ref.current?.reload()} />,
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
        request={async (params) => {
          const data = await api.get('listCustomers', {
            keyword: params.name || params.phone || '',
            page: params.current,
            page_size: params.pageSize,
          })
          return { data: data.items, total: data.total, success: true }
        }}
        toolBarRender={() => [
          <EditCustomer
            key="add"
            onOk={() => ref.current?.reload()}
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
}: {
  record?: Customer
  onOk: () => void
  trigger?: JSX.Element
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
      initialValues={record}
      modalProps={{ destroyOnClose: true }}
      width={720}
      grid
      rowProps={{ gutter: [16, 0] }}
      onFinish={async (v) => {
        if (isEdit) await api.post('updateCustomer', { id: record!.id, ...v })
        else await api.post('createCustomer', v)
        message.success('已保存')
        onOk()
        return true
      }}
    >
      <ProFormText
        name="name"
        label="客户全称 / 称呼"
        rules={[{ required: true }]}
        colProps={{ span: 12 }}
      />
      <ProFormText
        name="short_name"
        label="客户简称（用于群名）"
        tooltip="留空则用全称。群名格式：[公司抬头 编号] 简称"
        colProps={{ span: 12 }}
      />
      <ProFormText name="company" label="公司" colProps={{ span: 12 }} />
      <ProFormText
        name="source"
        label="客户来源"
        placeholder="抖音 / 转介绍 / 老客户 ..."
        colProps={{ span: 12 }}
      />
      <ProFormText name="phone" label="电话" colProps={{ span: 12 }} />
      <ProFormText name="wechat" label="微信" colProps={{ span: 12 }} />
      <ProFormText name="email" label="邮箱" colProps={{ span: 12 }} />
      <ProFormText name="address" label="地址" colProps={{ span: 12 }} />
      <ProFormTextArea name="remark" label="备注" colProps={{ span: 24 }} fieldProps={{ rows: 2 }} />
    </ModalForm>
  )
}
