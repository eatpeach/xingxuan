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
import { Button, Popconfirm, Rate, Tag, Typography, message } from 'antd'
import { CopyOutlined, PlusOutlined } from '@ant-design/icons'
import { api } from '../api'
import { copyText } from '../utils/copyText'

interface Supplier {
  id: number
  code: string
  name: string
  contact: string
  phone: string
  email: string
  category: string
  rating: number
  is_active: number | boolean
  remark: string
  username: string
  portal_enabled: number
  is_verified: number
  last_login_at: string | null
}

export default function SuppliersPage() {
  const ref = useRef<ActionType>()

  const groupName = (r: Supplier) => `[星选伙伴${r.code || r.id}] ${r.name}`

  const cols: ProColumns<Supplier>[] = [
    {
      title: '编号',
      dataIndex: 'code',
      width: 70,
      search: false,
      render: (v) => <Typography.Text strong>{v || '-'}</Typography.Text>,
    },
    { title: '名称', dataIndex: 'name' },
    {
      title: '群名（点击复制）',
      width: 220,
      search: false,
      render: (_, r) => (
        <Tag
          color="blue"
          icon={<CopyOutlined />}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            const t = groupName(r)
            copyText(t)
              .then(() => message.success(`已复制：${t}`))
              .catch(() => message.error('复制失败，请手动复制'))
          }}
        >
          {groupName(r)}
        </Tag>
      ),
    },
    { title: '品类', dataIndex: 'category' },
    { title: '联系人', dataIndex: 'contact', search: false },
    { title: '电话', dataIndex: 'phone', search: false },
    {
      title: '评分',
      dataIndex: 'rating',
      search: false,
      render: (_, r) => <Rate disabled value={Number(r.rating)} />,
    },
    {
      title: '启用',
      dataIndex: 'is_active',
      search: false,
      render: (_, r) => (Number(r.is_active) ? '已启用' : '已停用'),
    },
    {
      title: '门户',
      search: false,
      width: 120,
      render: (_, r) => (
        <span>
          {Number(r.portal_enabled) ? (
            <Tag color="blue">{r.username || '已开通'}</Tag>
          ) : (
            <span style={{ color: '#bbb' }}>未开通</span>
          )}
          {Number(r.is_verified) ? <Tag color="green">已验厂</Tag> : null}
        </span>
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 220,
      render: (_, row) => [
        <EditSupplier key="edit" record={row} onOk={() => ref.current?.reload()} />,
        <PortalAccount key="portal" record={row} onOk={() => ref.current?.reload()} />,
        <Popconfirm
          key="del"
          title="确认删除？"
          onConfirm={async () => {
            await api.post('deleteSupplier', { id: row.id })
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
          const data = await api.get('listSuppliers', {
            keyword: params.name || '',
            category: params.category || '',
            page: params.current,
            page_size: params.pageSize,
          })
          return { data: data.items, total: data.total, success: true }
        }}
        headerTitle="供应商管理"
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
  trigger?: JSX.Element
}) {
  const isEdit = !!record
  const initial = record
    ? { ...record, is_active: Number(record.is_active) === 1 }
    : { rating: 0, is_active: true }
  return (
    <ModalForm
      title={isEdit ? '编辑供应商' : '新建供应商'}
      trigger={trigger ?? <a>编辑</a>}
      initialValues={initial}
      modalProps={{ destroyOnClose: true }}
      onFinish={async (v) => {
        const payload = { ...v, is_active: v.is_active ? 1 : 0 }
        if (isEdit) await api.post('updateSupplier', { id: record!.id, ...payload })
        else await api.post('createSupplier', payload)
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

/** 供应商门户账号：开通 / 重置密码 / 停启用 / 验厂标（仅 admin 可保存） */
function PortalAccount({ record, onOk }: { record: Supplier; onOk: () => void }) {
  return (
    <ModalForm
      title={`门户账号 · ${record.name}`}
      trigger={<a>门户账号</a>}
      initialValues={{
        username: record.username || '',
        portal_enabled: Number(record.portal_enabled) === 1,
        is_verified: Number(record.is_verified) === 1,
      }}
      modalProps={{ destroyOnClose: true, zIndex: 9999 }}
      onFinish={async (v) => {
        await api.post('setSupplierPortal', {
          supplier_id: record.id,
          username: v.username || '',
          password: v.password || '',
          portal_enabled: v.portal_enabled ? 1 : 0,
          is_verified: v.is_verified ? 1 : 0,
        })
        message.success('已保存')
        onOk()
        return true
      }}
    >
      <div style={{ color: '#999', fontSize: 12, marginBottom: 12 }}>
        供应商用此账号登录 {window.location.origin}/vendor/login 自助维护商品与价格
        {record.last_login_at ? `（上次登录：${record.last_login_at}）` : ''}
      </div>
      <ProFormText name="username" label="登录用户名" placeholder="建议用供应商编号或拼音" />
      <ProFormText.Password
        name="password"
        label="登录密码"
        placeholder={record.username ? '留空则不修改' : '至少 6 位'}
        rules={record.username ? [] : [{ required: true, min: 6, message: '至少 6 位' }]}
      />
      <ProFormSwitch name="portal_enabled" label="开通门户登录" />
      <ProFormSwitch name="is_verified" label="验厂标（货架展示「已验厂工厂」）" />
    </ModalForm>
  )
}
