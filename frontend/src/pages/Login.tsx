import { LoginForm, ProFormText } from '@ant-design/pro-components'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function LoginPage() {
  const nav = useNavigate()
  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <div style={{ width: 400, padding: 32, background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,.08)' }}>
        <LoginForm
          title="星选建材"
          subTitle="客户 · 询价 · 报价管理"
          onFinish={async (v) => {
            try {
              const { data } = await api.post('/auth/login', v)
              localStorage.setItem('token', data.access_token)
              localStorage.setItem('name', data.name)
              localStorage.setItem('role', data.role)
              message.success('登录成功')
              nav('/dashboard')
              return true
            } catch {
              return false
            }
          }}
        >
          <ProFormText
            name="username"
            fieldProps={{ size: 'large', prefix: <UserOutlined /> }}
            placeholder="账号"
            rules={[{ required: true }]}
          />
          <ProFormText.Password
            name="password"
            fieldProps={{ size: 'large', prefix: <LockOutlined /> }}
            placeholder="密码"
            rules={[{ required: true }]}
          />
        </LoginForm>
      </div>
    </div>
  )
}
