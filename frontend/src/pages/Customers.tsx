import { useRef } from 'react'
import {
  ActionType,
  ModalForm,
  PageContainer,
  ProColumns,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components'
import { Button, Popconfirm, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api } from '../api'

interface Customer {
  id: number
  name: string
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

  const cols: ProColumns<Customer>[] = [
    { title: 'ID', dataIndex: 'id', width: 60, search: false },
    { title: '姓名', dataIndex: 'name' },
    { title: '公司', dataIndex: 'company', search: false },
    { title: '电话', dataIndex: 'phone' },
    { title: '微信', dataIndex: 'wechat', search: false },
    { title: '邮箱', dataIndex: 'email', search: false },
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
  trigger?: React.ReactNode
}) {
  const isEdit = !!record
  return (
    <ModalForm
      title={isEdit ? '编辑客户' : '新建客户'}
      trigger={trigger ?? <a>编辑</a>}
      initialValues={record}
      modalProps={{ destroyOnClose: true }}
      onFinish={async (v) => {
        if (isEdit) await api.post('updateCustomer', { id: record!.id, ...v })
        else await api.post('createCustomer', v)
        message.success('已保存')
        onOk()
        return true
      }}
    >
      <ProFormText name="name" label="姓名" rules={[{ required: true }]} />
      <ProFormText name="company" label="公司" />
      <ProFormText name="phone" label="电话" />
      <ProFormText name="wechat" label="微信" />
      <ProFormText name="email" label="邮箱" />
      <ProFormText name="address" label="地址" />
      <ProFormText name="source" label="客户来源" placeholder="抖音 / 转介绍 / 老客户 ..." />
      <ProFormTextArea name="remark" label="备注" />
    </ModalForm>
  )
}
