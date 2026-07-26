import { useEffect, useState } from 'react'
import { Button, Form, Input, message } from 'antd'
import { LockOutlined, ShopOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

// 供应商门户登录页：手机优先的居中卡片，无滑块（后端已有 15 分钟 5 次限流）
export default function VendorLoginPage() {
  const nav = useNavigate()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (localStorage.getItem('vendor_token')) nav('/vendor', { replace: true })
  }, [nav])

  const onFinish = async (v: { username: string; password: string }) => {
    setSubmitting(true)
    try {
      const data = await api.post('vendorLogin', v)
      localStorage.setItem('vendor_token', data.access_token)
      localStorage.setItem('vendor_name', data.name || '')
      localStorage.setItem('vendor_code', data.code || '')
      message.success('登录成功')
      nav('/vendor')
    } catch {
      // 401 由 api 拦截器 toast + 清 token（本页即跳转目标，属预期）
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f5f6f8',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '10vh 16px 24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: '#fff',
          borderRadius: 10,
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          padding: '32px 28px 24px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 52,
              height: 52,
              margin: '0 auto 12px',
              borderRadius: 12,
              background: 'var(--brand, #1d57e0)',
              color: '#fff',
              fontSize: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShopOutlined />
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, color: '#1a1a2e' }}>供应商门户</div>
          <div style={{ fontSize: 13, color: '#8a94a6', marginTop: 4 }}>星选建材 · 供货合作平台</div>
        </div>
        <Form size="large" onFinish={onFinish} requiredMark={false}>
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
          <Form.Item style={{ marginBottom: 8 }}>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              登 录
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center', fontSize: 12, color: '#a0a8b8', marginTop: 8 }}>
          账号由星选平台开通，如需合作请联系平台
        </div>
      </div>
      <div style={{ marginTop: 24, fontSize: 12, color: '#b5bcc9' }}>
        © {new Date().getFullYear()} 星选建材
      </div>
    </div>
  )
}
