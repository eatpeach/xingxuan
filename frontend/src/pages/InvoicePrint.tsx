import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Space, Spin, message } from 'antd'
import { DownloadOutlined, PrinterOutlined } from '@ant-design/icons'
import { api } from '../api'
// @ts-ignore
import html2pdf from 'html2pdf.js'

/**
 * 发票（Invoice）打印 / 下载页
 * 数据沿用同一个 customer_quote，但展示加上发票号、签发日、到期日、收款银行信息
 */
export default function InvoicePrintPage() {
  const { id } = useParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [customer, setCustomer] = useState<any>(null)
  const [exporting, setExporting] = useState(false)
  const paperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [q, st] = await Promise.all([
          api.get('getCustomerQuote', { id }),
          api.get('listSettings'),
        ])
        if (!alive) return
        setData(q.data)
        const sm: Record<string, string> = Object.fromEntries(
          (st.items || []).map((s: any) => [s.key, s.value]),
        )
        setSettings(sm)
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

  if (loading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>
  if (!data) return <div style={{ padding: 24 }}>报价单不存在</div>
  if (!data.invoice_no) {
    return (
      <div style={{ padding: 80, textAlign: 'center' }}>
        <div style={{ fontSize: 16, color: '#8c8c8c' }}>该报价单尚未开具发票</div>
        <div style={{ marginTop: 12, fontSize: 13, color: '#bfbfbf' }}>
          请回到「客户报价 → 详情」点击「开具发票」
        </div>
      </div>
    )
  }

  const total = Number(data.total || 0)
  const currency = (data.currency || 'IDR') as 'IDR' | 'CNY'
  const taxIncluded = !!Number(data.tax_included ?? 1)
  const taxRate = Number(data.tax_rate ?? 0.11)
  const sym = currency === 'IDR' ? 'Rp' : '¥'
  const fmt = (n: number) =>
    currency === 'IDR'
      ? Math.round(n).toLocaleString('id-ID')
      : n.toLocaleString(undefined, { minimumFractionDigits: 2 })
  const netAmount = taxIncluded ? total / (1 + taxRate) : total
  const taxAmount = taxIncluded ? total - netAmount : total * taxRate
  const grandTotal = taxIncluded ? total : total + taxAmount

  const companyName = settings.company_name || '星选建材'
  const logoUrl = settings.pdf_logo_path ? '/storage/' + settings.pdf_logo_path.replace(/^\/+/, '') : ''

  const exportPdf = async () => {
    if (!paperRef.current) return
    setExporting(true)
    try {
      await html2pdf()
        .set({
          margin: [8, 8, 8, 8],
          filename: `${data.invoice_no}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
        } as any)
        .from(paperRef.current)
        .save()
    } catch (e: any) {
      message.error('导出失败：' + (e?.message || ''))
    } finally {
      setExporting(false)
    }
  }

  const isPaid = !!data.paid_at
  const isOverdue =
    !isPaid && data.invoice_due_at && new Date(data.invoice_due_at) < new Date()

  return (
    <div className="inv-page">
      <style>{styles}</style>

      <div className="inv-toolbar no-print">
        <Space size={8}>
          <Button type="primary" size="large" icon={<DownloadOutlined />} loading={exporting} onClick={exportPdf}>
            导出 PDF
          </Button>
          <Button size="large" icon={<PrinterOutlined />} onClick={() => window.print()}>
            打印
          </Button>
        </Space>
      </div>

      <div className="inv-paper" ref={paperRef}>
        <div className="inv-accent-bar" />

        <div className="inv-header">
          <div className="inv-header-left">
            {logoUrl && (
              <img
                className="inv-logo"
                src={logoUrl}
                alt=""
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            )}
            <div className="inv-company-name">{companyName}</div>
          </div>
          <div className="inv-header-right">
            <div className="inv-title-cn">
              <span className="title-en">INVOICE</span>
              发票
            </div>
            <div className="inv-no">
              发票号 <strong>{data.invoice_no}</strong>
            </div>
          </div>
        </div>

        {/* 已付 / 逾期 印章 */}
        {isPaid && <div className="stamp stamp-paid">PAID 已收款</div>}
        {isOverdue && <div className="stamp stamp-overdue">OVERDUE 已逾期</div>}

        <div className="inv-meta-grid">
          <div className="meta-cell">
            <span className="k">客户</span>
            <span className="v">
              {customer?.name || '-'}{customer?.company ? ` / ${customer.company}` : ''}
            </span>
          </div>
          <div className="meta-cell">
            <span className="k">联系电话</span>
            <span className="v">{customer?.phone || '-'}</span>
          </div>
          <div className="meta-cell">
            <span className="k">签发日</span>
            <span className="v">{(data.invoice_issued_at || '').slice(0, 10)}</span>
          </div>
          <div className="meta-cell">
            <span className="k">到期日</span>
            <span className="v" style={{ color: isOverdue ? '#cf1322' : undefined, fontWeight: 600 }}>
              {(data.invoice_due_at || '').slice(0, 10)}
            </span>
          </div>
          <div className="meta-cell">
            <span className="k">关联报价</span>
            <span className="v">{data.no}</span>
          </div>
          <div className="meta-cell">
            <span className="k">货币 / 税点</span>
            <span className="v">
              {currency}（{currency === 'IDR' ? '印尼盾' : '人民币'}） · {taxIncluded ? '含税' : '不含税'} VAT {(taxRate * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        <table className="inv-items">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>产品名称</th>
              <th>规格</th>
              <th>品牌 / 型号</th>
              <th style={{ width: 56 }}>数量</th>
              <th style={{ width: 46 }}>单位</th>
              <th style={{ width: 88 }}>单价 ({sym})</th>
              <th style={{ width: 100 }}>金额 ({sym})</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it: any, idx: number) => (
              <tr key={it.id}>
                <td>{idx + 1}</td>
                <td className="item-name">{it.product_name}</td>
                <td>{it.spec || '-'}</td>
                <td>
                  {it.show_brand ? (
                    <span>{it.brand_display}{it.model_display ? ` / ${it.model_display}` : ''}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="num">{Number(it.qty).toLocaleString()}</td>
                <td>{it.unit}</td>
                <td className="num">{fmt(Number(it.sell_price))}</td>
                <td className="num strong">{fmt(Number(it.sell_price) * Number(it.qty))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="inv-subtotal">
          <div className="row"><span>不含税金额</span><span className="num">{sym} {fmt(netAmount)}</span></div>
          <div className="row"><span>税额（{(taxRate * 100).toFixed(0)}% VAT）</span><span className="num">{sym} {fmt(taxAmount)}</span></div>
        </div>
        <div className="inv-total-row">
          <div className="total-label">应付总额</div>
          <div className="total-value">{sym} {fmt(grandTotal)}</div>
        </div>

        {/* 收款信息 */}
        <div className="inv-bank">
          <div className="inv-bank-title">收款账户 / Bank Transfer</div>
          <div className="inv-bank-grid">
            <div><span className="k">银行 Bank</span><span className="v">{settings.bank_name || '-'}</span></div>
            <div><span className="k">账号 Account No.</span><span className="v" style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700 }}>{settings.bank_account_no || '-'}</span></div>
            <div><span className="k">账户名 Account Name</span><span className="v">{settings.bank_account_name || '-'}</span></div>
            {settings.bank_swift && (
              <div><span className="k">SWIFT</span><span className="v">{settings.bank_swift}</span></div>
            )}
          </div>
          <div className="inv-bank-note">
            请于到期日前付款，转账时备注发票号 <strong>{data.invoice_no}</strong>。Please transfer before due date and include invoice number as remark.
          </div>
        </div>

        {data.remark && (
          <div className="inv-block">
            <h4>备注</h4>
            <p>{data.remark}</p>
          </div>
        )}

        <div className="inv-footer">
          {settings.company_address || ''}
          {settings.company_phone ? `  ·  Tel: ${settings.company_phone}` : ''}
        </div>
      </div>
    </div>
  )
}

const BRAND = '#1d57e0'

const styles = `
.inv-page { background: #f0f2f5; min-height: 100vh; padding: 32px 0 64px; }
.inv-toolbar { max-width: 820px; margin: 0 auto 20px; display: flex; align-items: center; }
.inv-paper {
  background: #fff;
  width: 820px;
  margin: 0 auto;
  padding: 0 0 56px;
  box-shadow: 0 4px 24px rgba(0, 32, 96, 0.1);
  color: #1f1f1f;
  font-family: "PingFang SC", "Microsoft YaHei", -apple-system, sans-serif;
  font-size: 13px;
  line-height: 1.7;
  position: relative;
  overflow: hidden;
}
.inv-accent-bar { height: 8px; background: linear-gradient(90deg, ${BRAND} 0%, #4096ff 100%); }
.inv-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 56px 18px;
  border-bottom: 1px solid #f0f0f0;
}
.inv-header-left { display: flex; align-items: center; gap: 12px; }
.inv-logo { width: 52px; height: 52px; object-fit: contain; }
.inv-company-name { font-size: 22px; font-weight: 700; letter-spacing: 3px; }
.inv-header-right { text-align: right; line-height: 1.2; }
.inv-title-cn {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 4px;
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 12px;
}
.title-en { font-size: 11px; letter-spacing: 4px; color: ${BRAND}; font-weight: 600; }
.inv-no { font-size: 12px; color: #8c8c8c; margin-top: 6px; }
.inv-no strong { color: ${BRAND}; font-weight: 600; }

/* 印章 */
.stamp {
  position: absolute;
  top: 140px;
  right: 56px;
  padding: 10px 24px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 4px;
  border: 4px solid;
  border-radius: 8px;
  transform: rotate(-12deg);
  opacity: 0.85;
  z-index: 5;
}
.stamp-paid { color: #389e0d; border-color: #389e0d; }
.stamp-overdue { color: #cf1322; border-color: #cf1322; }

.inv-meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin: 20px 56px 24px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  overflow: hidden;
}
.meta-cell {
  padding: 10px 16px;
  border-right: 1px solid #f0f0f0;
  border-bottom: 1px solid #f0f0f0;
  display: flex; gap: 12px;
}
.meta-cell:nth-child(2n) { border-right: none; }
.meta-cell:nth-last-child(-n+2) { border-bottom: none; }
.meta-cell .k { color: #8c8c8c; min-width: 80px; }
.meta-cell .v { color: #1f1f1f; font-weight: 500; }

.inv-items { width: calc(100% - 112px); margin: 0 56px 16px; border-collapse: collapse; }
.inv-items th, .inv-items td {
  padding: 10px 12px; border-bottom: 1px solid #f0f0f0; text-align: left; vertical-align: top;
}
.inv-items thead th {
  background: ${BRAND}; color: #fff; font-weight: 500; border-bottom: none;
  font-size: 12px; letter-spacing: 1px;
}
.inv-items thead th:first-child { border-top-left-radius: 6px; }
.inv-items thead th:last-child { border-top-right-radius: 6px; }
.inv-items tbody tr:nth-child(even) td { background: #fafbfc; }
.inv-items .item-name { font-weight: 500; }
.inv-items .num { text-align: right; font-variant-numeric: tabular-nums; }
.inv-items .strong { color: ${BRAND}; font-weight: 600; }
.inv-items .muted { color: #bfbfbf; }

.inv-subtotal { margin: 0 56px; padding: 8px 24px; font-size: 12px; color: #595959; }
.inv-subtotal .row { display: flex; justify-content: flex-end; gap: 32px; padding: 4px 0; }
.inv-subtotal .num { min-width: 140px; text-align: right; font-variant-numeric: tabular-nums; }
.inv-total-row {
  margin: 0 56px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  background: linear-gradient(90deg, #f0f5ff 0%, #e6f0ff 100%);
  padding: 14px 24px;
  border-radius: 6px;
}
.total-label { font-size: 14px; color: #595959; margin-right: 24px; letter-spacing: 2px; }
.total-value { font-size: 24px; font-weight: 700; color: ${BRAND}; font-variant-numeric: tabular-nums; }

/* 银行收款卡 */
.inv-bank {
  margin: 24px 56px 0;
  border: 2px dashed ${BRAND};
  border-radius: 8px;
  padding: 16px 20px;
  background: linear-gradient(135deg, #fafcff 0%, #f0f5ff 100%);
}
.inv-bank-title {
  font-size: 14px;
  font-weight: 700;
  color: ${BRAND};
  letter-spacing: 2px;
  margin-bottom: 10px;
}
.inv-bank-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 24px;
  font-size: 13px;
}
.inv-bank-grid > div { display: flex; gap: 12px; }
.inv-bank-grid .k { color: #8c8c8c; min-width: 110px; }
.inv-bank-grid .v { color: #1f1f1f; font-weight: 500; }
.inv-bank-note { margin-top: 12px; font-size: 12px; color: #595959; }
.inv-bank-note strong { color: ${BRAND}; }

.inv-block { margin: 16px 56px 0; background: #fafbfc; padding: 12px 16px; border-left: 3px solid ${BRAND}; border-radius: 0 4px 4px 0; }
.inv-block h4 { margin: 0 0 6px; font-size: 13px; color: #595959; font-weight: 600; }
.inv-block p { margin: 0; color: #595959; font-size: 12px; }
.inv-footer { margin: 32px 56px 0; padding-top: 16px; border-top: 1px dashed #e8e8e8; text-align: center; font-size: 11px; color: #bfbfbf; letter-spacing: 1px; }

@media print {
  body { background: #fff; }
  .inv-page { background: #fff; padding: 0; }
  .no-print { display: none !important; }
  .inv-paper { width: 100%; box-shadow: none; margin: 0; padding-bottom: 24px; }
  .inv-items thead th, .inv-accent-bar, .inv-total-row, .inv-bank, .stamp { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 10mm 12mm; }
}
`
