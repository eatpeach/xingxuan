import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Spin,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd'
import {
  CameraOutlined,
  CheckCircleFilled,
  DownOutlined,
  FileExcelOutlined,
  LockOutlined,
  LogoutOutlined,
  PlusOutlined,
  ShopOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { VendorProduct } from './vendor/types'
import { STATUS_META, formatPrice } from './vendor/types'
import ProductFormDrawer from './vendor/ProductFormDrawer'
import AiParseModal from './vendor/AiParseModal'
import ExcelImportModal from './vendor/ExcelImportModal'
import logoWhite from '../assets/logo-white.png'

const PAGE_SIZE = 10

const CSS = `
.vp-page { min-height: 100vh; background: #f5f6f8; }
.vp-header {
  position: sticky; top: 0; z-index: 100;
  background: #12141f; color: #fff;
  display: flex; align-items: center; justify-content: space-between;
  height: 52px; padding: 0 16px;
}
.vp-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.vp-header-left img { height: 26px; display: block; }
.vp-header .vp-title { font-size: 16px; font-weight: 600; white-space: nowrap; }
.vp-header-right { display: flex; align-items: center; gap: 16px; }
.vp-shelf-link { color: rgba(255,255,255,0.65); font-size: 13px; white-space: nowrap; }
.vp-shelf-link:hover { color: #fff; }
.vp-header .vp-user { color: rgba(255,255,255,0.85); cursor: pointer; font-size: 13px; max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vp-content { max-width: 1080px; margin: 0 auto; padding: 16px; }

/* 欢迎条 + 统计卡 */
.vp-hello { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.vp-hello .hi { font-size: 17px; font-weight: 600; color: #1a1a2e; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.vp-hello .sub { font-size: 12px; color: #8a94a6; }
.vp-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px; }
.vp-stat {
  background: #fff; border-radius: 8px; padding: 14px 16px; cursor: pointer;
  border: 1px solid transparent; transition: all 0.15s;
}
.vp-stat:hover { border-color: var(--brand, #1d57e0); box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
.vp-stat.active { border-color: var(--brand, #1d57e0); }
.vp-stat .n { font-size: 22px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }
.vp-stat .t { font-size: 12px; color: #8a94a6; margin-top: 2px; }

/* 合作规则 */
.vp-rules {
  background: linear-gradient(90deg, color-mix(in srgb, var(--brand, #1d57e0) 7%, #fff), #fff);
  border: 1px solid color-mix(in srgb, var(--brand, #1d57e0) 18%, #fff);
  border-radius: 8px; padding: 10px 14px; margin-bottom: 12px;
  display: flex; gap: 18px; flex-wrap: wrap; font-size: 12.5px; color: #4a5468;
}
.vp-rules b { color: var(--brand, #1d57e0); font-weight: 600; }

/* 列表区 */
.vp-panel { background: #fff; border-radius: 8px; padding: 12px; }
.vp-toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.vp-toolbar .vp-search { flex: 1 1 220px; min-width: 180px; }
.vp-card { display: flex; gap: 12px; align-items: flex-start; background: #fff; border-radius: 8px; padding: 12px 4px; border-bottom: 1px solid #f0f1f4; }
.vp-thumb { width: 64px; height: 64px; flex: none; border-radius: 6px; overflow: hidden; background: #eef0f3; }
.vp-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.vp-thumb .vp-noimg { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #b5bcc9; font-size: 12px; }
.vp-main { flex: 1; min-width: 0; }
.vp-name { font-size: 15px; font-weight: 600; color: #1a1a2e; word-break: break-all; }
.vp-spec { font-size: 12px; color: #8a94a6; margin-top: 2px; word-break: break-all; }
.vp-price { font-size: 14px; color: #d4380d; margin: 4px 0; }
.vp-meta { font-size: 11px; color: #a0a8b8; margin-top: 4px; }
.vp-reject { font-size: 12px; color: #ff4d4f; margin-top: 4px; }
.vp-ops { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; font-size: 13px; }
.vp-pager { text-align: center; padding: 12px 0 4px; }
.vp-tbl-name { font-weight: 600; color: #1a1a2e; }
.vp-tbl-sub { font-size: 12px; color: #8a94a6; }
@media (max-width: 768px) {
  .vp-content { padding: 10px; }
  .vp-stats { grid-template-columns: repeat(2, 1fr); }
  .vp-toolbar .ant-btn { padding-inline: 10px; }
  .vp-shelf-link { display: none; }
  .vp-rules { gap: 6px; flex-direction: column; }
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
  const [isVerified, setIsVerified] = useState(false)
  const [lastLoginAt, setLastLoginAt] = useState('')

  const [items, setItems] = useState<VendorProduct[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const [isWide, setIsWide] = useState(() => window.matchMedia('(min-width: 769px)').matches)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<VendorProduct | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [excelOpen, setExcelOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 769px)')
    const h = (e: MediaQueryListEvent) => setIsWide(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

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
        setIsVerified(Number(r.supplier?.is_verified) === 1)
        setLastLoginAt(r.supplier?.last_login_at || '')
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

  const switchStatus = (k: string) => {
    setStatus(k)
    setPage(1)
  }

  const STATS: { key: string; label: string; color?: string }[] = [
    { key: 'on', label: '已上架', color: '#52c41a' },
    { key: 'pending', label: '待审核', color: '#fa8c16' },
    { key: 'rejected', label: '已驳回', color: '#ff4d4f' },
    { key: 'all', label: '全部商品' },
  ]

  const tabItems = [
    { key: 'all', label: `全部 ${counts.all ?? 0}` },
    { key: 'pending', label: `待审核 ${counts.pending ?? 0}` },
    { key: 'on', label: `已上架 ${counts.on ?? 0}` },
    { key: 'off', label: `已下架 ${counts.off ?? 0}` },
    { key: 'rejected', label: `已驳回 ${counts.rejected ?? 0}` },
  ]

  const renderOps = (p: VendorProduct) => (
    <>
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
          title={p.status === 'on' ? '确认下架该商品？下架后不再对外展示' : '申请上架需平台审核，确认提交？'}
          onConfirm={() => onToggle(p)}
        >
          <a>{p.status === 'on' ? '下架' : '申请上架'}</a>
        </Popconfirm>
      )}
      <Popconfirm title="删除后不可恢复，确认删除？" onConfirm={() => onDelete(p)}>
        <a style={{ color: '#ff4d4f' }}>删除</a>
      </Popconfirm>
    </>
  )

  return (
    <div className="vp-page">
      <style>{CSS}</style>
      <div className="vp-header">
        <div className="vp-header-left">
          <img src={logoWhite} alt="logo" />
          <span className="vp-title">星选供应商门户</span>
        </div>
        <div className="vp-header-right">
          <a className="vp-shelf-link" href="/" target="_blank" rel="noreferrer">
            <ShopOutlined /> 查看对外货架
          </a>
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
      </div>

      <div className="vp-content">
        <div className="vp-hello">
          <div className="hi">
            {vendorName}，欢迎回来
            {isVerified && (
              <Tag color="green" style={{ marginInlineEnd: 0 }}>
                <CheckCircleFilled /> 已验厂工厂
              </Tag>
            )}
          </div>
          {lastLoginAt && <div className="sub">上次登录：{lastLoginAt}</div>}
        </div>

        <div className="vp-stats">
          {STATS.map((s) => (
            <div
              key={s.key}
              className={'vp-stat' + (status === s.key ? ' active' : '')}
              onClick={() => switchStatus(s.key)}
            >
              <div className="n" style={{ color: s.color }}>
                {counts[s.key === 'all' ? 'all' : s.key] ?? 0}
              </div>
              <div className="t">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="vp-rules">
          <span>
            <b>审核上架</b>：商品提交后经平台审核，通过即展示到对外货架
          </span>
          <span>
            <b>价格保密</b>：供货底价只有平台可见，不会展示给终端客户
          </span>
          <span>
            <b>排名规则</b>：更新及时、现货充足的商品排名靠前、优先派单；大幅改价自动转审核
          </span>
        </div>

        <div className="vp-panel">
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
            onChange={switchStatus}
            size="small"
            tabBarStyle={{ marginBottom: 8 }}
          />

          <Spin spinning={loading}>
            {items.length === 0 && !loading ? (
              <Empty
                description="还没有商品，点击「新增商品」或「拍照识别」快速上传"
                style={{ padding: '48px 0' }}
              />
            ) : isWide ? (
              <Table<VendorProduct>
                rowKey="id"
                dataSource={items}
                pagination={false}
                size="middle"
                columns={[
                  {
                    title: '图片',
                    width: 64,
                    render: (_, p) => (
                      <div className="vp-thumb" style={{ width: 48, height: 48 }}>
                        {p.images?.[0] ? (
                          <img src={p.images[0]} alt={p.name} />
                        ) : (
                          <div className="vp-noimg">无图</div>
                        )}
                      </div>
                    ),
                  },
                  {
                    title: '商品',
                    render: (_, p) => (
                      <>
                        <div className="vp-tbl-name">{p.name}</div>
                        <div className="vp-tbl-sub">
                          {[p.brand, p.spec, p.model].filter(Boolean).join(' · ') || '-'}
                        </div>
                      </>
                    ),
                  },
                  {
                    title: '供货底价',
                    width: 150,
                    render: (_, p) => (
                      <span style={{ color: '#d4380d' }}>
                        {formatPrice(p.base_price, p.currency)}
                        {p.unit ? ` / ${p.unit}` : ''}
                      </span>
                    ),
                  },
                  {
                    title: '货期',
                    width: 110,
                    render: (_, p) =>
                      p.stock_status === 'in_stock' ? (
                        <Tag color="green">现货</Tag>
                      ) : (
                        <Tag color="orange">订货{p.lead_time ? ` ${p.lead_time}` : ''}</Tag>
                      ),
                  },
                  {
                    title: '状态',
                    width: 130,
                    render: (_, p) => (
                      <>
                        <Tag color={STATUS_META[p.status]?.color}>
                          {STATUS_META[p.status]?.label || p.status}
                        </Tag>
                        {p.status === 'rejected' && p.reject_reason && (
                          <div className="vp-reject">{p.reject_reason}</div>
                        )}
                      </>
                    ),
                  },
                  {
                    title: '价格更新',
                    width: 120,
                    render: (_, p) => (
                      <span className="vp-tbl-sub">{(p.price_updated_at || '').slice(0, 10) || '-'}</span>
                    ),
                  },
                  {
                    title: '操作',
                    width: 170,
                    render: (_, p) => (
                      <span style={{ display: 'inline-flex', gap: 12 }}>{renderOps(p)}</span>
                    ),
                  },
                ]}
              />
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
                    {p.stock_status === 'in_stock' ? (
                      <Tag color="green">现货</Tag>
                    ) : (
                      <Tag color="orange">订货{p.lead_time ? ` ${p.lead_time}` : ''}</Tag>
                    )}
                    {p.status === 'rejected' && p.reject_reason && (
                      <div className="vp-reject">驳回原因：{p.reject_reason}</div>
                    )}
                    {p.price_updated_at && (
                      <div className="vp-meta">价格更新：{p.price_updated_at.slice(0, 10)}</div>
                    )}
                  </div>
                  <div className="vp-ops">{renderOps(p)}</div>
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
