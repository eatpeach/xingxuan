import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Segmented, Spin } from 'antd'
import { api } from '../api'
import { currencyLabel, getPrintLang, PRINT_LANGS, pt, setPrintLang, type PrintLang } from './printI18n'

/**
 * 客户报价单 打印 / 导出 PDF 页
 * 工具栏只留语言切换；导出走浏览器 Cmd/Ctrl+P → 「另存为 PDF」
 */
export default function QuotePrintPage() {
  const { id } = useParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [companyName, setCompanyName] = useState('星选建材')
  const [logoPath, setLogoPath] = useState<string>('/storage/brand/logo.png')
  const [customer, setCustomer] = useState<any>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [lang, setLang] = useState<PrintLang>(getPrintLang())
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
    <div className="doc-page">
      <style>{printStyles}</style>

      <div className="doc-toolbar no-print">
        <Segmented
          size="large"
          value={lang}
          onChange={(v) => {
            setLang(v as PrintLang)
            setPrintLang(v as PrintLang)
          }}
          options={PRINT_LANGS.map((o) => ({ label: o.label, value: o.value }))}
        />
      </div>

      <div className="doc-paper">
        {/* 顶部灰底带 */}
        <div className="doc-head">
          <div className="doc-head-left">
            <img
              className="doc-logo"
              src={logoPath}
              alt=""
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
            <div>
              <div className="doc-org-name">{companyName}</div>
              <div className="doc-org-sub">印尼建材集采平台</div>
            </div>
          </div>
          <div className="doc-head-right">
            <div className="doc-kind">{L('quoteTitleEn')}</div>
            <div className="doc-no">
              {L('quoteNo')}: <strong>{data.no}</strong>
            </div>
          </div>
        </div>

        <div className="doc-body">
          {/* 左：客户；右：日期 / 有效期 / 生产周期 */}
          <div className="doc-info-row">
            <div className="doc-billto">
              <span className="doc-billto-label">{L('customer')}</span>
              <div className="doc-billto-name">{customer?.name || '-'}</div>
              <div className="doc-billto-lines">
                {customer?.company && <>{customer.company}<br /></>}
                {customer?.phone && <>{customer.phone}<br /></>}
                {customer?.email}
              </div>
            </div>
            <div className="doc-meta-col">
              <div><span className="mk">{L('docDate')}</span><strong>{(data.created_at || '').slice(0, 10)}</strong></div>
              <div><span className="mk">{L('validUntil')}</span><strong>{(data.valid_until || '').slice(0, 10) || '-'}</strong></div>
              {data.production_cycle && (
                <div><span className="mk">{L('productionCycle')}</span><strong>{data.production_cycle}</strong></div>
              )}
            </div>
          </div>

          {/* 明细 */}
          <table className="doc-items">
            <thead>
              <tr>
                <th style={{ width: '5%' }}>#</th>
                <th style={{ width: '45%' }}>{L('colProduct')}</th>
                <th style={{ width: '16%' }} className="num">
                  {L('colUnitPrice')} ({sym})
                </th>
                <th style={{ width: '10%' }} className="center">{L('colQty')}</th>
                <th style={{ width: '24%' }} className="num">
                  {L('colAmount')} ({sym})
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it: any, idx: number) => {
                const sub = [
                  it.spec,
                  it.show_brand ? [it.brand_display, it.model_display].filter(Boolean).join(' / ') : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <tr key={it.id || idx}>
                    <td className="idx">{idx + 1}.</td>
                    <td>
                      <div className="desc-main">{it.product_name}</div>
                      {sub && <div className="desc-sub">{sub}</div>}
                    </td>
                    <td className="num">{fmt(Number(it.sell_price))}</td>
                    <td className="center">
                      {Number(it.qty).toLocaleString()} {it.unit}
                    </td>
                    <td className="num">{fmt(Number(it.sell_price) * Number(it.qty))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* 合计 */}
          <div className="doc-totals">
            <div className="doc-total-row">
              <span>{L('subtotalExTax')}</span>
              <span className="v">
                {sym} {fmt(netAmount)}
              </span>
            </div>
            <div className="doc-total-row">
              <span>
                {L('taxAmount')} · VAT {(taxRate * 100).toFixed((taxRate * 100) % 1 === 0 ? 0 : 2)}%
              </span>
              <span className="v">
                {sym} {fmt(taxAmount)}
              </span>
            </div>
            <div className="doc-grand">
              <span className="k">{taxIncluded ? L('totalIncl') : L('totalAfterTax')}</span>
              <span className="v">
                {sym} {fmt(grandTotal)}
              </span>
            </div>
          </div>

          {currency === 'CNY' && lang === 'cn' && (
            <div className="doc-total-cn">
              人民币（大写）：<strong>{numberToChinese(grandTotal)}</strong>
            </div>
          )}

          {/* 落款 */}
          <div className="doc-sign">
            <div className="doc-sign-role">{L('regards')}</div>
            <div className="doc-sign-line" />
            <div className="doc-sign-name">{companyName}</div>
          </div>
        </div>

        {/* 三栏页脚 */}
        <div className="doc-foot">
          <div>
            <h5>{L('contactUs')}</h5>
            {settings.company_phone || ''}
            {settings.company_address && (
              <>
                <br />
                {settings.company_address}
              </>
            )}
          </div>
          <div>
            <h5>{L('notes')}</h5>
            {taxIncluded ? L('noteTaxIncl') : L('noteTaxExcl')} (VAT{' '}
            {(taxRate * 100).toFixed((taxRate * 100) % 1 === 0 ? 0 : 2)}%)
            <br />
            {L('noteCurrency')}: {currencyLabel(lang, currency)}
          </div>
          <div>
            <h5>{L('termsTitle')}</h5>
            {L('noteValidity')}
            <br />
            {L('noteTerms')}
            <br />
            {L('noteContract')}
          </div>
        </div>

        {data.remark && (
          <div className="doc-remark">
            <h5>{L('colRemark')}</h5>
            <div>{data.remark}</div>
          </div>
        )}
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
.doc-page { background: #eef0f4; min-height: 100vh; padding: 24px; font-family: "PingFang SC","Microsoft YaHei",-apple-system,sans-serif; }
.doc-toolbar { width: 820px; margin: 0 auto 16px; display: flex; justify-content: flex-end; }
.doc-paper {
  width: 820px; margin: 0 auto; background: #fff; color: #1f1f1f;
  box-shadow: 0 4px 24px rgba(0,32,96,.10); position: relative; overflow: hidden;
  font-size: 13px; line-height: 1.7;
}
.doc-head { display: flex; align-items: center; justify-content: space-between; background: #f4f5f7; padding: 30px 56px; }
.doc-head-left { display: flex; align-items: center; gap: 10px; }
.doc-logo { width: 62px; height: 62px; object-fit: contain; flex-shrink: 0; }
.doc-org-name { font-size: 21px; font-weight: 800; letter-spacing: 1.5px; line-height: 1.15; }
.doc-org-sub { font-size: 10px; color: #8c8c8c; letter-spacing: 1.6px; margin-top: 5px; }
.doc-head-right { text-align: right; flex-shrink: 0; padding-left: 24px; }
.doc-kind { font-size: 28px; font-weight: 800; letter-spacing: 3px; line-height: 1; }
.doc-no { font-size: 11.5px; color: #595959; margin-top: 9px; letter-spacing: .4px; }
.doc-no strong { color: #1f1f1f; }

.doc-body { padding: 30px 56px 0; }
.doc-info-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 40px; margin-bottom: 6px; }
.doc-billto { text-align: left; min-width: 0; }
.doc-billto-label { display: block; font-size: 10.5px; letter-spacing: 2px; color: #8c8c8c; text-transform: uppercase; margin-bottom: 6px; }
.doc-billto-name { font-size: 20px; font-weight: 800; line-height: 1.25; }
.doc-billto-lines { font-size: 11.5px; color: #595959; margin-top: 6px; line-height: 1.7; }
.doc-meta-col { text-align: right; font-size: 11.5px; color: #595959; line-height: 2.1; flex-shrink: 0; }
.doc-meta-col .mk { color: #8c8c8c; letter-spacing: 1px; margin-right: 10px; }
.doc-meta-col strong { color: #1f1f1f; font-weight: 600; }

.doc-items { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 12px; }
.doc-items thead th { font-size: 11.5px; font-weight: 700; text-align: left; padding: 12px 8px; border-bottom: 1.5px solid #1f1f1f; white-space: nowrap; }
.doc-items tbody td { padding: 13px 8px; border-bottom: 1px solid #ededed; vertical-align: top; }
.doc-items tbody tr:last-child td { border-bottom: none; }
.doc-items .idx { font-weight: 700; }
.doc-items .desc-main { font-weight: 500; overflow-wrap: anywhere; }
.doc-items .desc-sub { color: #8c8c8c; font-size: 11.5px; overflow-wrap: anywhere; }
.doc-items .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.doc-items .center { text-align: center; white-space: nowrap; }

.doc-totals { margin: 18px 0 0 auto; width: 330px; }
.doc-total-row { display: flex; justify-content: space-between; align-items: baseline; gap: 20px; padding: 5px 0; font-size: 11.5px; letter-spacing: 1.2px; color: #8c8c8c; }
.doc-total-row .v { font-size: 13px; color: #1f1f1f; letter-spacing: 0; font-variant-numeric: tabular-nums; font-weight: 600; }
.doc-grand { display: flex; justify-content: space-between; align-items: baseline; gap: 20px; margin-top: 10px; padding-top: 12px; border-top: 1.5px solid #1f1f1f; }
.doc-grand .k { font-size: 12px; font-weight: 800; letter-spacing: 1.2px; }
.doc-grand .v { font-size: 21px; font-weight: 900; color: ${BRAND}; font-variant-numeric: tabular-nums; white-space: nowrap; }

.doc-sign { margin-top: 34px; text-align: right; }
.doc-sign-role { font-size: 10.5px; letter-spacing: 1.6px; color: #8c8c8c; }
.doc-sign-line { width: 190px; height: 1px; background: #d9d9d9; margin: 42px 0 7px auto; }
.doc-sign-name { font-size: 11.5px; color: #595959; }

.doc-foot { margin-top: 30px; padding: 22px 56px 30px; border-top: 1px solid #ededed; display: grid; grid-template-columns: 1fr 1.1fr 1.2fr; gap: 30px; font-size: 11px; color: #8c8c8c; line-height: 1.75; }
.doc-foot h5 { margin: 0 0 7px; font-size: 12px; font-weight: 800; color: #1f1f1f; }
.doc-foot .kv { display: flex; gap: 6px; }
.doc-foot .kv span:first-child { color: #bfbfbf; min-width: 62px; flex-shrink: 0; }
.doc-foot .kv span:last-child { color: #595959; overflow-wrap: anywhere; }

.stamp-paid { position: absolute; top: 190px; right: 60px; transform: rotate(-14deg); border: 3px solid #52c41a; color: #52c41a; font-size: 26px; font-weight: 900; letter-spacing: 3px; padding: 5px 18px; border-radius: 6px; opacity: .8; }

@media print {
  .doc-page { background: #fff; padding: 0; }
  .no-print { display: none !important; }
  .doc-paper { box-shadow: none; width: 100%; }
}
.doc-total-cn { margin-top: 10px; text-align: right; font-size: 12px; color: #595959; }
.doc-remark { padding: 0 56px 26px; font-size: 11.5px; color: #595959; }
.doc-remark h5 { margin: 0 0 6px; font-size: 12px; font-weight: 800; color: #1f1f1f; }

`
