import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Empty, Rate, Spin, Tabs, Tag } from 'antd'
import { PhoneOutlined, PictureOutlined } from '@ant-design/icons'
import { api } from '../../api'
import InquiryModal, { formatPrice } from './InquiryModal'
import type { ShelfItem, ShelfMeta } from './InquiryModal'
import ProductCard from './ProductCard'
import { ShelfFooter, ShelfTop } from './ShelfChrome'
import './shelf.css'

interface ShelfProductDetail extends ShelfItem {
  images: string[]
  model: string
  freight_note: string
  description: string
  trust: { is_verified: number | boolean; rating: number; deal_count: number }
  related: ShelfItem[]
}

const FAQ: Array<[string, string]> = [
  ['起订量可以谈吗？', '页面标注的是常规起订量，小批量或拼单需求可提交询价，我们会协调工厂给出方案。'],
  ['交期怎么算？', '现货商品印尼本地仓直发；定制/订货商品以详情标注交期为准，下单后我们全程跟单。'],
  ['价格是最终价吗？', '页面价格为参考价，最终以询价后的正式报价单为准，量大价优。'],
  ['质量有保障吗？', '供应商均经平台实地验厂，交易走平台合同，售后由平台中文团队兜底处理。'],
]

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

  if (loading) {
    return (
      <div className="sh-page">
        <ShelfTop meta={meta} active="detail" />
        <div className="sh-center">
          <Spin size="large" />
        </div>
      </div>
    )
  }

  if (failed || !product) {
    return (
      <div className="sh-page">
        <ShelfTop meta={meta} active="detail" />
        <div className="sh-center">
          <Empty description="商品不存在或已下架" />
          <Button type="primary" onClick={() => nav('/')}>
            返回首页
          </Button>
        </div>
        <ShelfFooter meta={meta} />
      </div>
    )
  }

  const images = product.images && product.images.length > 0 ? product.images : product.cover ? [product.cover] : []
  const mainImg = images[imgIdx] || images[0] || ''

  const rows: Array<[string, ReactNode]> = [
    ['品牌', product.brand || '—'],
    ['型号', product.model || '—'],
    ['规格', product.spec || '—'],
    ['单位', product.unit || '—'],
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

  const specTable = (
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
  )

  return (
    <div className="sh-page sh-page-detail">
      <ShelfTop meta={meta} active="detail" />

      <div className="sh-wrap">
        <div className="sh-crumb">
          <Link to="/">首页</Link>
          <span className="sep">/</span>
          {product.category ? (
            <>
              <Link to={`/c/${encodeURIComponent(product.category)}`}>{product.category}</Link>
              <span className="sep">/</span>
            </>
          ) : null}
          <span className="cur">{product.name}</span>
        </div>

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

            <div className="sh-refprice">
              <span className="lbl">参考价</span>
              <span className="val">
                {formatPrice(product.currency, product.sell_price)}
                <span className="sh-price-unit"> /{product.unit}</span>
              </span>
              <span className="note">最终以询价报价单为准，量大价优</span>
            </div>

            <table className="sh-params sh-params-brief">
              <tbody>
                {rows.slice(0, 4).map(([k, v]) => (
                  <tr key={k}>
                    <td className="k">{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
                <tr>
                  <td className="k">发货</td>
                  <td>{rows.find(([k]) => k === '发货')?.[1]}</td>
                </tr>
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

        <div className="sh-desc-card sh-detail-tabs">
          <Tabs
            items={[
              {
                key: 'desc',
                label: '商品详情',
                children: product.description ? (
                  <div className="sh-desc-text">{product.description}</div>
                ) : (
                  <div className="sh-desc-text" style={{ color: '#999' }}>
                    详细参数见「规格参数」，更多信息可点击「立即询价」咨询。
                  </div>
                ),
              },
              { key: 'spec', label: '规格参数', children: specTable },
              {
                key: 'faq',
                label: '常见问题',
                children: (
                  <div className="sh-faq">
                    {FAQ.map(([q, a]) => (
                      <div className="sh-faq-item" key={q}>
                        <div className="q">Q：{q}</div>
                        <div className="a">A：{a}</div>
                      </div>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        </div>

        {product.related && product.related.length > 0 && (
          <>
            <div className="sh-section-title">同类商品</div>
            <div className="sh-grid">
              {product.related.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </>
        )}
      </div>

      <ShelfFooter meta={meta} />

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
