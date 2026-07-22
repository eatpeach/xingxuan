import { useEffect, useState } from 'react'
import { Form, Input, Button, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

// 建材生态动画：中心枢纽 + 旋转轨道 + 漂浮建材要素
const ECO_CHIPS = [
  { icon: '🧱', label: '瓷砖', style: { top: '6%', left: '30%' }, delay: '0s' },
  { icon: '🪵', label: '板材', style: { top: '18%', right: '4%' }, delay: '0.6s' },
  { icon: '💡', label: '灯具', style: { bottom: '16%', right: '8%' }, delay: '1.2s' },
  { icon: '🚿', label: '卫浴', style: { bottom: '4%', left: '34%' }, delay: '1.8s' },
  { icon: '🎨', label: '涂料', style: { bottom: '24%', left: '2%' }, delay: '2.4s' },
  { icon: '🪟', label: '门窗', style: { top: '22%', left: '6%' }, delay: '3s' },
]

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
      nav('/dashboard')
    } catch {
      // api 拦截器已 toast
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="lg2-page">
      {/* 深色顶栏 */}
      <div className="lg2-topbar">
        <div className="lg2-brand">
          {logoOk ? (
            <img src={logoUrl} alt="logo" />
          ) : (
            <span className="lg2-brand-fallback">{companyName.slice(0, 1)}</span>
          )}
          <span className="lg2-brand-name">{companyName}</span>
        </div>
      </div>

      {/* 居中卡片 */}
      <div className="lg2-body">
        <div className="lg2-card">
          {/* 左：建材生态动画 */}
          <div className="lg2-left">
            <div className="eco-scene">
              <div className="eco-ring r1" />
              <div className="eco-ring r2" />
              <div className="eco-orbit o1">
                <span className="eco-dot" />
              </div>
              <div className="eco-orbit o2">
                <span className="eco-dot blue" />
              </div>
              <div className="eco-pulse" />
              <div className="eco-hub">
                <span className="hub-icon">🏗️</span>
                <span className="hub-text">{companyName}</span>
              </div>
              {ECO_CHIPS.map((c) => (
                <span
                  key={c.label}
                  className="eco-chip"
                  style={{ ...c.style, animationDelay: c.delay } as any}
                >
                  <span className="ico">{c.icon}</span>
                  {c.label}
                </span>
              ))}
            </div>
            <div className="lg2-left-caption">
              <div className="t">建材生态 · 一站式管理</div>
              <div className="s">客户询价 → 多供比价 → 报价成交 → 订单履约</div>
            </div>
          </div>

          {/* 右：密码登录 */}
          <div className="lg2-right">
            <div className="lg2-tabs">
              <span className="active">密码登录</span>
            </div>
            <div className="lg2-welcome">欢迎来到{companyName}，请登录！</div>
            <Form form={form} layout="vertical" size="large" onFinish={onFinish} requiredMark={false}>
              <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input
                  prefix={<UserOutlined style={{ color: '#9aa4b5' }} />}
                  placeholder="请输入用户名"
                  autoComplete="username"
                />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password
                  prefix={<LockOutlined style={{ color: '#9aa4b5' }} />}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
              </Form.Item>
              <Form.Item style={{ marginTop: 8, marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" loading={submitting} block className="lg2-submit">
                  立即登录
                </Button>
              </Form.Item>
            </Form>
          </div>
        </div>
        <div className="lg2-footer">
          © {new Date().getFullYear()} {companyName} 版权所有，保留所有权利
        </div>
      </div>
    </div>
  )
}
