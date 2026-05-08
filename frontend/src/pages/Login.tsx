import { useEffect, useState } from 'react'
import { LoginForm, ProFormText } from '@ant-design/pro-components'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function LoginPage() {
  const nav = useNavigate()
  const [companyName, setCompanyName] = useState('星选建材')
  const [logoUrl, setLogoUrl] = useState<string>('')
  const [logoOk, setLogoOk] = useState(false)

  useEffect(() => {
    api
      .get('listSettings')
      .then((r) => {
        const sm: Record<string, string> = Object.fromEntries(
          (r.items || []).map((s: any) => [s.key, s.value]),
        )
        if (sm.company_name) setCompanyName(sm.company_name)
        if (sm.pdf_logo_path) {
          const url = '/storage/' + sm.pdf_logo_path.replace(/^\/+/, '')
          setLogoUrl(url)
          const img = new Image()
          img.onload = () => setLogoOk(true)
          img.onerror = () => setLogoOk(false)
          img.src = url
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'linear-gradient(135deg, #1677ff 0%, #4096ff 50%, #69b1ff 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.18) 0, transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.12) 0, transparent 45%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          width: 420,
          padding: '40px 36px 32px',
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0, 32, 96, 0.18)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {logoOk && (
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <img
              src={logoUrl}
              alt="logo"
              style={{
                height: 56,
                maxWidth: 180,
                objectFit: 'contain',
                marginBottom: 12,
              }}
            />
          </div>
        )}
        <LoginForm
          title={companyName}
          subTitle="客户 · 询价 · 报价管理"
          onFinish={async (v) => {
            try {
              const data = await api.post('login', v)
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
          submitter={{
            searchConfig: { submitText: '登 录' },
            submitButtonProps: { size: 'large', style: { width: '100%' } },
          }}
        >
          <ProFormText
            name="username"
            fieldProps={{ size: 'large', prefix: <UserOutlined /> }}
            placeholder="账号"
            rules={[{ required: true, message: '请输入账号' }]}
          />
          <ProFormText.Password
            name="password"
            fieldProps={{ size: 'large', prefix: <LockOutlined /> }}
            placeholder="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          />
        </LoginForm>
        <div
          style={{
            textAlign: 'center',
            marginTop: 16,
            fontSize: 12,
            color: '#999',
          }}
        >
          © {new Date().getFullYear()} {companyName}
        </div>
      </div>
    </div>
  )
}
