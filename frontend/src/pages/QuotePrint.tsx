import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Spin, Tag } from 'antd'
import { PrinterOutlined } from '@ant-design/icons'
import { api } from '../api'

/**
 * 客户报价单 打印 / 导出 PDF 页
 *
 * 设计原则：
 *  - 网页直接预览（路径 /quotes/:id/print）
 *  - 浏览器 Cmd/Ctrl+P → 选"另存为 PDF"即可导出（无需服务端 wkhtmltopdf / dompdf）
 *  - logo 通过 /storage/brand/logo.png 引入；transparent PNG 即可
 *  - 隐去供应商品牌（show_brand=false）的行不展示品牌型号
 */
export default function QuotePrintPage() {
  const { id } = useParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [companyName, setCompanyName] = useState('星选建材')
  const [logoPath, setLogoPath] = useState<string>('/storage/brand/logo.png')
  const [customer, setCustomer] = useState<any>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [q, settings] = await Promise.all([
          api.get('getCustomerQuote', { id }),
          api.get('listSettings'),
        ])
        if (!alive) return
        setData(q.data)
        const sm: Record<string, string> = Object.fromEntries(
          (settings.items || []).map((s: any) => [s.key, s.value]),
        )
        if (sm.company_name) setCompanyName(sm.company_name)
        if (sm.pdf_logo_path) setLogoPath('/storage/' + sm.pdf_logo_path.replace(/^\/+/, ''))

        if (q.data?.customer_id) {
          const c = await api.get('getCustomer', { id: q.data.customer_id })
          if (alive) setCustomer(c.data)
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [id])

  if (loading) {
    return (
      <div style={{ padding: 80, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!data) return <div style={{ padding: 24 }}>报价单不存在</div>

  return (
    <div className="quote-page">
      <style>{printStyles}</style>

      <div className="quote-toolbar no-print">
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
          打印 / 导出 PDF
        </Button>
        <span style={{ marginLeft: 12, color: '#999', fontSize: 12 }}>
          按 Cmd/Ctrl + P，目标选「另存为 PDF」即可导出
        </span>
      </div>

      <div className="quote-paper">
        <div className="quote-header">
          <img
            className="quote-logo"
            src={logoPath}
            alt="logo"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
          <div className="quote-title-block">
            <h1>报 价 单</h1>
            <div className="quote-company">{companyName}</div>
          </div>
        </div>

        <table className="quote-meta">
          <tbody>
            <tr>
              <th>报价单号</th>
              <td>{data.no}</td>
              <th>报价日期</th>
              <td>{(data.created_at || '').slice(0, 10)}</td>
            </tr>
            <tr>
              <th>客户</th>
              <td>
                {customer?.name}
                {customer?.company ? `（${customer.company}）` : ''}
              </td>
              <th>有效期至</th>
              <td>{(data.valid_until || '').slice(0, 10) || '-'}</td>
            </tr>
            <tr>
              <th>联系电话</th>
              <td>{customer?.phone || '-'}</td>
              <th>邮箱</th>
              <td>{customer?.email || '-'}</td>
            </tr>
          </tbody>
        </table>

        <table className="quote-items">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>产品名称</th>
              <th>规格</th>
              <th>品牌 / 型号</th>
              <th style={{ width: 60 }}>数量</th>
              <th style={{ width: 50 }}>单位</th>
              <th style={{ width: 90 }}>单价 (¥)</th>
              <th style={{ width: 100 }}>金额 (¥)</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it: any, idx: number) => (
              <tr key={it.id}>
                <td>{idx + 1}</td>
                <td>{it.product_name}</td>
                <td>{it.spec}</td>
                <td>
                  {it.show_brand ? (
                    <span>
                      {it.brand_display}
                      {it.model_display ? ` / ${it.model_display}` : ''}
                    </span>
                  ) : (
                    <span style={{ color: '#999' }}>—</span>
                  )}
                </td>
                <td>{Number(it.qty).toLocaleString()}</td>
                <td>{it.unit}</td>
                <td>{Number(it.sell_price).toLocaleString()}</td>
                <td>
                  <strong>{(Number(it.sell_price) * Number(it.qty)).toLocaleString()}</strong>
                </td>
              </tr>
            ))}
            <tr className="quote-total">
              <td colSpan={7} style={{ textAlign: 'right' }}>
                <strong>合计</strong>
              </td>
              <td>
                <strong>¥ {Number(data.total).toLocaleString()}</strong>
              </td>
            </tr>
          </tbody>
        </table>

        {data.remark && (
          <div className="quote-remark">
            <h4>备注</h4>
            <p>{data.remark}</p>
          </div>
        )}

        <div className="quote-terms">
          <h4>说明</h4>
          <ol>
            <li>本报价含税；如有变更以最终签订合同为准。</li>
            <li>报价有效期内有效，过期需重新询价。</li>
            <li>付款方式、交货方式、运输费用等以双方协商为准。</li>
          </ol>
        </div>

        <div className="quote-sign">
          <div className="quote-sign-block">
            <div>客户确认签字</div>
            <div className="quote-sign-line">&nbsp;</div>
            <div className="quote-sign-date">日期：</div>
          </div>
          <div className="quote-sign-block">
            <div>{companyName}（盖章）</div>
            <div className="quote-sign-line">&nbsp;</div>
            <div className="quote-sign-date">日期：</div>
          </div>
        </div>
      </div>
    </div>
  )
}

