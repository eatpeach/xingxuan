import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Carousel, Empty, Modal, Spin } from 'antd'
import type { ReactNode } from 'react'
import {
  AppstoreOutlined,
  BgColorsOutlined,
  BuildOutlined,
  BulbOutlined,
  CheckCircleFilled,
  CustomerServiceOutlined,
  DatabaseOutlined,
  FormOutlined,
  LayoutOutlined,
  PhoneOutlined,
  PlayCircleOutlined,
  RestOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  TableOutlined,
  TagOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  WechatOutlined,
} from '@ant-design/icons'
import { api } from '../../api'
import InquiryModal from './InquiryModal'
import type { ShelfItem, ShelfMeta } from './InquiryModal'
import ProductCard from './ProductCard'
import { ShelfFooter, ShelfTop } from './ShelfChrome'
import './shelf.css'

const CAT_ICONS: Record<string, ReactNode> = {
  瓷砖: <TableOutlined />,
  卫浴: <RestOutlined />,
  板材: <DatabaseOutlined />,
  涂料: <BgColorsOutlined />,
  灯具: <BulbOutlined />,
  门窗: <LayoutOutlined />,
  五金: <ToolOutlined />,
  水泥: <BuildOutlined />,
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

const DECO_TAGS = ['实地验厂', '工厂直供', '本地现货', '集采底价', '中文售后']

const TRUST = [
  { icon: <SafetyCertificateOutlined />, t: '实地验厂', s: '工厂实地考察 · 源头直供' },
  { icon: <ThunderboltOutlined />, t: '印尼本地发货', s: '现货直发 · 免海运清关' },
  { icon: <CustomerServiceOutlined />, t: '中文服务·售后兜底', s: '全程中文对接' },
  { icon: <TagOutlined />, t: '集采底价', s: '集中采购 价格更低' },
]

interface ShelfVideo {
  id: number
  title: string
  cover_url: string
  video_url: string
  duration: number
}

interface ShelfBanner {
  id: number
  image_url: string
  link_url: string
}

export default function ShelfHomePage() {
  const nav = useNavigate()
  const [meta, setMeta] = useState<ShelfMeta | null>(null)
  const [items, setItems] = useState<ShelfItem[]>([])
  const [videos, setVideos] = useState<ShelfVideo[]>([])
  const [banners, setBanners] = useState<ShelfBanner[]>([])
  const [playing, setPlaying] = useState<ShelfVideo | null>(null)
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
    api
      .get<{ items: ShelfVideo[] }>('shelfLatestVideos', { limit: 4 })
      .then((r) => setVideos(r.items || []))
      .catch(() => {})
    api
      .get<{ items: ShelfBanner[] }>('shelfBanners')
      .then((r) => setBanners(r.items || []))
      .catch(() => {})
  }, [])

  const companyName = meta?.company_name || '星选建材'
  const cats = meta?.categories || []

  // 按大类分楼层（含子类商品），每层最多 5 个
  const floors = cats
    .map((c) => {
      const leafNames = [c.name, ...(c.children || []).map((x) => x.name)]
      return {
        name: c.name,
        count: c.count,
        items: items.filter((p) => leafNames.includes(p.category)).slice(0, 5),
      }
    })
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
            {cats.map((c) => {
              const kids = c.children || []
              return (
                <div key={c.name} className="sh-menu-wrap">
                  <Link className="sh-menu-item" to={`/c/${encodeURIComponent(c.name)}`}>
                    <span className="ic">{CAT_ICONS[c.name] || <AppstoreOutlined />}</span>
                    <span className="nm">{c.name}</span>
                    <span className="n">
                      {c.count}
                      {kids.length > 0 && <RightOutlined style={{ fontSize: 10, marginLeft: 4 }} />}
                    </span>
                  </Link>
                  {kids.length > 0 && (
                    <div className="sh-menu-fly">
                      <div className="fly-title">{c.name}</div>
                      <div className="fly-links">
                        {kids.map((ch) => (
                          <Link key={ch.name} to={`/c/${encodeURIComponent(ch.name)}`}>
                            {ch.name}
                            <span className="n">{ch.count}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            <Link className="sh-menu-item all" to="/c/all">
              <span className="ic"><AppstoreOutlined /></span>
              <span className="nm">全部商品</span>
              <span className="n">
                {meta?.total_on ?? 0} <RightOutlined />
              </span>
            </Link>
          </div>
          <div className="sh-hero-banner">
            <div className="sh-carousel-wrap">
            <Carousel className="sh-banner-carousel" autoplay dots arrows={banners.length > 0}>
              {/* 默认文案张（玻璃气泡） */}
              <div>
                <div className="sh-slide sh-slide-text">
                  <div className="sh-banner-deco" aria-hidden>
                    <svg className="deco-wave" viewBox="0 0 520 400" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="dw1" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0" stopColor="#a9c4ff" stopOpacity="0.5" />
                          <stop offset="1" stopColor="#8f7bff" stopOpacity="0.15" />
                        </linearGradient>
                      </defs>
                      <path d="M40,300 C160,180 300,360 500,120" fill="none" stroke="url(#dw1)" strokeWidth="46" strokeLinecap="round" />
                      <path d="M20,360 C180,260 320,420 520,220" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="20" strokeLinecap="round" />
                    </svg>
                    <span className="deco-orb o1" />
                    <span className="deco-orb o2" />
                    {DECO_TAGS.map((t, i) => (
                      <span className={`deco-tag t${i + 1}`} key={t}>
                        <CheckCircleFilled /> {t}
                      </span>
                    ))}
                  </div>
                  <div className="sh-banner-main">
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
                </div>
              </div>
              {/* 后台上传的横幅图 */}
              {banners.map((b) => (
                <div key={b.id}>
                  {b.link_url ? (
                    <a
                      className="sh-slide sh-slide-img"
                      href={b.link_url}
                      target={/^https?:/.test(b.link_url) ? '_blank' : undefined}
                      rel="noreferrer"
                    >
                      <img src={b.image_url} alt="" />
                    </a>
                  ) : (
                    <div className="sh-slide sh-slide-img">
                      <img src={b.image_url} alt="" />
                    </div>
                  )}
                </div>
              ))}
            </Carousel>
            </div>
            <div className="sh-banner-trust">
              {TRUST.map((it) => (
                <div className="sh-banner-trust-item" key={it.t}>
                  <span className="ic">{it.icon}</span>
                  <div className="tx">
                    <div className="t">{it.t}</div>
                    <div className="s">{it.s}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 右侧服务卡（参考云筑网） */}
          <div className="sh-hero-side">
            <div className="sh-side-hello">
              <div className="hi">欢迎来到{companyName}</div>
              <div className="sub">印尼中国建材集采平台</div>
            </div>
            <div className="sh-side-btns">
              <Button type="primary" onClick={() => nav('/p/inquiry')}>
                提交采购需求
              </Button>
              <Button onClick={() => nav('/vendor/login')}>供应商入驻</Button>
            </div>
            <div className="sh-side-actions">
              <div className="sh-side-action" onClick={() => nav('/p/inquiry')}>
                <FormOutlined className="ico" />
                <div className="tx">
                  <div className="t">发布采购需求</div>
                  <div className="s">专人服务 · 快速获取报价</div>
                </div>
                <RightOutlined className="arr" />
              </div>
              <div className="sh-side-action" onClick={() => nav('/vendor/login')}>
                <ShopOutlined className="ico" />
                <div className="tx">
                  <div className="t">供应商供货合作</div>
                  <div className="s">印尼工厂入驻 · 获取集采订单</div>
                </div>
                <RightOutlined className="arr" />
              </div>
            </div>

            {videos.length > 0 && (
              <div className="sh-side-videos">
                <div className="sh-side-vtitle">
                  <span>
                    <PlayCircleOutlined /> 最新星选视频
                  </span>
                </div>
                {videos.map((v) => (
                  <div className="sh-video-item" key={v.id} onClick={() => setPlaying(v)}>
                    <div className="cv">
                      {v.cover_url ? <img src={v.cover_url} alt="" /> : <PlayCircleOutlined />}
                      <span className="pl">
                        <PlayCircleOutlined />
                      </span>
                    </div>
                    <div className="tt">{v.title}</div>
                  </div>
                ))}
              </div>
            )}

            {(meta?.contact_phone || meta?.contact_wechat) && (
              <div className="sh-side-contact">
                {meta?.contact_phone && (
                  <div>
                    <PhoneOutlined /> {meta.contact_phone}
                  </div>
                )}
                {meta?.contact_wechat && (
                  <div>
                    <WechatOutlined /> {meta.contact_wechat}
                  </div>
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
                    <span className="ic">{CAT_ICONS[f.name] || <AppstoreOutlined />}</span>
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

      <Modal
        open={!!playing}
        title={playing?.title}
        footer={null}
        onCancel={() => setPlaying(null)}
        width={420}
        centered
        destroyOnClose
      >
        {playing && (
          <video
            src={playing.video_url}
            poster={playing.cover_url || undefined}
            controls
            autoPlay
            style={{ width: '100%', maxHeight: '70vh', background: '#000' }}
          />
        )}
      </Modal>
    </div>
  )
}
