import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Checkbox, Empty, Pagination, Spin } from 'antd'
import { PhoneOutlined, WechatOutlined } from '@ant-design/icons'
import { api } from '../../api'
import InquiryModal from './InquiryModal'
import type { ShelfItem, ShelfMeta } from './InquiryModal'
import ProductCard from './ProductCard'
import { ShelfFooter, ShelfTop } from './ShelfChrome'
import './shelf.css'

const PAGE_SIZE = 24

const SORTS = [
  { key: '', label: '综合' },
  { key: 'newest', label: '最新' },
  { key: 'price_asc', label: '价格 ↑' },
  { key: 'price_desc', label: '价格 ↓' },
]

/** 分类列表页 /c/:name（name=all 为全部商品，支持 ?kw= 搜索） */
export default function ShelfCategoryPage() {
  const { name } = useParams<{ name: string }>()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const keyword = sp.get('kw') || ''
  const category = !name || name === 'all' ? '' : decodeURIComponent(name)

  const [meta, setMeta] = useState<ShelfMeta | null>(null)
  const [items, setItems] = useState<ShelfItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState('')
  const [inStock, setInStock] = useState(false)
  const [loading, setLoading] = useState(true)
  const [inquiry, setInquiry] = useState<ShelfItem | null>(null)

  useEffect(() => {
    api.get<ShelfMeta>('shelfMeta').then(setMeta).catch(() => {})
  }, [])

  // 切品类/搜索词时回第一页
  useEffect(() => {
    setPage(1)
  }, [category, keyword])

  useEffect(() => {
    let alive = true
    setLoading(true)
    const params: Record<string, unknown> = { page, page_size: PAGE_SIZE }
    if (category) params.category = category
    if (keyword) params.keyword = keyword
    if (inStock) params.in_stock = 1
    if (sort) params.sort = sort
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
  }, [category, keyword, page, sort, inStock])

  useEffect(() => {
    const cname = meta?.company_name || '星选建材'
    document.title = `${category || (keyword ? `搜索：${keyword}` : '全部商品')} - ${cname}`
  }, [meta, category, keyword])

  const title = keyword ? `“${keyword}” 的搜索结果` : category || '全部商品'

  return (
    <div className="sh-page">
      <ShelfTop meta={meta} active="category" defaultKeyword={keyword} />

      <div className="sh-wrap">
        <div className="sh-crumb">
          <Link to="/">首页</Link>
          <span className="sep">/</span>
          {category ? (
            <>
              <Link to="/c/all">全部商品</Link>
              <span className="sep">/</span>
              <span>{category}</span>
            </>
          ) : (
            <span>{keyword ? '搜索' : '全部商品'}</span>
          )}
        </div>

        <div className="sh-cat-layout">
          {/* 左侧栏（PC） */}
          <div className="sh-cat-side">
            <div className="sh-side-block">
              <div className="sh-side-title">商品分类</div>
              <Link className={`sh-side-cat${!category ? ' active' : ''}`} to="/c/all">
                全部商品 <span className="n">{meta?.total_on ?? 0}</span>
              </Link>
              {(meta?.categories || []).map((c) => (
                  <div key={c.name}>
                    <Link
                      className={`sh-side-cat${category === c.name ? ' active' : ''}`}
                      to={`/c/${encodeURIComponent(c.name)}`}
                    >
                      {c.name} <span className="n">{c.count}</span>
                    </Link>
                    {(c.children || []).map((ch) => (
                        <Link
                          key={ch.name}
                          className={`sh-side-cat sub${category === ch.name ? ' active' : ''}`}
                          to={`/c/${encodeURIComponent(ch.name)}`}
                        >
                          {ch.name} <span className="n">{ch.count}</span>
                        </Link>
                      ))}
                  </div>
                ))}
            </div>
            <div className="sh-side-block">
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
              <a className="sh-side-link" onClick={() => nav('/p/inquiry')}>
                找不到想要的？提交采购需求 →
              </a>
            </div>
          </div>

          {/* 右侧列表 */}
          <div className="sh-cat-main">
            {/* H5 品类 chips */}
            <div className="sh-cats sh-cats-mobile">
              <span className={`sh-chip${!category ? ' active' : ''}`} onClick={() => nav('/c/all')}>
                全部
              </span>
              {(meta?.categories || []).map((c) => (
                  <span
                    key={c.name}
                    className={`sh-chip${category === c.name ? ' active' : ''}`}
                    onClick={() => nav(`/c/${encodeURIComponent(c.name)}`)}
                  >
                    {c.name}
                  </span>
                ))}
            </div>

            <div className="sh-sortbar">
              <span className="sh-sortbar-title">
                {title}
                <span className="cnt">共 {total} 件</span>
              </span>
              <span className="sh-sorts">
                {SORTS.map((s) => (
                  <a
                    key={s.key}
                    className={sort === s.key ? 'active' : ''}
                    onClick={() => {
                      setSort(s.key)
                      setPage(1)
                    }}
                  >
                    {s.label}
                  </a>
                ))}
                <Checkbox
                  checked={inStock}
                  onChange={(e) => {
                    setInStock(e.target.checked)
                    setPage(1)
                  }}
                >
                  仅看现货
                </Checkbox>
              </span>
            </div>

            <Spin spinning={loading}>
              {!loading && items.length === 0 ? (
                <div className="sh-empty">
                  <Empty description={keyword ? '没有找到相关商品，可提交采购需求由我们代找' : '该分类暂无商品'} />
                </div>
              ) : (
                <div className="sh-grid">
                  {items.map((p) => (
                    <ProductCard key={p.id} product={p} onInquiry={setInquiry} />
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
        </div>
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
