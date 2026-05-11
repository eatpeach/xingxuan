import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { ProLayout } from '@ant-design/pro-components'
import {
  DashboardOutlined,
  TeamOutlined,
  ShopOutlined,
  FileSearchOutlined,
  FileDoneOutlined,
  SettingOutlined,
  LogoutOutlined,
  CalendarOutlined,
} from '@ant-design/icons'
import { Dropdown, Form, Input, Modal, message } from 'antd'
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

function RequireAuth({ children }: { children: JSX.Element }) {
  const t = localStorage.getItem('token')
  if (!t) return <Navigate to="/login" replace />
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
          window.location.href = '/login'
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

function AdminLayout() {
  const nav = useNavigate()
  const name = localStorage.getItem('name') || 'admin'
  const [pwdOpen, setPwdOpen] = useState(false)
  const [companyName, setCompanyName] = useState('星选建材')
  const [logoUrl, setLogoUrl] = useState<string | false>(false)

  useEffect(() => {
    api.get('listSettings').then((r) => {
      const sm: Record<string, string> = Object.fromEntries(
        (r.items || []).map((s: any) => [s.key, s.value]),
      )
      if (sm.company_name) setCompanyName(sm.company_name)
      if (sm.pdf_logo_path) {
        const url = '/storage/' + sm.pdf_logo_path.replace(/^\/+/, '')
        const img = new Image()
        img.onload = () => setLogoUrl(url)
        img.onerror = () => setLogoUrl(false)
        img.src = url
      }
    }).catch(() => {})
  }, [])

  return (
    <>
    <ProLayout
      title={companyName}
      logo={logoUrl}
      layout="mix"
      fixedHeader
      fixSiderbar
      route={{
        path: '/',
        routes: [
          { path: '/dashboard', name: '工作台', icon: <DashboardOutlined /> },
          { path: '/customers', name: '客户管理', icon: <TeamOutlined /> },
          { path: '/suppliers', name: '供应商管理', icon: <ShopOutlined /> },
          { path: '/inquiries', name: '询价管理', icon: <FileSearchOutlined /> },
          { path: '/quotes', name: '客户报价', icon: <FileDoneOutlined /> },
          { path: '/calendar', name: '日历 · 日记', icon: <CalendarOutlined /> },
          { path: '/settings', name: '系统设置', icon: <SettingOutlined /> },
        ],
      }}
      menuItemRender={(item, dom) => (
        <a onClick={() => nav(item.path!)}>{dom}</a>
      )}
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
                    nav('/login')
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
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/inquiries" element={<InquiriesPage />} />
        <Route path="/inquiries/:id/compare" element={<InquiryComparePage />} />
        <Route path="/quotes" element={<QuotesPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </ProLayout>
    <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 公开路由（无需登录） */}
        <Route path="/p/quote/:token" element={<PublicQuotePage />} />
        <Route path="/p/inquiry" element={<PublicInquiryPage />} />
        <Route path="/quotes/:id/print" element={<QuotePrintPage />} />

        {/* 管理后台 */}
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <AdminLayout />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
