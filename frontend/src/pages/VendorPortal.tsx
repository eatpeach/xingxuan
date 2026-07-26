import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Spin,
  Tabs,
  Tag,
  message,
} from 'antd'
import {
  CameraOutlined,
  DownOutlined,
  FileExcelOutlined,
  LockOutlined,
  LogoutOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { VendorProduct } from './vendor/types'
import { STATUS_META, formatPrice } from './vendor/types'
import ProductFormDrawer from './vendor/ProductFormDrawer'
import AiParseModal from './vendor/AiParseModal'
import ExcelImportModal from './vendor/ExcelImportModal'

const PAGE_SIZE = 10

const CSS = `
.vp-page { min-height: 100vh; background: #f5f6f8; }
.vp-header {
  position: sticky; top: 0; z-index: 100;
  background: #12141f; color: #fff;
  display: flex; align-items: center; justify-content: space-between;
  height: 48px; padding: 0 16px;
}
.vp-header .vp-title { font-size: 16px; font-weight: 600; white-space: nowrap; }
.vp-header .vp-user { color: rgba(255,255,255,0.85); cursor: pointer; font-size: 13px; max-width: 45vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vp-content { max-width: 960px; margin: 0 auto; padding: 12px; }
.vp-toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.vp-toolbar .vp-search { flex: 1 1 200px; min-width: 180px; }
.vp-card {
  display: flex; gap: 12px; align-items: flex-start;
  background: #fff; border-radius: 8px; padding: 12px; margin-bottom: 8px;
}
.vp-thumb { width: 64px; height: 64px; flex: none; border-radius: 6px; overflow: hidden; background: #eef0f3; }
.vp-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.vp-thumb .vp-noimg { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #b5bcc9; font-size: 12px; }
.vp-main { flex: 1; min-width: 0; }
.vp-name { font-size: 15px; font-weight: 600; color: #1a1a2e; word-break: break-all; }
.vp-spec { font-size: 12px; color: #8a94a6; margin-top: 2px; word-break: break-all; }
.vp-price { font-size: 14px; color: #d4380d; margin: 4px 0; }
.vp-reject { font-size: 12px; color: #ff4d4f; margin-top: 4px; }
.vp-ops { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; font-size: 13px; }
.vp-pager { text-align: center; padding: 12px 0 24px; }
@media (max-width: 768px) {
  .vp-content { padding: 8px; }
  .vp-toolbar .ant-btn { padding-inline: 10px; }
}
`

function VendorPwdModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  return (
    <Modal
      open={open}
      title="修改密码"
      onCancel={onClose}
      confirmLoading={submitting}
      destroyOnClose
      onOk={async () => {
        try {
          const v = await form.validateFields()
          if (v.new_password !== v.confirm) {
            message.error('两次输入的新密码不一致')
            return
          }
          setSubmitting(true)
          await api.post('vendorChangePassword', {
            old_password: v.old_password,
            new_password: v.new_password,
          })
          message.success('密码已修改，请重新登录')
          localStorage.removeItem('vendor_token')
          localStorage.removeItem('vendor_name')
          localStorage.removeItem('vendor_code')
          nav('/vendor/login')
        } catch (e: unknown) {
          if ((e as { errorFields?: unknown })?.errorFields) return
        } finally {
          setSubmitting(false)
        }
      }}
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="old_password" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
          <Input.Password prefix={<LockOutlined />} />
        </Form.Item>
        <Form.Item
          name="new_password"
          label="新密码（至少 6 位）"
          rules={[{ required: true, min: 6, message: '新密码至少 6 位' }]}
        >
          <Input.Password prefix={<LockOutlined />} />
        </Form.Item>
        <Form.Item name="confirm" label="确认新密码" rules={[{ required: true, message: '请再次输入新密码' }]}>
          <Input.Password prefix={<LockOutlined />} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default function VendorPortalPage() {
  const nav = useNavigate()
  const [vendorName, setVendorName] = useState(localStorage.getItem('vendor_name') || '供应商')
  const vendorCode = localStorage.getItem('vendor_code') || ''

  const [items, setItems] = useState<VendorProduct[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState<string[]>([])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<VendorProduct | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [excelOpen, setExcelOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('vendorListProducts', {
        page,
        page_size: PAGE_SIZE,
        keyword,
        ...(status === 'all' ? {} : { status }),
      })
      setItems(r.items || [])
      setTotal(r.total || 0)
      setCounts(r.status_counts || {})
    } catch {
      // api 拦截器已 toast
    } finally {
      setLoading(false)
    }
  }, [page, status, keyword])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    api
      .get('vendorMe')
      .then((r) => {
        if (r.supplier?.name) {
          setVendorName(r.supplier.name)
          localStorage.setItem('vendor_name', r.supplier.name)
        }
      })
      .catch(() => {})
    api
      .get('shelfMeta')
      .then((r) => setCategories((r.categories || []).map((c: { name: string }) => c.name)))
      .catch(() => {})
  }, [])

  const logout = () => {
    localStorage.removeItem('vendor_token')
    localStorage.removeItem('vendor_name')
    localStorage.removeItem('vendor_code')
    nav('/vendor/login')
  }

  const onToggle = async (p: VendorProduct) => {
    try {
      const r = await api.post('vendorToggleProduct', { id: p.id })
      if (r.status === 'pending') message.success('已提交上架申请，等待平台审核')
      else if (r.status === 'off') message.success('已下架')
      else message.success('操作成功')
      load()
    } catch {
      // api 拦截器已 toast
    }
  }

  const onDelete = async (p: VendorProduct) => {
    try {
      await api.post('vendorDeleteProduct', { id: p.id })
      message.success('已删除')
      load()
    } catch {
      // api 拦截器已 toast
    }
  }

  const tabItems = [
    { key: 'all', label: `全部 ${counts.all ?? 0}` },
    { key: 'pending', label: `待审核 ${counts.pending ?? 0}` },
    { key: 'on', label: `已上架 ${counts.on ?? 0}` },
    { key: 'off', label: `已下架 ${counts.off ?? 0}` },
    { key: 'rejected', label: `已驳回 ${counts.rejected ?? 0}` },
  ]

  return (
    <div className="vp-page">
      <style>{CSS}</style>
      <div className="vp-header">
        <span className="vp-title">星选供应商门户</span>
        <Dropdown
          menu={{
            items: [
              { key: 'pwd', icon: <LockOutlined />, label: '修改密码', onClick: () => setPwdOpen(true) },
              { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout },
            ],
          }}
        >
          <span className="vp-user">
            {vendorName}
            {vendorCode ? `（${vendorCode}）` : ''} <DownOutlined style={{ fontSize: 10 }} />
          </span>
        </Dropdown>
      </div>

      <div className="vp-content">
        <Alert
          type="info"
          showIcon
          closable
          style={{ marginBottom: 8 }}
          message="商品提交后需平台审核才会展示到对外货架；大幅改价会自动转审核"
        />

        <div className="vp-toolbar">
          <Input.Search
            className="vp-search"
            allowClear
            placeholder="搜索商品名称 / 品牌 / 型号"
            onSearch={(v) => {
              setKeyword(v.trim())
              setPage(1)
            }}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null)
              setDrawerOpen(true)
            }}
          >
            新增商品
          </Button>
          <Button icon={<CameraOutlined />} onClick={() => setAiOpen(true)}>
            拍照识别
          </Button>
          <Button icon={<FileExcelOutlined />} onClick={() => setExcelOpen(true)}>
            Excel 导入
          </Button>
        </div>

        <Tabs
          activeKey={status}
          items={tabItems}
          onChange={(k) => {
            setStatus(k)
            setPage(1)
          }}
          size="small"
          tabBarStyle={{ marginBottom: 8 }}
        />

        <Spin spinning={loading}>
          {items.length === 0 && !loading ? (
            <Empty description="暂无商品" style={{ padding: '48px 0' }} />
          ) : (
            items.map((p) => (
              <div className="vp-card" key={p.id}>
                <div className="vp-thumb">
                  {p.images?.[0] ? (
                    <img src={p.images[0]} alt={p.name} />
                  ) : (
                    <div className="vp-noimg">无图</div>
                  )}
                </div>
                <div className="vp-main">
                  <div className="vp-name">{p.name}</div>
                  {(p.brand || p.spec || p.model) && (
                    <div className="vp-spec">{[p.brand, p.spec, p.model].filter(Boolean).join(' · ')}</div>
                  )}
                  <div className="vp-price">
                    底价 {formatPrice(p.base_price, p.currency)}
                    {p.unit ? ` / ${p.unit}` : ''}
                  </div>
                  <Tag color={STATUS_META[p.status]?.color}>{STATUS_META[p.status]?.label || p.status}</Tag>
                  {p.status === 'rejected' && p.reject_reason && (
                    <div className="vp-reject">驳回原因：{p.reject_reason}</div>
                  )}
                </div>
                <div className="vp-ops">
                  <a
                    onClick={() => {
                      setEditing(p)
                      setDrawerOpen(true)
                    }}
                  >
                    编辑
                  </a>
                  {p.status !== 'pending' && (
                    <Popconfirm
                      title={
                        p.status === 'on'
                          ? '确认下架该商品？下架后不再对外展示'
                          : '申请上架需平台审核，确认提交？'
                      }
                      onConfirm={() => onToggle(p)}
                    >
                      <a>{p.status === 'on' ? '下架' : '申请上架'}</a>
                    </Popconfirm>
                  )}
                  <Popconfirm title="删除后不可恢复，确认删除？" onConfirm={() => onDelete(p)}>
                    <a style={{ color: '#ff4d4f' }}>删除</a>
                  </Popconfirm>
                </div>
              </div>
            ))
          )}
        </Spin>

        {total > PAGE_SIZE && (
          <div className="vp-pager">
            <Pagination simple current={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
          </div>
        )}
      </div>

      <ProductFormDrawer
        open={drawerOpen}
        record={editing}
        categories={categories}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />
      <AiParseModal open={aiOpen} onClose={() => setAiOpen(false)} onDone={load} />
      <ExcelImportModal open={excelOpen} onClose={() => setExcelOpen(false)} onDone={load} />
      <VendorPwdModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </div>
  )
}
