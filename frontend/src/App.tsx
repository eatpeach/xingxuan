import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { ProLayout } from '@ant-design/pro-components'
import {
  DashboardOutlined,
  TeamOutlined,
  ShopOutlined,
  ShareAltOutlined,
  FileSearchOutlined,
  SettingOutlined,
  LogoutOutlined,
  VideoCameraOutlined,
  AppstoreOutlined,
} from '@ant-design/icons'
import { ConfigProvider, Dropdown, Form, Input, Modal, message } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useEffect, useState } from 'react'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { api } from './api'
import LoginPage from './pages/Login'
import CustomersPage from './pages/Customers'
import SuppliersPage from './pages/Suppliers'
import InquiriesPage from './pages/Inquiries'
import InquiryComparePage from './pages/InquiryCompare'
import QuotesPage from './pages/Quotes'
import QuotePrintPage from './pages/QuotePrint'
import SettingsPage from './pages/Settings'
import DashboardPage from './pages/Dashboard'
import PublicQuotePage from './pages/PublicQuote'
import PublicInquiryPage from './pages/PublicInquiry'
import CalendarPage from './pages/Calendar'
import InvoicePrintPage from './pages/InvoicePrint'
import OrdersPage from './pages/Orders'
import ShortVideoPage from './pages/ShortVideo'
import ChannelsPage from './pages/Channels'
import ProductsPage from './pages/Products'
import VendorLoginPage from './pages/VendorLogin'
import VendorPortalPage from './pages/VendorPortal'
import ShelfHomePage from './pages/shelf/ShelfHome'
import ShelfProductPage from './pages/shelf/ShelfProduct'
import ShelfCategoryPage from './pages/shelf/ShelfCategory'
import WorkPlanButton from './components/WorkPlanButton'
import logoWhite from './assets/logo-white.png'
import { MODULES } from './roles'
import { applyThemeColor, darkChrome, getThemeColor, onThemeChange } from './theme'

function RequireAuth({ children }: { children: JSX.Element }) {
  const t = localStorage.getItem('token')
  if (!t) return <Navigate to="/admin/login" replace />
  return children
}

