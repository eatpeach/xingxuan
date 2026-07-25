import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Checkbox, Empty, Input, Pagination, Space, Spin } from 'antd'
import {
  CustomerServiceOutlined,
  PhoneOutlined,
  PictureOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  TagOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { api } from '../../api'
import InquiryModal, { formatPrice } from './InquiryModal'
import type { ShelfItem, ShelfMeta } from './InquiryModal'
import './shelf.css'

const PAGE_SIZE = 24

const TRUST = [
  { icon: <SafetyCertificateOutlined />, t: '本地验厂工厂', s: '实地考察 · 源头直供' },
  { icon: <ThunderboltOutlined />, t: '现货次日达', s: '本地仓现货直发' },
  { icon: <CustomerServiceOutlined />, t: '中文服务·售后兜底', s: '全程中文对接' },
  { icon: <TagOutlined />, t: '集采底价', s: '集中采购 价格更低' },
]

export default function ShelfHomePage() {
  const nav = useNavigate()
  const [meta, setMeta] = useState<ShelfMeta | null>(null)
  const [items, setItems] = useState<ShelfItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [category, setCategory] = useState('')
  const [kwInput, setKwInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [inStock, setInStock] = useState(false)
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
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    const params: Record<string, any> = { page, page_size: PAGE_SIZE }
    if (category) params.category = category
    if (keyword) params.keyword = keyword
    if (inStock) params.in_stock = 1
    api
      .get<{ items: ShelfItem[]; total: number }>('shelfListProducts', params)
      .then((r) => {
        if (!alive) return
        setItems(r.items || [])
        setTotal(r.total || 0)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [page, category, keyword, inStock])

  const doSearch = () => {
    setKeyword(kwInput.trim())
    setPage(1)
  }

  const companyName = meta?.company_name || '星选建材'

  return (
    <div className="sh-page">
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
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onPressEnter={doSearch}
                placeholder="搜索建材商品，如 瓷砖 / 水泥 / 电缆"
                allowClear
              />
              <Button size="large" type="primary" icon={<SearchOutlined />} onClick={doSearch}>
                搜索
              </Button>
            </Space.Compact>
          </div>
          {meta?.contact_phone ? (
            <div className="sh-phone">
              <PhoneOutlined /> {meta.contact_phone}
            </div>
          ) : null}
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

      <div className="sh-wrap">
        <div className="sh-cats">
          <span
            className={`sh-chip${category === '' ? ' active' : ''}`}
            onClick={() => {
              setCategory('')
              setPage(1)
            }}
          >
            全部
          </span>
          {(meta?.categories || []).map((c) => (
            <span
              key={c.name}
              className={`sh-chip${category === c.name ? ' active' : ''}`}
              onClick={() => {
                setCategory(c.name)
                setPage(1)
              }}
            >
              {c.name}
              {c.count > 0 && <span className="sh-chip-count">{c.count}</span>}
            </span>
          ))}
          <Checkbox
            className="sh-instock"
            checked={inStock}
            onChange={(e) => {
              setInStock(e.target.checked)
              setPage(1)
            }}
          >
            仅看现货
          </Checkbox>
        </div>

        <Spin spinning={loading}>
          {!loading && items.length === 0 ? (
            <div className="sh-empty">
              <Empty description="暂无商品，敬请期待" />
            </div>
          ) : (
            <div className="sh-grid">
              {items.map((p) => (
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
                    <div className="sh-card-foot">
                      <div>
                        <div className="sh-price">
                          {formatPrice(p.currency, p.sell_price)}
                          <span className="sh-price-unit"> /{p.unit}</span>
                        </div>
                        <div className="sh-moq">{p.moq > 0 ? `${p.moq}${p.unit} 起订` : ''}</div>
                      </div>
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        onClick={(e) => {
                          e.stopPropagation()
                          setInquiry(p)
                        }}
                      >
                        立即询价
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Spin>

        {total > PAGE_SIZE && (
          <div className="sh-pager">
            <Pagination
              current={page}
              total={total}
              pageSize={PAGE_SIZE}
              showSizeChanger={false}
              onChange={(p) => {
                setPage(p)
                window.scrollTo({ top: 0 })
              }}
            />
          </div>
        )}
      </div>

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

      <InquiryModal
        open={!!inquiry}
        onClose={() => setInquiry(null)}
        product={inquiry}
        contactPhone={meta?.contact_phone}
      />
    </div>
  )
}
