import { useEffect, useState } from 'react'
import { Form, Input, Button, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

const CONSTELLATION_BG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800'>
    <g fill='rgba(255,255,255,0.35)'>
      ${Array.from({ length: 70 })
        .map(() => {
          const x = Math.floor(Math.random() * 800)
          const y = Math.floor(Math.random() * 800)
          const r = (Math.random() * 1.6 + 0.4).toFixed(1)
          return `<circle cx='${x}' cy='${y}' r='${r}'/>`
        })
        .join('')}
    </g>
    <g stroke='rgba(255,255,255,0.12)' stroke-width='0.6' fill='none'>
      ${Array.from({ length: 50 })
        .map(() => {
          const x1 = Math.floor(Math.random() * 800)
          const y1 = Math.floor(Math.random() * 800)
          const x2 = x1 + Math.floor(Math.random() * 200 - 100)
          const y2 = y1 + Math.floor(Math.random() * 200 - 100)
          return `<line x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}'/>`
        })
        .join('')}
    </g>
  </svg>`)

export default function LoginPage() {
  const nav = useNavigate()
  const [companyName, setCompanyName] = useState('星选建材')
  const [logoUrl, setLogoUrl] = useState<string>('')
  const [logoOk, setLogoOk] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

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

  const onFinish = async (v: any) => {
    setSubmitting(true)
    try {
      const data = await api.post('login', v)
      localStorage.setItem('token', data.access_token)
      localStorage.setItem('name', data.name)
      localStorage.setItem('role', data.role)
      localStorage.setItem('user_id', String(data.user_id ?? ''))
      message.success('登录成功')
      nav('/calendar')
    } catch {
      // api 拦截器已 toast
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-left">
        <div
          className="login-left-bg"
          style={{ backgroundImage: `url("${CONSTELLATION_BG}")` }}
        />
        <div className="login-left-content">
          <div className="brand-logo">
            {logoOk ? (
              <img src={logoUrl} alt="logo" />
            ) : (
              <div className="brand-logo-fallback">
                {companyName.slice(0, 1)}
              </div>
            )}
          </div>
          <h1 className="brand-title">{companyName}智能管理系统</h1>
          <div className="brand-subtitle">
            Customer · Inquiry · Quotation Management
          </div>
          <div className="brand-divider" />
          <div className="brand-stats">
            <div>
              <div className="num">1000+</div>
              <div className="label">服务客户</div>
            </div>
            <div>
              <div className="num">50+</div>
              <div className="label">合作供应商</div>
            </div>
            <div>
              <div className="num">5+</div>
              <div className="label">年行业经验</div>
            </div>
          </div>
        </div>
      </div>

      <div className="login-right">
        <div className="login-form-wrap">
          <div className="form-brand">
            {logoOk && <img src={logoUrl} alt="" />}
            <span>{companyName}</span>
          </div>
          <h2 className="welcome">欢迎回来</h2>
          <div className="welcome-sub">请登录您的账户以继续</div>

          <Form
            form={form}
            layout="vertical"
            size="large"
            onFinish={onFinish}
            requiredMark={false}
            style={{ marginTop: 32 }}
          >
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
                placeholder="请输入用户名"
                autoComplete="username"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </Form.Item>
            <Form.Item style={{ marginTop: 28 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
                block
                style={{ height: 48, fontSize: 16, letterSpacing: 4 }}
              >
                登 录
              </Button>
            </Form.Item>
          </Form>
        </div>
        <div className="login-footer">
          © {new Date().getFullYear()} {companyName}
        </div>
      </div>
    </div>
  )
}
