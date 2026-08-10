import { useEffect, useRef, useState } from 'react'
import { Form, Input, Button, message } from 'antd'
import { UserOutlined, LockOutlined, DoubleRightOutlined, CheckOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { isLoopbackApiTarget } from '../utils/devEnv'
import logoWhite from '../assets/logo-white.png'

// 建材生态动画：中心枢纽 + 旋转轨道 + 漂浮建材要素
const ECO_CHIPS = [
  { icon: '🧱', label: '瓷砖', style: { top: '6%', left: '30%' }, delay: '0s' },
  { icon: '🪵', label: '板材', style: { top: '18%', right: '4%' }, delay: '0.6s' },
  { icon: '💡', label: '灯具', style: { bottom: '16%', right: '8%' }, delay: '1.2s' },
  { icon: '🚿', label: '卫浴', style: { bottom: '4%', left: '34%' }, delay: '1.8s' },
  { icon: '🎨', label: '涂料', style: { bottom: '24%', left: '2%' }, delay: '2.4s' },
  { icon: '🪟', label: '门窗', style: { top: '22%', left: '6%' }, delay: '3s' },
]

const HANDLE_W = 40

// GNAME 式滑块验证：拖到最右才算通过（配合后端登录限流使用）
function SliderVerify({ onOk }: { onOk: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [ok, setOk] = useState(false)

  const onDown = (e: React.PointerEvent) => {
    if (ok) return
    e.preventDefault()
    const rect = trackRef.current!.getBoundingClientRect()
    const max = rect.width - HANDLE_W
    setDragging(true)
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(false)
    }
    const move = (ev: PointerEvent) => {
      const nx = Math.max(0, Math.min(max, ev.clientX - rect.left - HANDLE_W / 2))
      setX(nx)
      if (nx >= max - 2) {
        cleanup()
        setX(max)
        setOk(true)
        onOk()
      }
    }
    const up = () => {
      cleanup()
      setX(0) // 没拖到头，弹回
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className={'lg2-slider' + (ok ? ' ok' : '')} ref={trackRef}>
      <div className="fill" style={{ width: x + HANDLE_W / 2 }} />
      <span className="tip">{ok ? '验证通过' : '按住滑块拖动到最右'}</span>
      <div
        className="handle"
        style={{ left: x, transition: dragging ? 'none' : 'left 0.3s' }}
        onPointerDown={onDown}
      >
        {ok ? <CheckOutlined /> : <DoubleRightOutlined />}
      </div>
    </div>
  )
}

export default function LoginPage() {
  const nav = useNavigate()
  const [companyName, setCompanyName] = useState('星选建材')
  const [submitting, setSubmitting] = useState(false)
  // 本地开发环境（dev 构建 + API 代理指向环回地址）跳过滑块，判据见 utils/devEnv.ts。
  // 🔴 import.meta.env.DEV 必须写在这里而不是包进函数里：Vite 把它静态替换成 false，
  // `false && ...` 折叠后整个跳过分支会被 DCE 从生产包里删掉（实测验证，见 21 号单）。
  const localDev = import.meta.env.DEV && isLoopbackApiTarget(__API_TARGET__)
  const sliderOkRef = useRef(localDev)
  const [sliderKey, setSliderKey] = useState(0)
  const [form] = Form.useForm()

  useEffect(() => {
    // 用公开的 shelfMeta 取公司名：listSettings 需要登录，未登录时 401 白打一发
    api
      .get('shelfMeta')
      .then((r) => {
        if (r.company_name) setCompanyName(r.company_name)
      })
      .catch(() => {})
  }, [])

  const onFinish = async (v: any) => {
    if (!sliderOkRef.current) {
      message.warning('请先按住滑块完成验证')
      return
    }
    setSubmitting(true)
    try {
      const data = await api.post('login', v)
      localStorage.setItem('token', data.access_token)
      localStorage.setItem('name', data.name)
      localStorage.setItem('role', data.role)
      localStorage.setItem('user_id', String(data.user_id ?? ''))
      message.success('登录成功')
      nav('/admin/dashboard')
    } catch {
      // api 拦截器已 toast；失败重置滑块。
      // 本地开发跳过滑块时不重置，否则第一次登录失败后就再也提交不了了（没有滑块可拖）。
      if (!localDev) {
        sliderOkRef.current = false
        setSliderKey((k) => k + 1)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="lg2-page">
      {/* 深色顶栏 */}
      <div className="lg2-topbar">
        <div className="lg2-brand">
          <img src={logoWhite} alt="logo" />
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
                <img className="hub-logo" src={logoWhite} alt="logo" />
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
              {import.meta.env.DEV && localDev ? (
                <div className="lg2-devbanner">
                  本地开发环境 · 已跳过人机验证
                  <span>后端 {__API_TARGET__}</span>
                </div>
              ) : (
                <SliderVerify
                  key={sliderKey}
                  onOk={() => {
                    sliderOkRef.current = true
                    form.submit() // 验证通过直接尝试登录（未填账号密码会提示必填）
                  }}
                />
              )}
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
