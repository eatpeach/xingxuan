import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { ProLayout } from '@ant-design/pro-components'
import {
  DashboardOutlined,
  TeamOutlined,
  ShopOutlined,
  FileSearchOutlined,
  FileDoneOutlined,
  SettingOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import { Dropdown } from 'antd'
import LoginPage from './pages/Login'
import CustomersPage from './pages/Customers'
import SuppliersPage from './pages/Suppliers'
import InquiriesPage from './pages/Inquiries'
import InquiryComparePage from './pages/InquiryCompare'
import QuotesPage from './pages/Quotes'
import SettingsPage from './pages/Settings'
import DashboardPage from './pages/Dashboard'

function RequireAuth({ children }: { children: JSX.Element }) {
  const t = localStorage.getItem('token')
  if (!t) return <Navigate to="/login" replace />
  return children
}

function Layout() {
  const nav = useNavigate()
  const name = localStorage.getItem('name') || 'admin'
  return (
    <ProLayout
      title="星选建材"
      logo={false}
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
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </ProLayout>
  )
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        />
      </Routes>
    </HashRouter>
  )
}
