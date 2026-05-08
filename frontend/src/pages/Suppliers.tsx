import { useRef } from 'react'
import {
  ActionType,
  ModalForm,
  PageContainer,
  ProColumns,
  ProFormDigit,
  ProFormText,
  ProFormTextArea,
  ProFormSwitch,
  ProTable,
} from '@ant-design/pro-components'
import { Button, Popconfirm, Rate, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api, Page } from '../api'

interface Supplier {
  id: number
  name: string
  contact: string
  phone: string
  email: string
  category: string
  rating: number
  is_active: boolean
  remark: string
}

export default function SuppliersPage() {
  const ref = useRef<ActionType>()

  const cols: ProColumns<Supplier>[] = [
    { title: 'ID', dataIndex: 'id', width: 60, search: false },
    { title: '名称', dataIndex: 'name' },
    { title: '品类', dataIndex: 'category' },
    { title: '联系人', dataIndex: 'contact', search: false },
    { title: '电话', dataIndex: 'phone', search: false },
    {
      title: '评分',
      dataIndex: 'rating',
      search: false,
      render: (_, r) => <Rate disabled value={r.rating} />,
    },
    { title: '启用', dataIndex: 'is_active', search: false, valueType: 'switch' },
    {
      title: '操作',
      valueType: 'option',
      width: 160,
      render: (_, row) => [
        <EditSupplier key="edit" record={row} onOk={() => ref.current?.reload()} />,
        <Popconfirm
          key="del"
          title="确认删除？"
          onConfirm={async () => {
            await api.delete(`/suppliers/${row.id}`)
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
    <PageContainer title="供应商管理">
      <ProTable<Supplier>
        actionRef={ref}
        rowKey="id"
        columns={cols}
        request={async (params) => {
          const { data } = await api.get<Page<Supplier>>('/suppliers', {
            params: {
              keyword: params.name || '',
              category: params.category || '',
              page: params.current,
              page_size: params.pageSize,
            },
          })
          return { data: data.items, total: data.total, success: true }
        }}
        toolBarRender={() => [
          <EditSupplier
            key="add"
            onOk={() => ref.current?.reload()}
            trigger={
              <Button type="primary" icon={<PlusOutlined />}>
                新建供应商
              </Button>
            }
          />,
        ]}
      />
    </PageContainer>
  )
}

function EditSupplier({
  record,
  onOk,
  trigger,
}: {
  record?: Supplier
  onOk: () => void
  trigger?: React.ReactNode
}) {
  const isEdit = !!record
  return (
    <ModalForm
      title={isEdit ? '编辑供应商' : '新建供应商'}
      trigger={trigger ?? <a>编辑</a>}
      initialValues={record ?? { rating: 0, is_active: true }}
      modalProps={{ destroyOnClose: true }}
      onFinish={async (v) => {
        if (isEdit) await api.put(`/suppliers/${record!.id}`, v)
        else await api.post('/suppliers', v)
        message.success('已保存')
        onOk()
        return true
      }}
    >
      <ProFormText name="name" label="名称" rules={[{ required: true }]} />
      <ProFormText name="category" label="品类" placeholder="瓷砖 / 卫浴 / 木地板..." />
      <ProFormText name="contact" label="联系人" />
      <ProFormText name="phone" label="电话" />
      <ProFormText name="email" label="邮箱" />
      <ProFormDigit name="rating" label="评分" min={0} max={5} fieldProps={{ step: 1 }} />
      <ProFormSwitch name="is_active" label="启用" />
      <ProFormTextArea name="remark" label="备注" />
    </ModalForm>
  )
}
