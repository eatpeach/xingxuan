import { useEffect, useState } from 'react'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import {
  Alert,
  Button,
  Checkbox,
  ColorPicker,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Upload,
  message,
} from 'antd'
import { PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { api } from '../api'
import { MODULES, ROLE_LABEL, ROLE_OPTIONS } from '../roles'
import { applyThemeColor, DEFAULT_THEME_COLOR } from '../theme'
import BannerManager from './BannerManager'
import BatchCreateUsers from './BatchCreateUsers'

interface SettingItem {
  key: string
  value: string
  description: string
}

const TOGGLE_KEYS = new Set(['hide_supplier_brand_default'])
const NUMBER_KEYS = new Set(['default_markup_pct', 'default_quote_valid_days',
  'shelf.default_markup_pct', 'shelf.price_change_threshold_pct'])
const PASSWORD_KEYS = new Set(['ai.openai.api_key'])
const TEXTAREA_KEYS = new Set(['customer_sources', 'customer_categories',
  'shelf.categories', 'shelf.category_markup'])
const COLOR_KEYS = new Set(['theme_color'])
const IMAGE_KEYS = new Set(['shelf.qr_douyin', 'shelf.qr_channels', 'shelf.qr_wecom', 'pdf_logo_path'])

export default function SettingsPage() {
  const isAdmin = (localStorage.getItem('role') || '') === 'admin'
  const [tab, setTab] = useState('params')

  const tabList = [{ key: 'params', tab: '参数设置' }]
  if (isAdmin) {
    tabList.push(
      { key: 'payment', tab: '收款主体 / 账户' },
      { key: 'users', tab: '账户管理' },
      { key: 'perms', tab: '权限管理' },
    )
  }

  return (
    <PageContainer title="系统设置" tabList={tabList} tabActiveKey={tab} onTabChange={setTab}>
      {tab === 'params' && <ParamsPane />}
      {tab === 'payment' && <PaymentPane />}
      {tab === 'users' && <UsersPane />}
      {tab === 'perms' && <PermsPane />}
    </PageContainer>
  )
}

// ---------------- 收款主体 / 收款账户 ----------------
const ACCOUNT_TYPES = [
  { label: '印尼对公', value: 'idr_public' },
  { label: '印尼对私', value: 'idr_private' },
  { label: '印尼收款码', value: 'idr_qr' },
  { label: '人民币对公', value: 'rmb_public' },
  { label: '人民币对私', value: 'rmb_private' },
  { label: '人民币收款码', value: 'rmb_qr' },
]

/** 图片上传：受控值存相对路径，预览拼 /storage/ */
function ImagePathUpload({
  value,
  onChange,
}: {
  value?: string
  onChange?: (v: string) => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Space>
      {value && (
        <img
          src={'/storage/' + String(value).replace(/^\/+/, '')}
          alt=""
          style={{ width: 56, height: 56, objectFit: 'contain', border: '1px solid #f0f0f0', borderRadius: 4 }}
        />
      )}
      <Upload
        showUploadList={false}
        beforeUpload={async (file) => {
          setBusy(true)
          try {
            const fd = new FormData()
            fd.append('file', file)
            const r = await api.upload('uploadPaymentImage', fd)
            onChange?.(r.path)
          } finally {
            setBusy(false)
          }
          return false
        }}
      >
        <Button size="small" loading={busy} icon={<UploadOutlined />}>
          {value ? '更换' : '上传'}
        </Button>
      </Upload>
      {value && <a style={{ color: '#ff4d4f' }} onClick={() => onChange?.('')}>移除</a>}
    </Space>
  )
}

function PaymentPane() {
  const [entities, setEntities] = useState<any[]>([])
  const [accounts, setAccounts] = useState<any[]>([])
  const [activeEntity, setActiveEntity] = useState<number | null>(null)
  const [entityEdit, setEntityEdit] = useState<any>(null)
  const [accountEdit, setAccountEdit] = useState<any>(null)
  const [eForm] = Form.useForm()
  const [aForm] = Form.useForm()

  const loadEntities = async () => {
    const r = await api.get('listPaymentEntities')
    const list = r.items || []
    setEntities(list)
    setActiveEntity((cur) => {
      if (!list.length) return null
      if (cur != null && list.some((e: any) => Number(e.id) === cur)) return cur
      return Number(list[0].id)
    })
  }
  const loadAccounts = async (eid: number | null) => {
    if (!eid) return setAccounts([])
    const r = await api.get('listPaymentAccounts', { entity_id: eid })
    setAccounts(r.items || [])
  }

  useEffect(() => {
    loadEntities()
  }, [])
  useEffect(() => {
    loadAccounts(activeEntity)
  }, [activeEntity])

  const saveEntity = async () => {
    const v = await eForm.validateFields()
    await api.post('savePaymentEntity', { ...v, id: entityEdit?.id || 0 })
    message.success('已保存')
    setEntityEdit(null)
    loadEntities()
  }
  const saveAccount = async () => {
    const v = await aForm.validateFields()
    await api.post('savePaymentAccount', { ...v, id: accountEdit?.id || 0, entity_id: activeEntity })
    message.success('已保存')
    setAccountEdit(null)
    loadAccounts(activeEntity)
  }

  return (
    <ProCard split="vertical" bordered>
      <ProCard
        colSpan="320px"
        title="收款主体"
        extra={<Button type="link" size="small" onClick={() => { eForm.resetFields(); setEntityEdit({}) }}>新增</Button>}
      >
        {entities.length === 0 && <Empty description="还没有收款主体" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        {entities.map((e) => (
          <div
            key={e.id}
            onClick={() => setActiveEntity(Number(e.id))}
            style={{
              padding: '10px 12px',
              marginBottom: 8,
              borderRadius: 6,
              cursor: 'pointer',
              border: '1px solid ' + (Number(e.id) === activeEntity ? '#1d57e0' : '#f0f0f0'),
              background: Number(e.id) === activeEntity ? '#f0f5ff' : '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {e.logo_url && <img src={e.logo_url} alt="" style={{ width: 26, height: 26, objectFit: 'contain' }} />}
              <strong style={{ flex: 1 }}>{e.name}</strong>
              {e.status === 'inactive' && <Tag>停用</Tag>}
            </div>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>
              {e.tax_no ? `NPWP ${e.tax_no} · ` : ''}
              {e.accounts_count} 个账户
            </div>
            <div style={{ marginTop: 6 }}>
              <a
                style={{ fontSize: 12 }}
                onClick={(ev) => { ev.stopPropagation(); eForm.setFieldsValue(e); setEntityEdit(e) }}
              >
                编辑
              </a>
              <Popconfirm
                title="删除该主体？"
                description="其下收款账户一并删除。已开出的发票存的是快照，不受影响。"
                onConfirm={async () => {
                  await api.post('deletePaymentEntity', { id: e.id })
                  message.success('已删除')
                  loadEntities()
                }}
              >
                <a style={{ fontSize: 12, color: '#ff4d4f', marginLeft: 10 }} onClick={(ev) => ev.stopPropagation()}>
                  删除
                </a>
              </Popconfirm>
            </div>
          </div>
        ))}
      </ProCard>

      <ProCard
        title="收款账户"
        extra={
          <Button
            type="primary"
            size="small"
            disabled={!activeEntity}
            onClick={() => {
              aForm.resetFields()
              aForm.setFieldsValue({ type: 'idr_public', currency: 'IDR', status: 'active' })
              setAccountEdit({})
            }}
          >
            新增账户
          </Button>
        }
      >
        {!activeEntity ? (
          <Empty description="先在左侧新增一个收款主体" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            dataSource={accounts}
            pagination={false}
            locale={{ emptyText: '该主体下还没有收款账户' }}
            columns={[
              {
                title: '类型',
                width: 110,
                dataIndex: 'type',
                render: (v: string) => ACCOUNT_TYPES.find((t) => t.value === v)?.label || v,
              },
              { title: '银行', dataIndex: 'bank_name' },
              { title: '账户名', dataIndex: 'account_name' },
              { title: '账号', dataIndex: 'account_number' },
              { title: '币种', dataIndex: 'currency', width: 70 },
              {
                title: '默认',
                width: 60,
                render: (_: any, r: any) => (r.is_default ? <Tag color="blue">默认</Tag> : null),
              },
              {
                title: '状态',
                width: 70,
                render: (_: any, r: any) => (r.status === 'active' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
              },
              {
                title: '操作',
                width: 100,
                render: (_: any, r: any) => (
                  <Space>
                    <a onClick={() => { aForm.setFieldsValue(r); setAccountEdit(r) }}>编辑</a>
                    <Popconfirm
                      title="删除该账户？"
                      onConfirm={async () => {
                        await api.post('deletePaymentAccount', { id: r.id })
                        message.success('已删除')
                        loadAccounts(activeEntity)
                      }}
                    >
                      <a style={{ color: '#ff4d4f' }}>删除</a>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </ProCard>

      <Modal
        open={!!entityEdit}
        title={entityEdit?.id ? '编辑收款主体' : '新增收款主体'}
        onCancel={() => setEntityEdit(null)}
        onOk={saveEntity}
        zIndex={9999}
        destroyOnClose
        width={560}
      >
        <Form form={eForm} layout="vertical">
          <Form.Item name="name" label="主体名称（开票抬头）" rules={[{ required: true }]}>
            <Input placeholder="如 PT. SATU TRADE INDONESIA" />
          </Form.Item>
          <Form.Item name="tax_no" label="税号 NPWP">
            <Input />
          </Form.Item>
          <Form.Item name="address" label="地址">
            <Input.TextArea rows={2} placeholder="发票抬头下显示的公司地址" />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input />
          </Form.Item>
          <Form.Item name="logo_path" label="Logo（发票抬头）">
            <ImagePathUpload />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Radio.Group>
              <Radio value="active">启用</Radio>
              <Radio value="inactive">停用</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!accountEdit}
        title={accountEdit?.id ? '编辑收款账户' : '新增收款账户'}
        onCancel={() => setAccountEdit(null)}
        onOk={saveAccount}
        zIndex={9999}
        destroyOnClose
        width={560}
      >
        <Form form={aForm} layout="vertical">
          <Form.Item name="type" label="账户类型" rules={[{ required: true }]}>
            <Select options={ACCOUNT_TYPES} />
          </Form.Item>
          <Form.Item name="bank_name" label="银行" rules={[{ required: true }]}>
            <Input placeholder="如 ICBC / BCA / Mandiri" />
          </Form.Item>
          <Form.Item name="account_name" label="账户名" rules={[{ required: true }]}>
            <Input placeholder="开户名" />
          </Form.Item>
          <Form.Item name="account_number" label="账号" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="branch" label="支行">
            <Input />
          </Form.Item>
          <Form.Item name="swift" label="SWIFT（跨境付款用）">
            <Input />
          </Form.Item>
          <Form.Item name="currency" label="币种" initialValue="IDR">
            <Radio.Group>
              <Radio value="IDR">IDR</Radio>
              <Radio value="CNY">CNY</Radio>
              <Radio value="USD">USD</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="qr_path" label="收款码（可选）">
            <ImagePathUpload />
          </Form.Item>
          <Form.Item name="is_default" label="设为该主体此币种的默认账户" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Radio.Group>
              <Radio value="active">启用</Radio>
              <Radio value="inactive">停用</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>
    </ProCard>
  )
}

// ---------------- 参数设置（原有内容） ----------------

function ParamsPane() {
  const [items, setItems] = useState<SettingItem[]>([])
  const [bannerOpen, setBannerOpen] = useState(false)
  const load = async () => setItems((await api.get('listSettings')).items)
  useEffect(() => {
    load()
  }, [])

  const update = async (key: string, value: string) => {
    await api.post('updateSetting', { key, value })
    message.success('已保存')
    load()
  }

  return (
    <>
      <ProCard title="界面主题" bordered headerBordered
        extra={<span style={{ fontSize: 12, color: '#999' }}>保存后全站生效（按钮/链接/侧栏选中/页头等）</span>}>
        {items
          .filter((i) => i.key === 'theme_color')
          .map((i) => (
            <SettingRow key={i.key} item={i} onSave={update} />
          ))}
      </ProCard>

      <Divider />

      <ProCard title="对外报价" bordered headerBordered>
        {items
          .filter((i) =>
            ['hide_supplier_brand_default', 'company_name', 'pdf_logo_path',
             'company_address', 'company_phone', 'default_quote_valid_days'].includes(i.key),
          )
          .map((i) => (
            <SettingRow key={i.key} item={i} onSave={update} />
          ))}
      </ProCard>

      <Divider />

      <ProCard title="发票 / 收款账户" bordered headerBordered
        extra={<span style={{ fontSize: 12, color: '#999' }}>开具发票时使用</span>}>
        {items
          .filter((i) =>
            ['invoice_no_prefix', 'invoice_due_days',
             'bank_name', 'bank_account_no', 'bank_account_name', 'bank_swift'].includes(i.key),
          )
          .map((i) => (
            <SettingRow key={i.key} item={i} onSave={update} />
          ))}
      </ProCard>

      <Divider />

      <ProCard title="加价 / 业务" bordered headerBordered>
        {items
          .filter((i) => i.key === 'default_markup_pct')
          .map((i) => (
            <SettingRow key={i.key} item={i} onSave={update} />
          ))}
      </ProCard>

      <Divider />

      <ProCard title="客户分类" bordered headerBordered
        extra={<span style={{ fontSize: 12, color: '#999' }}>每行一个，客户管理里下拉可选（也支持直接输入自定义）</span>}>
        {items
          .filter((i) => i.key === 'customer_categories')
          .map((i) => (
            <SettingRow key={i.key} item={i} onSave={update} />
          ))}
      </ProCard>

      <Divider />

      <ProCard title="客户来源" bordered headerBordered
        extra={<span style={{ fontSize: 12, color: '#999' }}>每行一个，客户管理里下拉可选（也支持直接输入自定义）</span>}>
        {items
          .filter((i) => i.key === 'customer_sources')
          .map((i) => (
            <SettingRow key={i.key} item={i} onSave={update} />
          ))}
      </ProCard>

      <Divider />

      <ProCard title="电子货架" bordered headerBordered
        extra={<span style={{ fontSize: 12, color: '#999' }}>对外价 = 供货底价 × (1 + 加价率)；品类加价率每行一条「品类:百分比」，未命中用默认加价率</span>}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
          <div>
            <div style={{ fontWeight: 500 }}>首页横幅幻灯片</div>
            <div style={{ color: '#999', fontSize: 12 }}>货架首页顶部轮播图，可上传多张、排序、设跳转链接</div>
          </div>
          <Button onClick={() => setBannerOpen(true)}>管理横幅</Button>
        </div>
        {items
          .filter((i) => i.key.startsWith('shelf.'))
          .map((i) => (
            <SettingRow key={i.key} item={i} onSave={update} />
          ))}
      </ProCard>
      <BannerManager open={bannerOpen} onClose={() => setBannerOpen(false)} />

      <Divider />

      <ProCard title="AI（询价文本智能解析）" bordered headerBordered
        extra={<span style={{ fontSize: 12, color: '#999' }}>填写后，新建商机时可一键把客户原文解析成明细</span>}>
        {items
          .filter((i) => i.key.startsWith('ai.openai.'))
          .map((i) => (
            <SettingRow key={i.key} item={i} onSave={update} />
          ))}
      </ProCard>
    </>
  )
}

// ---------------- 账户管理 ----------------

interface UserRow {
  id: number
  username: string
  name: string
  role: string
  phone: string
  is_active: number
  created_at: string
}

function UsersPane() {
  const [rows, setRows] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [pwdUser, setPwdUser] = useState<UserRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const [pwdForm] = Form.useForm()
  const myId = Number(localStorage.getItem('user_id') || 0)

  const load = () => {
    setLoading(true)
    api
      .get('listUsers')
      .then((r) => setRows(r.items || []))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openEdit = (u: UserRow | null) => {
    setEditing(u)
    form.setFieldsValue(
      u
        ? { username: u.username, name: u.name, role: u.role, phone: u.phone }
        : { username: '', name: '', role: 'sales', phone: '', password: '' },
    )
    setEditOpen(true)
  }

  const save = async () => {
    try {
      const v = await form.validateFields()
      setSaving(true)
      await api.post('saveUser', { id: editing?.id, ...v })
      message.success('已保存')
      setEditOpen(false)
      load()
    } catch (e: any) {
      if (e?.errorFields) return
    } finally {
      setSaving(false)
    }
  }

  const resetPwd = async () => {
    try {
      const v = await pwdForm.validateFields()
      setSaving(true)
      await api.post('resetUserPassword', { id: pwdUser!.id, new_password: v.new_password })
      message.success('密码已重置')
      setPwdUser(null)
    } catch (e: any) {
      if (e?.errorFields) return
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProCard
      title="账户管理"
      bordered
      headerBordered
      extra={
        <>
          <BatchCreateUsers onDone={load} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit(null)}>
            新增用户
          </Button>
        </>
      }
    >
      <Table<UserRow>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '用户名', dataIndex: 'username', width: 140 },
          { title: '姓名', dataIndex: 'name', width: 140, render: (v) => v || '-' },
          {
            title: '角色',
            dataIndex: 'role',
            width: 110,
            render: (v) => <Tag color={v === 'admin' ? 'red' : 'blue'}>{ROLE_LABEL[v] || v}</Tag>,
          },
          { title: '电话', dataIndex: 'phone', width: 140, render: (v) => v || '-' },
          {
            title: '状态',
            dataIndex: 'is_active',
            width: 80,
            render: (v) => (v ? <Tag color="success">启用</Tag> : <Tag color="error">停用</Tag>),
          },
          { title: '创建时间', dataIndex: 'created_at', width: 170 },
          {
            title: '操作',
            render: (_, u) => (
              <Space size="middle">
                <a onClick={() => openEdit(u)}>编辑</a>
                <a
                  onClick={() => {
                    pwdForm.resetFields()
                    setPwdUser(u)
                  }}
                >
                  重置密码
                </a>
                {u.id !== myId && (
                  <a
                    onClick={async () => {
                      await api.post('toggleUserActive', { id: u.id })
                      load()
                    }}
                  >
                    {u.is_active ? '停用' : '启用'}
                  </a>
                )}
                {u.id !== myId && (
                  <Popconfirm title="确定删除该用户？其历史数据保留。" onConfirm={async () => {
                    await api.post('deleteUser', { id: u.id })
                    message.success('已删除')
                    load()
                  }}>
                    <a style={{ color: '#cf1322' }}>删除</a>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={editOpen}
        zIndex={9999}
        title={editing ? '编辑用户' : '新增用户'}
        onCancel={() => setEditOpen(false)}
        onOk={save}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="username"
            label="用户名"
            rules={editing ? [] : [{ required: true, pattern: /^[a-zA-Z0-9_\-.]{2,32}$/, message: '字母数字-_.（2~32位）' }]}
          >
            <Input disabled={!!editing} placeholder="登录账号" />
          </Form.Item>
          {!editing && (
            <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 6, message: '至少 6 位' }]}>
              <Input.Password placeholder="至少 6 位" />
            </Form.Item>
          )}
          <Form.Item name="name" label="姓名">
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!pwdUser}
        zIndex={9999}
        title={`重置密码：${pwdUser?.name || pwdUser?.username || ''}`}
        onCancel={() => setPwdUser(null)}
        onOk={resetPwd}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={pwdForm} layout="vertical" preserve={false}>
          <Form.Item name="new_password" label="新密码（至少 6 位）" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </ProCard>
  )
}

// ---------------- 权限管理 ----------------

function PermsPane() {
  const [perms, setPerms] = useState<Record<string, string[]>>({})
  const [roles, setRoles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([api.get('getRolePermissions'), api.get('listUsers')])
      .then(([p, u]) => {
        const saved: Record<string, string[]> = p.permissions || {}
        const fromUsers: string[] = (u.items || []).map((x: any) => x.role)
        const all = [...new Set([...ROLE_OPTIONS.map((r) => r.value), ...fromUsers, ...Object.keys(saved)])].filter(
          (r) => r !== 'admin',
        )
        setRoles(all)
        // 未配置的角色默认全选
        const merged: Record<string, string[]> = {}
        for (const r of all) merged[r] = Array.isArray(saved[r]) ? saved[r] : MODULES.map((m) => m.key)
        setPerms(merged)
      })
      .finally(() => setLoading(false))
  }, [])

  const toggle = (role: string, mod: string, checked: boolean) => {
    setPerms((p) => ({
      ...p,
      [role]: checked ? [...(p[role] || []), mod] : (p[role] || []).filter((m) => m !== mod),
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.post('saveRolePermissions', { permissions: perms })
      message.success('已保存，成员下次刷新页面生效')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProCard
      title="权限管理"
      bordered
      headerBordered
      loading={loading}
      extra={
        <Button type="primary" onClick={save} loading={saving}>
          保存
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="勾选 = 该角色可见对应模块（侧栏菜单）。管理员恒定拥有全部权限；从未保存过的角色默认全部可见。"
      />
      <Table
        rowKey="role"
        size="small"
        pagination={false}
        dataSource={roles.map((r) => ({ role: r }))}
        columns={[
          {
            title: '角色',
            dataIndex: 'role',
            width: 120,
            render: (v: string) => <Tag color="blue">{ROLE_LABEL[v] || v}</Tag>,
          },
          ...MODULES.map((m) => ({
            title: m.label,
            width: 110,
            render: (_: any, row: { role: string }) => (
              <Checkbox
                checked={(perms[row.role] || []).includes(m.key)}
                onChange={(e) => toggle(row.role, m.key, e.target.checked)}
              />
            ),
          })),
        ]}
      />
    </ProCard>
  )
}

// ---------------- 单条参数行 ----------------

function SettingRow({
  item,
  onSave,
}: {
  item: SettingItem
  onSave: (k: string, v: string) => void
}) {
  const [val, setVal] = useState<string>(item.value)
  useEffect(() => setVal(item.value), [item.value])

  let editor: React.ReactNode
  if (TOGGLE_KEYS.has(item.key)) {
    editor = (
      <Switch
        checked={val === 'true'}
        onChange={(v) => {
          const nv = v ? 'true' : 'false'
          setVal(nv)
          onSave(item.key, nv)
        }}
      />
    )
  } else if (NUMBER_KEYS.has(item.key)) {
    editor = (
      <Space>
        <InputNumber value={Number(val)} onChange={(v) => setVal(String(v ?? 0))} />
        <Button type="primary" onClick={() => onSave(item.key, val)}>
          保存
        </Button>
      </Space>
    )
  } else if (COLOR_KEYS.has(item.key)) {
    const cur = val || DEFAULT_THEME_COLOR
    editor = (
      <Space>
        <ColorPicker
          value={cur}
          showText
          presets={[
            {
              label: '预设',
              colors: ['#1d57e0', '#722ed1', '#13c2c2', '#52c41a', '#fa541c', '#eb2f96', '#d4380d', '#1b1c27'],
            },
          ]}
          onChange={(c) => setVal(c.toHexString())}
        />
        <Button
          type="primary"
          onClick={() => {
            onSave(item.key, cur)
            applyThemeColor(cur)
          }}
        >
          保存并应用
        </Button>
      </Space>
    )
  } else if (IMAGE_KEYS.has(item.key)) {
    editor = (
      <Space>
        {val ? (
          <img
            src={`/storage/${val}`}
            alt=""
            style={{ width: 64, height: 64, objectFit: 'contain', border: '1px solid #eee', borderRadius: 4, background: '#fafafa' }}
          />
        ) : (
          <span style={{ color: '#bbb', fontSize: 12 }}>未上传</span>
        )}
        <Upload
          accept="image/png,image/jpeg,image/webp"
          showUploadList={false}
          customRequest={async ({ file, onSuccess, onError }) => {
            const fd = new FormData()
            fd.append('file', file as File)
            fd.append('key', item.key)
            try {
              const r = await api.upload('uploadSettingImage', fd)
              setVal(r.value)
              message.success('已上传并保存')
              onSuccess?.(r)
            } catch (e) {
              onError?.(e as Error)
            }
          }}
        >
          <Button icon={<UploadOutlined />}>上传图片</Button>
        </Upload>
        {val && (
          <Button
            danger
            onClick={() => {
              setVal('')
              onSave(item.key, '')
            }}
          >
            清除
          </Button>
        )}
      </Space>
    )
  } else if (TEXTAREA_KEYS.has(item.key)) {
    editor = (
      <Space align="start">
        <Input.TextArea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          rows={5}
          style={{ width: 360 }}
          placeholder={'抖音-阿星在印尼\n抖音-星选建材'}
        />
        <Button type="primary" onClick={() => onSave(item.key, val)}>
          保存
        </Button>
      </Space>
    )
  } else if (PASSWORD_KEYS.has(item.key)) {
    editor = (
      <Space>
        <Input.Password
          value={val}
          onChange={(e) => setVal(e.target.value)}
          style={{ width: 360 }}
          placeholder="sk-..."
        />
        <Button type="primary" onClick={() => onSave(item.key, val)}>
          保存
        </Button>
      </Space>
    )
  } else {
    editor = (
      <Space>
        <Input value={val} onChange={(e) => setVal(e.target.value)} style={{ width: 360 }} />
        <Button type="primary" onClick={() => onSave(item.key, val)}>
          保存
        </Button>
      </Space>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
      <div>
        <div style={{ fontWeight: 500 }}>{item.description || item.key}</div>
        <div style={{ color: '#999', fontSize: 12 }}>{item.key}</div>
      </div>
      {editor}
    </div>
  )
}