const printStyles = `
.quote-page {
  background: #f0f2f5;
  min-height: 100vh;
  padding: 24px 0;
}
.quote-toolbar {
  max-width: 800px;
  margin: 0 auto 16px;
}
.quote-paper {
  background: #fff;
  width: 800px;
  margin: 0 auto;
  padding: 48px 56px;
  box-shadow: 0 2px 8px rgba(0,0,0,.08);
  color: #222;
  font-family: "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif;
  font-size: 13px;
  line-height: 1.6;
}
.quote-header {
  display: flex;
  align-items: center;
  border-bottom: 3px double #1677ff;
  padding-bottom: 16px;
  margin-bottom: 24px;
}
.quote-logo {
  width: 80px;
  height: 80px;
  object-fit: contain;
  margin-right: 20px;
  /* 透明背景的 PNG 直接渲染；如果是白底图，可以加 mix-blend-mode: multiply */
  mix-blend-mode: multiply;
}
.quote-title-block h1 {
  margin: 0;
  font-size: 28px;
  letter-spacing: 8px;
  color: #1677ff;
}
.quote-company {
  font-size: 14px;
  color: #666;
  margin-top: 4px;
}
.quote-meta {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
}
.quote-meta th, .quote-meta td {
  border: 1px solid #d9d9d9;
  padding: 6px 10px;
  text-align: left;
}
.quote-meta th {
  background: #fafafa;
  width: 90px;
  font-weight: 500;
  color: #666;
}
.quote-items {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
}
.quote-items th, .quote-items td {
  border: 1px solid #d9d9d9;
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}
.quote-items th {
  background: #f0f5ff;
  font-weight: 500;
}
.quote-items td:nth-child(5),
.quote-items td:nth-child(6),
.quote-items td:nth-child(7),
.quote-items td:nth-child(8) {
  text-align: right;
}
.quote-total td {
  background: #fafafa;
  font-size: 14px;
}
.quote-remark, .quote-terms {
  margin-top: 16px;
}
.quote-remark h4, .quote-terms h4 {
  margin: 0 0 6px;
  font-size: 13px;
  color: #555;
}
.quote-terms ol {
  padding-left: 24px;
  margin: 0;
  color: #666;
  font-size: 12px;
}
.quote-sign {
  display: flex;
  justify-content: space-between;
  margin-top: 56px;
}
.quote-sign-block {
  width: 45%;
  font-size: 12px;
  color: #666;
}
.quote-sign-line {
  height: 1px;
  background: #999;
  margin: 30px 0 8px;
}
.quote-sign-date {
  color: #999;
}

@media print {
  body { background: #fff; }
  .quote-page { background: #fff; padding: 0; }
  .no-print { display: none !important; }
  .quote-paper {
    width: 100%;
    box-shadow: none;
    margin: 0;
    padding: 24px 32px;
  }
  @page {
    size: A4;
    margin: 12mm 14mm;
  }
}
`