function RequireVendor({ children }: { children: JSX.Element }) {
  const t = localStorage.getItem('vendor_token')
  if (!t) return <Navigate to="/vendor/login" replace />
  return children
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  return (
    <Modal
      open={open}
      title="修改密码"
      onCancel={onClose}
      onOk={async () => {
        try {
          const v = await form.validateFields()
          if (v.new_password !== v.confirm) {
            message.error('两次输入的新密码不一致')
            return
          }
          setSubmitting(true)
          await api.post('changePassword', { old_password: v.old_password, new_password: v.new_password })
          message.success('已修改，请重新登录')
          localStorage.clear()
          window.location.href = '/admin/login'
        } catch (e: any) {
          if (e?.errorFields) return
        } finally {
          setSubmitting(false)
        }
      }}
      confirmLoading={submitting}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="old_password" label="当前密码" rules={[{ required: true }]}>
          <Input.Password prefix={<LockOutlined />} />
        </Form.Item>
        <Form.Item name="new_password" label="新密码（至少 6 位）" rules={[{ required: true, min: 6 }]}>
          <Input.Password prefix={<LockOutlined />} />
        </Form.Item>
        <Form.Item name="confirm" label="确认新密码" rules={[{ required: true }]}>
          <Input.Password prefix={<LockOutlined />} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function AdminLayout({ themeColor }: { themeColor: string }) {
  const chrome = darkChrome(themeColor)
  const nav = useNavigate()
  const name = localStorage.getItem('name') || 'admin'
  const [pwdOpen, setPwdOpen] = useState(false)
  const [companyName, setCompanyName] = useState('星选建材')
  const [perms, setPerms] = useState<Record<string, string[]> | null>(null)
  const role = localStorage.getItem('role') || ''

  useEffect(() => {
    api.get('listSettings').then((r) => {
      const sm: Record<string, string> = Object.fromEntries(
        (r.items || []).map((s: any) => [s.key, s.value]),
      )
      if (sm.company_name) setCompanyName(sm.company_name)
      // 远端主题色同步（其他人改过之后，本机刷新生效）
      if (sm.theme_color && sm.theme_color !== getThemeColor()) applyThemeColor(sm.theme_color)
    }).catch(() => {})
    api.get('getRolePermissions')
      .then((r) => setPerms(r.permissions || {}))
      .catch(() => setPerms({}))
  }, [])

  // 权限矩阵过滤菜单：admin 全量；角色未配置过默认全量
  // 菜单路径带 /admin 前缀，MODULES 存的是不带前缀的模块路径
  const pathAllowed = (path: string) => {
    if (role === 'admin' || !perms) return true
    const modKey = MODULES.find((m) => m.path === path.replace(/^\/admin/, ''))?.key
    const list = perms[role]
    if (!modKey || !Array.isArray(list)) return true
    return list.includes(modKey)
  }

  return (
    <>
    <ProLayout
      title={companyName}
      logo={logoWhite}
      layout="mix"
      fixedHeader
      fixSiderbar
      siderWidth={200}
      token={{
        bgLayout: '#f0f2f5',
        header: {
          colorBgHeader: chrome,
          colorHeaderTitle: '#ffffff',
          colorTextMenu: 'rgba(255,255,255,0.72)',
          colorTextMenuActive: '#ffffff',
          colorTextMenuSelected: '#ffffff',
          colorBgMenuItemHover: 'rgba(255,255,255,0.08)',
          colorTextRightActionsItem: 'rgba(255,255,255,0.85)',
          colorBgRightActionsItemHover: 'rgba(255,255,255,0.08)',
        },
        sider: {
          colorMenuBackground: chrome,
          colorTextMenu: 'rgba(255,255,255,0.68)',
          colorTextMenuActive: '#ffffff',
          colorTextMenuItemHover: '#ffffff',
          colorTextMenuSelected: '#ffffff',
          colorBgMenuItemSelected: themeColor,
          colorBgMenuItemHover: 'rgba(255,255,255,0.06)',
          colorTextMenuSecondary: 'rgba(255,255,255,0.45)',
          colorMenuItemDivider: 'rgba(255,255,255,0.08)',
        },
        pageContainer: {
          colorBgPageContainer: '#f0f2f5',
        },
      }}
      route={{
        path: '/admin',
        routes: [
          { path: '/admin/dashboard', name: '工作台', icon: <DashboardOutlined /> },
          { path: '/admin/customers', name: '客户管理', icon: <TeamOutlined /> },
          { path: '/admin/inquiries', name: '商机管理', icon: <FileSearchOutlined /> },
          { path: '/admin/suppliers', name: '供应商管理', icon: <ShopOutlined /> },
          { path: '/admin/products', name: '商品库', icon: <AppstoreOutlined /> },
          { path: '/admin/channels', name: '渠道管理', icon: <ShareAltOutlined /> },
          // 客户报价 / 订单履约已并入「商机管理」的步骤流程，不再单独占菜单；
          // 路由保留，供工作台 KPI 卡片钻取跨商机全局列表
          { path: '/admin/short-video', name: '短视频矩阵', icon: <VideoCameraOutlined /> },
          { path: '/admin/settings', name: '系统设置', icon: <SettingOutlined /> },
        ].filter((r) => pathAllowed(r.path)),
      }}
      menuItemRender={(item, dom) => (
        <a onClick={() => nav(item.path!)}>{dom}</a>
      )}
      actionsRender={() => [<WorkPlanButton key="workplan" />]}
      avatarProps={{
        size: 'small',
        title: name,
        render: (_, dom) => (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'pwd',
                  icon: <UserOutlined />,
                  label: '修改密码',
                  onClick: () => setPwdOpen(true),
                },
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: () => {
                    localStorage.clear()
                    nav('/admin/login')
                  },
                },
              ],
            }}
          >
            {dom}
          </Dropdown>
        ),
      }}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="channels" element={<ChannelsPage />} />
        <Route path="inquiries" element={<InquiriesPage />} />
        <Route path="inquiries/:id/compare" element={<InquiryComparePage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="short-video" element={<ShortVideoPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Routes>
    </ProLayout>
    <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </>
  )
}

export default function App() {
  const [themeColor, setThemeColor] = useState(getThemeColor())
  useEffect(() => onThemeChange(setThemeColor), [])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: themeColor,
          colorLink: themeColor,
          colorInfo: themeColor,
          borderRadius: 4,
        },
      }}
    >
    <BrowserRouter>
      <Routes>
        {/* 电子货架（公开，PC/H5 自适应） */}
        <Route path="/" element={<ShelfHomePage />} />
        <Route path="/c/:name" element={<ShelfCategoryPage />} />
        <Route path="/item/:id" element={<ShelfProductPage />} />

        {/* 公开路由（无需登录） */}
        <Route path="/p/quote/:token" element={<PublicQuotePage />} />
        <Route path="/p/inquiry" element={<PublicInquiryPage />} />
        <Route path="/quotes/:id/print" element={<QuotePrintPage />} />
        <Route path="/quotes/:id/invoice" element={<InvoicePrintPage />} />

        {/* 供应商门户 */}
        <Route path="/vendor/login" element={<VendorLoginPage />} />
        <Route
          path="/vendor/*"
          element={
            <RequireVendor>
              <VendorPortalPage />
            </RequireVendor>
          }
        />

        {/* 管理后台 */}
        <Route path="/login" element={<Navigate to="/admin/login" replace />} />
        <Route path="/admin/login" element={<LoginPage />} />
        <Route
          path="/admin/*"
          element={
            <RequireAuth>
              <AdminLayout themeColor={themeColor} />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ConfigProvider>
  )
}
