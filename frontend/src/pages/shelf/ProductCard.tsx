import { useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import { PictureOutlined } from '@ant-design/icons'
import { formatPrice } from './InquiryModal'
import type { ShelfItem } from './InquiryModal'

/** 货架商品卡（首页楼层 / 分类页 / 详情页同类共用） */
export default function ProductCard({
  product,
  onInquiry,
}: {
  product: ShelfItem
  onInquiry?: (p: ShelfItem) => void
}) {
  const nav = useNavigate()
  const p = product
  return (
    <div className="sh-card" onClick={() => nav(`/item/${p.id}`)}>
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
          <span className="sh-badge pre">{p.lead_time ? `定制 ${p.lead_time}` : '定制'}</span>
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
          {onInquiry && (
            <Button
              size="small"
              type="primary"
              ghost
              onClick={(e) => {
                e.stopPropagation()
                onInquiry(p)
              }}
            >
              立即询价
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
