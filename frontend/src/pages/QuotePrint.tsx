import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Segmented, Space, Spin, message } from 'antd'
import { DownloadOutlined, PrinterOutlined } from '@ant-design/icons'
import { api } from '../api'
import { currencyLabel, getPrintLang, PRINT_LANGS, pt, setPrintLang, type PrintLang } from './printI18n'

// @ts-ignore - 库无 types
import html2pdf from 'html2pdf.js'

/**
 * 客户报价单 打印 / 导出 PDF 页
 * 浏览器 Cmd/Ctrl+P → 选「另存为 PDF」即可导出
 */
export default function QuotePrintPage() {
  const { id } = useParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [companyName, setCompanyName] = useState('星选建材')
  const [logoPath, setLogoPath] = useState<string>('/storage/brand/logo.png')
  const [customer, setCustomer] = useState<any>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [exporting, setExporting] = useState(false)
  const [lang, setLang] = useState<PrintLang>(getPrintLang())
  const paperRef = useRef<HTMLDivElement>(null)
  const L = (k: Parameters<typeof pt>[1]) => pt(lang, k)

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
        if (sm.company_name) setCompanyName(sm.company_name)
        if (sm.pdf_logo_path)
          setLogoPath('/storage/' + sm.pdf_logo_path.replace(/^\/+/, ''))

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
  if (!data) return <div style={{ padding: 24 }}>{pt(lang, 'quoteNotFound')}</div>

  const total = Number(data.total || 0)
  const currency = (data.currency || 'IDR') as 'IDR' | 'CNY'
  const taxIncluded = !!Number(data.tax_included ?? 1)
  const taxRate = Number(data.tax_rate ?? 0.11)
  const sym = currency === 'IDR' ? 'Rp' : '¥'
  const fmt = (n: number) =>
    currency === 'IDR'
      ? Math.round(n).toLocaleString('id-ID')
      : n.toLocaleString(undefined, { minimumFractionDigits: 2 })
  // 总价是含税或不含税的最终总价；为了显示税额需要拆出净额和税额
  const netAmount = taxIncluded ? total / (1 + taxRate) : total
  const taxAmount = taxIncluded ? total - netAmount : total * taxRate
  const grandTotal = taxIncluded ? total : total + taxAmount

  return (
    <div className="quote-page">
      <style>{printStyles}</style>

      <div className="quote-toolbar no-print">
        <Space size={8}>
          <Button
            type="primary"
            size="large"
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={async () => {
              if (!paperRef.current) return
              setExporting(true)
              try {
                const opt: any = {
                  margin: [8, 8, 8, 8],
                  filename: `${data.no || '报价单'}.pdf`,
                  image: { type: 'jpeg', quality: 0.98 },
                  html2canvas: {
                    scale: 2,
                    useCORS: true,
                    backgroundColor: '#ffffff',
                  },
                  jsPDF: {
                    unit: 'mm',
                    format: 'a4',
                    orientation: 'portrait',
                  },
                  pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
                }
                await html2pdf().set(opt).from(paperRef.current).save()
              } catch (e: any) {
                message.error('导出失败：' + (e?.message || ''))
              } finally {
                setExporting(false)
              }
            }}
          >
            {L('exportPdf')}
          </Button>
          <Button
            size="large"
            icon={<PrinterOutlined />}
            onClick={() => window.print()}
          >
            {L('print')}
          </Button>
          <Segmented
            size="large"
            value={lang}
            onChange={(v) => {
              setLang(v as PrintLang)
              setPrintLang(v as PrintLang)
            }}
            options={PRINT_LANGS.map((o) => ({ label: o.label, value: o.value }))}
          />
        </Space>
      </div>

      <div className="quote-paper" ref={paperRef}>
        <div className="quote-accent-bar" />

        <div className="quote-header">
          <div className="quote-header-left">
            <img
              className="quote-logo"
              src={logoPath}
              alt=""
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
            <div className="quote-company-name">{companyName}</div>
          </div>
          <div className="quote-header-right">
            <div className="quote-title-cn">
              <span className="title-en">{L('quoteTitleEn')}</span>
              {L('quoteTitle')}
            </div>
            <div className="quote-no">
              {L('quoteNo')} <strong>{data.no}</strong>
              <span className="dot">·</span>
              {(data.created_at || '').slice(0, 10)}
            </div>
          </div>
        </div>

        <div className="quote-meta-grid">
          <div className="meta-cell">
            <span className="k">{L('customer')}</span>
            <span className="v">
              {customer?.name || '-'}
              {customer?.company ? ` / ${customer.company}` : ''}
            </span>
          </div>
          <div className="meta-cell">
            <span className="k">{L('phone')}</span>
            <span className="v">{customer?.phone || '-'}</span>
          </div>
          <div className="meta-cell">
            <span className="k">{L('email')}</span>
            <span className="v">{customer?.email || '-'}</span>
          </div>
          <div className="meta-cell">
            <span className="k">{L('validUntil')}</span>
            <span className="v" style={{ color: '#cf1322', fontWeight: 600 }}>
              {(data.valid_until || '').slice(0, 10) || '-'}
            </span>
          </div>
          {data.production_cycle && (
            <div className="meta-cell full">
              <span className="k">{L('productionCycle')}</span>
              <span className="v" style={{ color: '#1d57e0', fontWeight: 600 }}>
                {data.production_cycle}
              </span>
            </div>
          )}
        </div>

        <table className="quote-items">
          <thead>
            <tr>
              <th style={{ width: '4%' }} className="center">#</th>
              <th style={{ width: '22%' }}>{L('colProduct')}</th>
              <th style={{ width: '16%' }}>{L('colSpec')}</th>
              <th style={{ width: '17%' }}>{L('colBrandModel')}</th>
              <th style={{ width: '7%' }} className="center">{L('colQty')}</th>
              <th style={{ width: '6%' }} className="center">{L('colUnit')}</th>
              <th style={{ width: '14%' }} className="num">{L('colUnitPrice')} ({sym})</th>
              <th style={{ width: '14%' }} className="num">{L('colAmount')} ({sym})</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it: any, idx: number) => (
              <tr key={it.id}>
                <td className="center">{idx + 1}</td>
                <td className="item-name">{it.product_name}</td>
                <td>{it.spec || '-'}</td>
                <td>
                  {it.show_brand ? (
                    <span>
                      {it.brand_display}
                      {it.model_display ? ` / ${it.model_display}` : ''}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="center">{Number(it.qty).toLocaleString()}</td>
                <td className="center">{it.unit}</td>
                <td className="num">{fmt(Number(it.sell_price))}</td>
                <td className="num strong">
                  {fmt(Number(it.sell_price) * Number(it.qty))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="quote-subtotal">
          <div className="row">
            <span>{L('subtotalExTax')}</span>
            <span className="num">{sym} {fmt(netAmount)}</span>
          </div>
          <div className="row">
            <span>{L('taxAmount')}（{(taxRate * 100).toFixed(taxRate * 100 % 1 === 0 ? 0 : 2)}% VAT）</span>
            <span className="num">{sym} {fmt(taxAmount)}</span>
          </div>
        </div>
        <div className="quote-total-row">
          <div className="total-label">
            {taxIncluded ? L('totalIncl') : L('totalAfterTax')}
          </div>
          <div className="total-value">
            {sym} {fmt(grandTotal)}
          </div>
        </div>
        {currency === 'CNY' && lang === 'cn' && (
          <div className="quote-total-cn">
            人民币（大写）：<strong>{numberToChinese(grandTotal)}</strong>
          </div>
        )}

        {data.remark && (
          <div className="quote-block">
            <h4>{L('colRemark')}</h4>
            <p>{data.remark}</p>
          </div>
        )}

        <div className="quote-block">
          <h4>{L('notes')}</h4>
          <ol>
            <li>
              {taxIncluded ? L('noteTaxIncl') : L('noteTaxExcl')} (VAT{' '}
              {(taxRate * 100).toFixed((taxRate * 100) % 1 === 0 ? 0 : 2)}%) · {L('noteCurrency')}:{' '}
              {currencyLabel(lang, currency)} · {L('noteContract')}
            </li>
            <li>{L('noteValidity')}</li>
            <li>{L('noteTerms')}</li>
          </ol>
        </div>

        <div className="quote-footer">
          {settings.company_address || ''}
          {settings.company_phone ? `  ·  Tel: ${settings.company_phone}` : ''}
        </div>
      </div>
    </div>
  )
}

function numberToChinese(n: number): string {
  if (!n || isNaN(n)) return '零元整'
  const fraction = ['角', '分']
  const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
  const unit = [
    ['元', '万', '亿'],
    ['', '拾', '佰', '仟'],
  ]
  const head = n < 0 ? '欠' : ''
  n = Math.abs(n)
  let s = ''
  for (let i = 0; i < fraction.length; i++) {
    s += (digit[Math.floor(n * 10 * Math.pow(10, i)) % 10] + fraction[i]).replace(/零./, '')
  }
  s = s || '整'
  let m = Math.floor(n)
  for (let i = 0; i < unit[0].length && m > 0; i++) {
    let p = ''
    for (let j = 0; j < unit[1].length && m > 0; j++) {
      p = digit[m % 10] + unit[1][j] + p
      m = Math.floor(m / 10)
    }
    s = p.replace(/(零.)*零$/, '').replace(/^$/, '零') + unit[0][i] + s
  }
  return (
    head +
    s
      .replace(/(零.)*零元/, '元')
      .replace(/(零.)+/g, '零')
      .replace(/^整$/, '零元整')
  )
}

const BRAND = '#1d57e0'

const printStyles = `
.quote-page {
  background: #f0f2f5;
  min-height: 100vh;
  padding: 32px 0 64px;
}
.quote-toolbar {
  max-width: 820px;
  margin: 0 auto 20px;
  display: flex;
  align-items: center;
}
.quote-paper {
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
.quote-accent-bar {
  height: 8px;
  background: linear-gradient(90deg, ${BRAND} 0%, #4096ff 100%);
}
.quote-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 56px 18px;
  border-bottom: 1px solid #f0f0f0;
}
.quote-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.quote-logo {
  width: 52px;
  height: 52px;
  object-fit: contain;
}
.quote-company-name {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 3px;
  color: #1f1f1f;
}
.quote-header-right {
  text-align: right;
  line-height: 1.2;
}
.quote-title-cn {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 4px;
  color: #1f1f1f;
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 12px;
}
.title-en {
  font-size: 11px;
  letter-spacing: 4px;
  color: ${BRAND};
  font-weight: 600;
}
.quote-no {
  font-size: 12px;
  color: #8c8c8c;
  margin-top: 6px;
  letter-spacing: 0.5px;
}
.quote-no strong {
  color: ${BRAND};
  font-weight: 600;
}
.quote-no .dot {
  margin: 0 6px;
  color: #d9d9d9;
}
.quote-meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin: 20px 56px 24px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  overflow: hidden;
}
.meta-cell.full { grid-column: 1 / -1; }
.meta-cell {
  padding: 10px 16px;
  border-right: 1px solid #f0f0f0;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  gap: 12px;
}
.meta-cell:nth-child(2n) { border-right: none; }
.meta-cell:nth-last-child(-n+2) { border-bottom: none; }
.meta-cell .k {
  color: #8c8c8c;
  min-width: 64px;
}
.meta-cell .v {
  color: #1f1f1f;
  font-weight: 500;
}
.quote-items {
  width: calc(100% - 112px);
  margin: 0 56px 16px;
  border-collapse: collapse;
}
.quote-items th, .quote-items td {
  padding: 10px 12px;
  border-bottom: 1px solid #f0f0f0;
  text-align: left;
  vertical-align: top;
}
.quote-items thead th {
  background: ${BRAND};
  color: #fff;
  font-weight: 500;
  border-bottom: none;
  font-size: 12px;
  letter-spacing: 1px;
}
.quote-items thead th:first-child { border-top-left-radius: 6px; }
.quote-items thead th:last-child { border-top-right-radius: 6px; }
.quote-items tbody tr:nth-child(even) td { background: #fafbfc; }
.quote-items .item-name { font-weight: 500; }
.quote-items .num { text-align: right; font-variant-numeric: tabular-nums; }
.quote-items .strong { color: ${BRAND}; font-weight: 600; }
.quote-items .muted { color: #bfbfbf; }

.quote-subtotal {
  margin: 0 56px;
  padding: 8px 24px;
  font-size: 12px;
  color: #595959;
}
.quote-subtotal .row {
  display: flex;
  justify-content: flex-end;
  gap: 32px;
  padding: 4px 0;
}
.quote-subtotal .num { min-width: 140px; text-align: right; font-variant-numeric: tabular-nums; }
.quote-total-row {
  margin: 0 56px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  background: linear-gradient(90deg, #f0f5ff 0%, #e6f0ff 100%);
  padding: 14px 24px;
  border-radius: 6px;
}
.total-label {
  font-size: 14px;
  color: #595959;
  margin-right: 24px;
  letter-spacing: 2px;
}
.total-value {
  font-size: 22px;
  font-weight: 700;
  color: ${BRAND};
  font-variant-numeric: tabular-nums;
}
.quote-total-cn {
  margin: 8px 56px 24px;
  text-align: right;
  font-size: 12px;
  color: #595959;
}
.quote-total-cn strong { color: ${BRAND}; }

.quote-block {
  margin: 16px 56px 0;
  background: #fafbfc;
  padding: 12px 16px;
  border-left: 3px solid ${BRAND};
  border-radius: 0 4px 4px 0;
}
.quote-block h4 {
  margin: 0 0 6px;
  font-size: 13px;
  color: #595959;
  font-weight: 600;
}
.quote-block p { margin: 0; color: #595959; font-size: 12px; }
.quote-block ol {
  padding-left: 18px;
  margin: 0;
  color: #595959;
  font-size: 12px;
  line-height: 1.9;
}

.quote-sign {
  display: flex;
  justify-content: space-between;
  gap: 32px;
  margin: 48px 56px 0;
}
.quote-sign-block { flex: 1; font-size: 12px; color: #595959; }
.sign-label { font-weight: 500; color: #1f1f1f; }
.sign-line { height: 1px; background: #d9d9d9; margin: 36px 0 8px; }
.sign-date { color: #8c8c8c; }
.quote-footer {
  margin: 32px 56px 0;
  padding-top: 16px;
  border-top: 1px dashed #e8e8e8;
  text-align: center;
  font-size: 11px;
  color: #bfbfbf;
  letter-spacing: 1px;
}

@media print {
  body { background: #fff; }
  .quote-page { background: #fff; padding: 0; }
  .no-print { display: none !important; }
  .quote-paper {
    width: 100%;
    box-shadow: none;
    margin: 0;
    padding-bottom: 24px;
  }
  .quote-items thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .quote-accent-bar, .quote-total-row { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 10mm 12mm; }
}

/* ===== 排版修正：列宽百分比 / 数字右对齐 / 合计右侧成组 ===== */
.quote-items { table-layout: fixed; }
.quote-items th { white-space: nowrap; }
.quote-items td { overflow-wrap: anywhere; }
.quote-items td.num, .quote-items th.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.quote-items td.center, .quote-items th.center { text-align: center; }

.quote-totals {
  margin-left: auto;
  margin-right: 56px;
  width: 340px;
}
.quote-totals .total-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 24px;
  padding: 6px 0;
  font-size: 13px;
  color: #595959;
}
.quote-totals .total-row span:last-child {
  font-variant-numeric: tabular-nums;
  color: #1f1f1f;
}
.quote-total-main {
  margin-left: auto;
  margin-right: 56px;
  width: 340px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 24px;
  padding: 12px 0 0;
  margin-top: 8px;
  border-top: 2px solid #1d57e0;
}
.quote-total-main .total-label { font-size: 14px; font-weight: 600; color: #1f1f1f; }
.quote-total-main .total-value {
  font-size: 24px; font-weight: 800; color: #1d57e0;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
`
