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
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text)
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    ta.style.top = '0'
    ta.setAttribute('readonly', '')
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    try {
      document.execCommand('copy') ? resolve() : reject(new Error('execCommand failed'))
    } catch (e) {
      reject(e)
    } finally {
      document.body.removeChild(ta)
    }
  })
}

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
  const nav = useNavigate()
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
    { title: '公司', dataIndex: 'company', width: 160, ellipsis: true, search: false },
    { title: '电话', dataIndex: 'phone', width: 130 },
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
    { title: '来源', dataIndex: 'source', width: 90, search: false },
    {
      title: '操作',
      valueType: 'option',
      width: 200,
      render: (_, row) => [
        <a
          key="new-inquiry"
          onClick={() =>
            nav('/inquiries', { state: { newInquiryCustomerId: row.id } })
          }
        >
          新建询价
        </a>,
        <EditCustomer key="edit" record={row} onOk={() => ref.current?.reloadAndRest?.()} />,
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
      initialValues={record ? { ...record, short_name: record.short_name || record.name } : undefined}
      modalProps={{ destroyOnClose: true }}
      width={720}
      grid
      rowProps={{ gutter: [16, 0] }}
      onFinish={async (v) => {
        // 简称同时写到 name 字段，UI 只暴露一个"客户名"
        const payload = { ...v, name: v.short_name }
        if (isEdit) await api.post('updateCustomer', { id: record!.id, ...payload })
        else await api.post('createCustomer', payload)
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
      <ProFormText name="company" label="公司" colProps={{ span: 12 }} />
      <ProFormText name="phone" label="电话" colProps={{ span: 12 }} />
      <ProFormText name="wechat" label="微信" colProps={{ span: 12 }} />
      <ProFormText name="email" label="邮箱" colProps={{ span: 12 }} />
      <ProFormText name="address" label="地址" colProps={{ span: 12 }} />
      <ProFormText
        name="source"
        label="客户来源"
        placeholder="抖音 / 转介绍 / 老客户 ..."
        colProps={{ span: 12 }}
      />
      <ProFormTextArea name="remark" label="备注" colProps={{ span: 24 }} fieldProps={{ rows: 2 }} />
    </ModalForm>
  )
}
