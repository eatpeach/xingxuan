import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Empty, Spin } from 'antd'
import {
  AppstoreOutlined,
  CustomerServiceOutlined,
  FileSearchOutlined,
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

const CAT_ICONS: Record<string, string> = {
  瓷砖: '🧱',
  卫浴: '🚿',
  板材: '🪵',
  涂料: '🎨',
  灯具: '💡',
  门窗: '🪟',
  五金: '🔧',
  水泥: '🏗️',
}

const FLOOR_GRADIENTS = [
  'linear-gradient(160deg, #3b6fe0, #1d3f96)',
  'linear-gradient(160deg, #2f9e8f, #14655a)',
  'linear-gradient(160deg, #d98f2b, #9c5f10)',
  'linear-gradient(160deg, #8a63c9, #55348c)',
  'linear-gradient(160deg, #d9636b, #96343c)',
  'linear-gradient(160deg, #4a90a4, #205a6b)',
  'linear-gradient(160deg, #7a8a4a, #4a5a24)',
  'linear-gradient(160deg, #5a6acb, #303d8f)',
]

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

      {/* Hero：横幅 + 左侧悬浮品类菜单（参考 MRO 商城） */}
      <div className="sh-wrap">
        <div className="sh-hero-mro">
          <div className="sh-hero-menu">
            <div className="sh-hero-menu-title">
              <AppstoreOutlined /> 产品分类
            </div>
            {cats.length === 0 && <div className="sh-hero-cats-empty">商品上架中…</div>}
            {cats.map((c) => (
              <Link key={c.name} className="sh-menu-item" to={`/c/${encodeURIComponent(c.name)}`}>
                <span className="ic">{CAT_ICONS[c.name] || '📦'}</span>
                <span className="nm">{c.name}</span>
                <span className="n">{c.count}</span>
              </Link>
            ))}
            <Link className="sh-menu-item all" to="/c/all">
              <span className="ic">🗂️</span>
              <span className="nm">全部商品</span>
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
            {(meta?.contact_phone || meta?.contact_wechat) && (
              <div className="bc">
                {meta?.contact_phone && (
                  <span>
                    <PhoneOutlined /> {meta.contact_phone}
                  </span>
                )}
                {meta?.contact_wechat && (
                  <span>
                    <WechatOutlined /> {meta.contact_wechat}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* H5 品类入口 */}
        <div className="sh-cats sh-cats-mobile">
          {cats.map((c) => (
            <span key={c.name} className="sh-chip" onClick={() => nav(`/c/${encodeURIComponent(c.name)}`)}>
              {c.name}
              <span className="sh-chip-count">{c.count}</span>
            </span>
          ))}
          <span className="sh-chip" onClick={() => nav('/c/all')}>
            全部商品
          </span>
        </div>

        {/* promo 三卡（参考云筑找资源/信融宝/招标推荐行） */}
        <div className="sh-promos">
          <div className="sh-promo" onClick={() => nav('/p/inquiry')}>
            <FileSearchOutlined className="ico" />
            <div className="tx">
              <div className="t">集采找货</div>
              <div className="s">找不到想要的货？提交需求本地代找</div>
            </div>
            <span className="go">立即提交 <RightOutlined /></span>
          </div>
          <div className="sh-promo" onClick={() => nav('/vendor/login')}>
            <ShopOutlined className="ico" />
            <div className="tx">
              <div className="t">供应商合作</div>
              <div className="s">印尼本地工厂入驻，获取集采订单</div>
            </div>
            <span className="go">申请合作 <RightOutlined /></span>
          </div>
          <div className="sh-promo follow">
            <div className="tx">
              <div className="t">关注我们</div>
              <div className="s">看厂看货 · 每日选品直播</div>
            </div>
            <span className="qrs">
              {meta?.qr_douyin_url && (
                <span className="q">
                  <img src={meta.qr_douyin_url} alt="抖音" />
                  <i>抖音</i>
                </span>
              )}
              {meta?.qr_channels_url && (
                <span className="q">
                  <img src={meta.qr_channels_url} alt="视频号" />
                  <i>视频号</i>
                </span>
              )}
            </span>
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
            floors.map((f, fi) => (
              <div className="sh-floor" key={f.name}>
                <div className="sh-floor-head">
                  <span className="sh-floor-title">
                    {fi + 1}F {f.name}
                    <span className="sub">精挑细选 · 印尼本地直供</span>
                  </span>
                  <Link className="sh-floor-more" to={`/c/${encodeURIComponent(f.name)}`}>
                    查看全部 {f.count} 件 <RightOutlined />
                  </Link>
                </div>
                <div className="sh-floor-row">
                  <Link
                    className="sh-floor-banner"
                    to={`/c/${encodeURIComponent(f.name)}`}
                    style={{ background: FLOOR_GRADIENTS[fi % FLOOR_GRADIENTS.length] }}
                  >
                    <span className="ic">{CAT_ICONS[f.name] || '📦'}</span>
                    <span className="t">{f.name}</span>
                    <span className="s">{f.count} 件在售</span>
                    <span className="go">
                      查看全部 <RightOutlined />
                    </span>
                  </Link>
                  <div className="sh-grid sh-floor-grid">
                    {f.items.map((p) => (
                      <ProductCard key={p.id} product={p} onInquiry={setInquiry} />
                    ))}
                  </div>
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
