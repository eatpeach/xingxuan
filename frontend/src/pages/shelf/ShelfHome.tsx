import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Empty, Spin } from 'antd'
import {
  AppstoreOutlined,
  CustomerServiceOutlined,
  FormOutlined,
  PhoneOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  TagOutlined,
  ThunderboltOutlined,
  WechatOutlined,
} from '@ant-design/icons'
import { api } from '../../api'
import InquiryModal from './InquiryModal'
import type { ShelfItem, ShelfMeta } from './InquiryModal'
import ProductCard from './ProductCard'
import { ShelfFooter, ShelfTop } from './ShelfChrome'
import './shelf.css'

const TRUST = [
  { icon: <SafetyCertificateOutlined />, t: '本地验厂工厂', s: '实地考察 · 源头直供' },
  { icon: <ThunderboltOutlined />, t: '印尼本地发货', s: '现货直发 · 免海运清关' },
  { icon: <CustomerServiceOutlined />, t: '中文服务·售后兜底', s: '全程中文对接' },
  { icon: <TagOutlined />, t: '集采底价', s: '集中采购 价格更低' },
]

export default function ShelfHomePage() {
  const nav = useNavigate()
  const [meta, setMeta] = useState<ShelfMeta | null>(null)
  const [items, setItems] = useState<ShelfItem[]>([])
  const [loading, setLoading] = useState(true)
  const [inquiry, setInquiry] = useState<ShelfItem | null>(null)

  useEffect(() => {
    api
      .get<ShelfMeta>('shelfMeta')
      .then((m) => {
        setMeta(m)
        if (m.company_name) document.title = `${m.company_name} - 印尼建材集采`
      })
      .catch(() => {})
    api
      .get<{ items: ShelfItem[] }>('shelfListProducts', { page: 1, page_size: 60 })
      .then((r) => setItems(r.items || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const companyName = meta?.company_name || '星选建材'
  const cats = (meta?.categories || []).filter((c) => c.count > 0)

  // 按品类分楼层（跟随 meta.categories 顺序），每层最多 6 个
  const floors = cats
    .map((c) => ({
      name: c.name,
      count: c.count,
      items: items.filter((p) => p.category === c.name).slice(0, 5),
    }))
    .filter((f) => f.items.length > 0)

  return (
    <div className="sh-page">
      <ShelfTop meta={meta} active="home" />

      {/* Hero：左品类栏 + 中横幅 + 右服务卡 */}
      <div className="sh-wrap">
        <div className="sh-hero">
          <div className="sh-hero-cats">
            <div className="sh-hero-cats-title">
              <AppstoreOutlined /> 全部商品分类
            </div>
            {cats.length === 0 && <div className="sh-hero-cats-empty">商品上架中…</div>}
            {cats.map((c) => (
              <Link key={c.name} className="sh-hero-cat" to={`/c/${encodeURIComponent(c.name)}`}>
                <span>{c.name}</span>
                <span className="n">
                  {c.count} <RightOutlined />
                </span>
              </Link>
            ))}
            <Link className="sh-hero-cat all" to="/c/all">
              <span>全部商品</span>
              <span className="n">
                {meta?.total_on ?? 0} <RightOutlined />
              </span>
            </Link>
          </div>

          <div className="sh-hero-banner">
            <div className="bt">印尼中国建材集采平台</div>
            <div className="bs">本地验厂工厂直供 · 集采底价 · 中文服务售后兜底</div>
            <div className="bb">
              <Button type="primary" size="large" onClick={() => nav('/p/inquiry')}>
                <FormOutlined /> 提交采购需求
              </Button>
              <Button size="large" ghost className="sh-hero-ghost" onClick={() => nav('/c/all')}>
                逛逛全部商品
              </Button>
            </div>
          </div>

          <div className="sh-hero-side">
            <div className="sh-side-title">采购服务</div>
            {meta?.contact_phone && (
              <div className="sh-side-row">
                <PhoneOutlined /> {meta.contact_phone}
              </div>
            )}
            {meta?.contact_wechat && (
              <div className="sh-side-row">
                <WechatOutlined /> {meta.contact_wechat}
              </div>
            )}
            <Button type="primary" block onClick={() => nav('/p/inquiry')}>
              提交采购需求
            </Button>
            <Button block onClick={() => nav('/vendor/login')}>
              <ShopOutlined /> 供应商入口
            </Button>
          </div>
        </div>
      </div>

      <div className="sh-trust">
        <div className="sh-wrap sh-trust-inner">
          {TRUST.map((it) => (
            <div className="sh-trust-item" key={it.t}>
              {it.icon}
              <div>
                <div className="sh-trust-t">{it.t}</div>
                <div className="sh-trust-s">{it.s}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 品类楼层 */}
      <div className="sh-wrap">
        <Spin spinning={loading}>
          {!loading && floors.length === 0 ? (
            <div className="sh-empty">
              <Empty description="暂无商品，敬请期待" />
            </div>
          ) : (
            floors.map((f) => (
              <div className="sh-floor" key={f.name}>
                <div className="sh-floor-head">
                  <span className="sh-floor-title">{f.name}</span>
                  <Link className="sh-floor-more" to={`/c/${encodeURIComponent(f.name)}`}>
                    查看全部 {f.count} 件 <RightOutlined />
                  </Link>
                </div>
                <div className="sh-grid sh-floor-grid">
                  {f.items.map((p) => (
                    <ProductCard key={p.id} product={p} onInquiry={setInquiry} />
                  ))}
                </div>
              </div>
            ))
          )}
        </Spin>
      </div>

      <ShelfFooter meta={meta} />

      <InquiryModal
        open={!!inquiry}
        onClose={() => setInquiry(null)}
        product={inquiry}
        contactPhone={meta?.contact_phone}
      />
    </div>
  )
}
