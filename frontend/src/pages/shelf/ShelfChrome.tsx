import { Link, useNavigate } from 'react-router-dom'
import { Button, Input, Popover, Space } from 'antd'
import { PhoneOutlined, SearchOutlined } from '@ant-design/icons'
import { useState } from 'react'
import type { ShelfMeta } from './InquiryModal'

/** 头部小二维码（悬停放大），图片 404 自动隐藏 */
function HeaderQr({ src, label }: { src: string; label: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return null
  return (
    <Popover
      content={
        <div style={{ textAlign: 'center' }}>
          <img src={src} alt={label} style={{ width: 160, height: 160, display: 'block' }} />
          <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>扫码关注 {label}</div>
        </div>
      }
    >
      <div className="sh-qr">
        <img src={src} alt={label} onError={() => setBroken(true)} />
        <span>{label}</span>
      </div>
    </Popover>
  )
}

/** 顶部 utility bar + 白底 header（搜索跳分类页） + 导航条，三个货架页共用 */
export function ShelfTop({
  meta,
  active,
  defaultKeyword = '',
}: {
  meta: ShelfMeta | null
  active: 'home' | 'category' | 'detail'
  defaultKeyword?: string
}) {
  const nav = useNavigate()
  const [kw, setKw] = useState(defaultKeyword)
  const companyName = meta?.company_name || '星选建材'

  const doSearch = () => {
    const v = kw.trim()
    nav(v ? `/c/all?kw=${encodeURIComponent(v)}` : '/c/all')
  }

  return (
    <>
      <div className="sh-utility">
        <div className="sh-wrap sh-utility-inner">
          <span>印尼中国建材集采平台 · 本地现货</span>
          <Link to="/vendor/login">供应商入口</Link>
        </div>
      </div>
      <div className="sh-header">
        <div className="sh-wrap sh-header-inner">
          <div className="sh-brand" onClick={() => nav('/')}>
            {meta?.logo_url ? <img src={meta.logo_url} alt="" /> : null}
            <span className="sh-brand-name">{companyName}</span>
          </div>
          <div className="sh-search">
            <Space.Compact style={{ width: '100%' }}>
              <Input
                size="large"
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                onPressEnter={doSearch}
                placeholder="搜索建材商品，如 瓷砖 / 水泥 / 灯具"
                allowClear
              />
              <Button size="large" type="primary" icon={<SearchOutlined />} onClick={doSearch}>
                搜索
              </Button>
            </Space.Compact>
          </div>
          <div className="sh-qrs">
            <HeaderQr src={meta?.qr_douyin_url || ''} label="抖音" />
            <HeaderQr src={meta?.qr_channels_url || ''} label="视频号" />
          </div>
          {meta?.contact_phone ? (
            <div className="sh-phone">
              <PhoneOutlined /> {meta.contact_phone}
            </div>
          ) : null}
        </div>
      </div>
      <div className="sh-nav">
        <div className="sh-wrap sh-nav-inner">
          <Link className={active === 'home' ? 'active' : ''} to="/">
            首页
          </Link>
          <Link className={active === 'category' ? 'active' : ''} to="/c/all">
            全部商品
          </Link>
          <Link to="/p/inquiry">提交采购需求</Link>
          <Link to="/vendor/login">供应商合作</Link>
        </div>
      </div>
    </>
  )
}

export function ShelfFooter({ meta }: { meta: ShelfMeta | null }) {
  const companyName = meta?.company_name || '星选建材'
  return (
    <div className="sh-footer">
      <div className="sh-wrap sh-footer-inner">
        <div>{companyName}</div>
        <div>
          {meta?.contact_wechat ? `微信：${meta.contact_wechat}` : ''}
          {meta?.contact_wechat && meta?.contact_phone ? ' · ' : ''}
          {meta?.contact_phone ? `电话：${meta.contact_phone}` : ''}
        </div>
        <div>
          © {new Date().getFullYear()} {companyName}
        </div>
      </div>
    </div>
  )
}
