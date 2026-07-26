import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Empty, Rate, Spin, Tag } from 'antd'
import { PhoneOutlined, PictureOutlined } from '@ant-design/icons'
import { api } from '../../api'
import InquiryModal, { formatPrice } from './InquiryModal'
import type { ShelfItem, ShelfMeta } from './InquiryModal'
import './shelf.css'

interface ShelfProductDetail extends ShelfItem {
  images: string[]
  model: string
  freight_note: string
  description: string
  trust: { is_verified: number | boolean; rating: number; deal_count: number }
  related: ShelfItem[]
}

export default function ShelfProductPage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const [meta, setMeta] = useState<ShelfMeta | null>(null)
  const [product, setProduct] = useState<ShelfProductDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [imgIdx, setImgIdx] = useState(0)
  const [inqOpen, setInqOpen] = useState(false)

  useEffect(() => {
    api.get<ShelfMeta>('shelfMeta').then(setMeta).catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setFailed(false)
    setImgIdx(0)
    window.scrollTo({ top: 0 })
    api
      .get<{ product: ShelfProductDetail }>('shelfGetProduct', { id })
      .then((r) => {
        if (!alive) return
        if (!r.product) {
          setFailed(true)
          return
        }
        setProduct(r.product)
        document.title = `${r.product.name} - 印尼建材集采`
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id])

  const companyName = meta?.company_name || '星选建材'

  const header = (
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
          {meta?.contact_phone ? (
            <div className="sh-phone">
              <PhoneOutlined /> {meta.contact_phone}
            </div>
          ) : null}
        </div>
      </div>
    </>
  )

  const footer = (
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

  if (loading) {
    return (
      <div className="sh-page">
        {header}
        <div className="sh-center">
          <Spin size="large" />
        </div>
      </div>
    )
  }

  if (failed || !product) {
    return (
      <div className="sh-page">
        {header}
        <div className="sh-center">
          <Empty description="商品不存在或已下架" />
          <Button type="primary" onClick={() => nav('/')}>
            返回首页
          </Button>
        </div>
        {footer}
      </div>
    )
  }

  const images = product.images && product.images.length > 0 ? product.images : product.cover ? [product.cover] : []
  const mainImg = images[imgIdx] || images[0] || ''

  const rows: Array<[string, ReactNode]> = [
    ['品牌', product.brand || '—'],
    ['型号', product.model || '—'],
    ['规格', product.spec || '—'],
    ['起订量', product.moq > 0 ? `${product.moq} ${product.unit}` : '不限'],
    [
      '发货',
      product.stock_status === 'in_stock' ? (
        <span style={{ color: '#22a45d', fontWeight: 600 }}>现货 · 印尼本地发货</span>
      ) : (
        <span style={{ color: '#f08a24' }}>定制/订货生产，交期 {product.lead_time || '请咨询'}</span>
      ),
    ],
  ]
  if (product.freight_note) rows.push(['运费说明', product.freight_note])

  return (
    <div className="sh-page sh-page-detail">
      {header}

      <div className="sh-wrap">
        <div className="sh-detail">
          <div className="sh-gallery">
            <div className="sh-gallery-main">
              {mainImg ? (
                <img src={mainImg} alt={product.name} />
              ) : (
                <div className="sh-card-noimg" style={{ fontSize: 56 }}>
                  <PictureOutlined />
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div className="sh-thumbs">
                {images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt=""
                    className={`sh-thumb${i === imgIdx ? ' active' : ''}`}
                    onClick={() => setImgIdx(i)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="sh-info">
            <h1>{product.name}</h1>
            {product.spec && <div className="sh-info-spec">{product.spec}</div>}
            <div className="sh-info-price">
              {formatPrice(product.currency, product.sell_price)}
              <span className="sh-price-unit"> /{product.unit}</span>
            </div>

            <table className="sh-params">
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k}>
                    <td className="k">{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="sh-trustline">
              {product.trust?.is_verified ? <Tag color="green">已验厂工厂</Tag> : null}
              {(product.trust?.deal_count || 0) > 0 && <Tag>平台成交 {product.trust.deal_count} 单</Tag>}
              {(product.trust?.rating || 0) > 0 && (
                <Rate disabled allowHalf value={product.trust.rating} style={{ fontSize: 14 }} />
              )}
            </div>

            <div className="sh-cta">
              <Button
                type="primary"
                size="large"
                style={{ width: '100%', maxWidth: 280 }}
                onClick={() => setInqOpen(true)}
              >
                立即询价
              </Button>
              {meta?.contact_phone && (
                <span className="sh-cta-phone">
                  <PhoneOutlined /> 或致电 {meta.contact_phone}
                </span>
              )}
            </div>
          </div>
        </div>

        {product.description && (
          <div className="sh-desc-card">
            <h2>商品详情</h2>
            <div className="sh-desc-text">{product.description}</div>
          </div>
        )}

        {product.related && product.related.length > 0 && (
          <>
            <div className="sh-section-title">同类商品</div>
            <div className="sh-grid">
              {product.related.map((p) => (
                <div key={p.id} className="sh-card" onClick={() => nav(`/item/${p.id}`)}>
                  <div className="sh-card-img">
                    {p.cover ? (
                      <img src={p.cover} alt={p.name} loading="lazy" />
                    ) : (
                      <div className="sh-card-noimg">
                        <PictureOutlined />
                      </div>
                    )}
                    {p.stock_status === 'in_stock' ? (
                      <span className="sh-badge stock">现货</span>
                    ) : (
                      <span className="sh-badge pre">{p.lead_time ? `订货 ${p.lead_time}` : '订货'}</span>
                    )}
                  </div>
                  <div className="sh-card-body">
                    <div className="sh-card-name">{p.name}</div>
                    <div className="sh-card-spec">{p.spec}</div>
                    <div className="sh-price">
                      {formatPrice(p.currency, p.sell_price)}
                      <span className="sh-price-unit"> /{p.unit}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {footer}

      <div className="sh-stickybar">
        <div className="sh-sticky-price">
          {formatPrice(product.currency, product.sell_price)}
          <span className="sh-price-unit"> /{product.unit}</span>
        </div>
        <Button type="primary" size="large" style={{ flex: 1 }} onClick={() => setInqOpen(true)}>
          立即询价
        </Button>
      </div>

      <InquiryModal
        open={inqOpen}
        onClose={() => setInqOpen(false)}
        product={product}
        contactPhone={meta?.contact_phone}
      />
    </div>
  )
}
