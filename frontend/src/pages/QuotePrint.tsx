import React, { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Segmented, Spin, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import { currencyLabel, getPrintLang, PRINT_LANGS, pt, setPrintLang, type PrintLang } from './printI18n'
// @ts-ignore
import html2canvas from 'html2canvas'
// @ts-ignore
import jsPDF from 'jspdf'

/**
 * 客户报价单 导出 PDF 页
 * 工具栏悬浮在窗口右侧（下载 + 语言切换），打印时 no-print 隐藏
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
  const hideBrokenImg = (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = 'none'
  }

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
  // 税率 0 视为「这单不涉税」：不拆净额/税额，合计就是总价
  // 逐行交期：一行都没填就不印这一列，保持老报价单版式原样（之前调过右边裁切，不要再动列宽）
  const hasLeadTime = (data.items || []).some((it: any) => String(it.lead_time || '').trim() !== '')
  const sumSpan = hasLeadTime ? 6 : 5

  const hasTax = taxRate > 0
  const netAmount = !hasTax ? total : taxIncluded ? total / (1 + taxRate) : total
  const taxAmount = !hasTax ? 0 : taxIncluded ? total - netAmount : total * taxRate
  const grandTotal = !hasTax || taxIncluded ? total : total + taxAmount

  // 与发票页同一套实现（html2canvas 截图 → jsPDF 按 A4 切页），避免再引入 html2pdf.js
  const exportPdf = async () => {
    if (!paperRef.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(paperRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      })
      const pdf = new jsPDF('p', 'mm', 'a4')
      const margin = 8 // mm 留白
      const contentW = pdf.internal.pageSize.getWidth() - margin * 2
      const contentH = pdf.internal.pageSize.getHeight() - margin * 2
      const imgH = (canvas.height * contentW) / canvas.width

      if (imgH <= contentH) {
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, contentW, imgH)
      } else {
        // 超长 → 按页切片
        const pageImgH = (canvas.width * contentH) / contentW // 每页对应原图高度
        const totalPages = Math.ceil(canvas.height / pageImgH)
        for (let i = 0; i < totalPages; i++) {
          if (i > 0) pdf.addPage()
          const sy = i * pageImgH
          const sh = Math.min(pageImgH, canvas.height - sy)
          const slice = document.createElement('canvas')
          slice.width = canvas.width
          slice.height = sh
          const ctx = slice.getContext('2d')!
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, slice.width, slice.height)
          ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh)
          pdf.addImage(
            slice.toDataURL('image/jpeg', 0.95),
            'JPEG',
            margin,
            margin,
            contentW,
            (sh * contentW) / canvas.width,
          )
        }
      }
      pdf.save(`${data.no || 'quotation'}.pdf`)
    } catch (e: any) {
      message.error('导出失败：' + (e?.message || ''))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="doc-page">
      <style>{printStyles}</style>

      {/* 悬浮在窗口右侧，不占纸张版面 */}
      <div className="doc-toolbar no-print">
        <Button
          type="primary"
          size="large"
          icon={<DownloadOutlined />}
          loading={exporting}
          onClick={exportPdf}
        >
          {L('exportPdf')}
        </Button>
        <Segmented
          value={lang}
          onChange={(v) => {
            setLang(v as PrintLang)
            setPrintLang(v as PrintLang)
          }}
          options={PRINT_LANGS.map((o) => ({ label: o.label, value: o.value }))}
        />
      </div>

      <div className="doc-paper" ref={paperRef}>
        {/* 抬头：左品牌 / 右单据名 */}
        <div className="q-head">
          <img className="q-logo" src={logoPath} alt="" onError={hideBrokenImg} />
          <div className="q-org">
            <div className="q-org-name">{companyName}</div>
            {lang === 'cn' && <div className="q-org-sub">XINGXUAN</div>}
          </div>
          <div className="q-title-box">
            <div className="q-title">{L('quoteTitle')}</div>
            <div className="q-title-sub">{L('quoteTitleEn')}</div>
          </div>
        </div>
        <div className="q-rule" />

        {/* 客户 / 单据信息 */}
        <div className="q-meta">
          <div className="q-meta-l">
            {L('customer')}: <strong>{customer?.company || customer?.name || '-'}</strong>
          </div>
          <div className="q-meta-r">
            <div>{L('docDate')}: <strong>{(data.created_at || '').slice(0, 10)}</strong></div>
            <div>{L('quoteNo')}: <strong>{data.no}</strong></div>
            <div>{L('noteCurrency')}: <strong>{currency}</strong></div>
            {data.valid_until && (
              <div>{L('validUntil')}: <strong>{data.valid_until.slice(0, 10)}</strong></div>
            )}
            {data.production_cycle && (
              <div>{L('productionCycle')}: <strong>{data.production_cycle}</strong></div>
            )}
          </div>
        </div>

        {/* 明细 */}
        <table className="q-table">
          <thead>
            <tr>
              <th style={{ width: 44 }}>{L('colNo')}</th>
              <th>{L('colProduct')}</th>
              <th style={{ width: 150 }}>{L('colSpec')}</th>
              <th style={{ width: 82 }} className="center">{L('colQty')}</th>
              {hasLeadTime && <th style={{ width: 96 }} className="center">{L('colLeadTime')}</th>}
              <th style={{ width: 118 }} className="num">{L('colUnitPrice')}({sym})</th>
              <th style={{ width: 128 }} className="num">{L('colAmount')}({sym})</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it: any, idx: number) => {
              const brand = it.show_brand
                ? [it.brand_display, it.model_display].filter(Boolean).join(' / ')
                : ''
              return (
                <tr key={it.id || idx}>
                  <td className="center">{idx + 1}</td>
                  <td>
                    {it.product_name}
                    {brand && <div className="q-sub">{brand}</div>}
                  </td>
                  <td>{it.spec || '-'}</td>
                  <td className="center">
                    {Number(it.qty).toLocaleString()} {it.unit}
                  </td>
                  {hasLeadTime && (
                    <td className="center">{it.lead_time || data.production_cycle || '-'}</td>
                  )}
                  <td className="num">{fmt(Number(it.sell_price))}</td>
                  <td className="num">{fmt(Number(it.sell_price) * Number(it.qty))}</td>
                </tr>
              )
            })}
            {/* 税率 0 = 这单不涉税：净额和税额两行都不印，只留一行合计，
                否则会出现「小计 = 合计、税额 VAT 0% = 0」这种废话行 */}
            {hasTax && (
              <>
                <tr className="q-sum">
                  <td colSpan={sumSpan} className="num">{L('subtotalExTax')}</td>
                  <td className="num">{fmt(netAmount)}</td>
                </tr>
                <tr className="q-sum">
                  <td colSpan={sumSpan} className="num">
                    {L('taxAmount')} · VAT {(taxRate * 100).toFixed((taxRate * 100) % 1 === 0 ? 0 : 2)}%
                  </td>
                  <td className="num">{fmt(taxAmount)}</td>
                </tr>
              </>
            )}
            <tr className="q-grand">
              <td colSpan={sumSpan} className="num">
                {/* 税只有加和没有两种；存量的价内含税单据仍走 totalIncl，不改历史单据的口径 */}
                {!hasTax ? L('totalLabel') : taxIncluded ? L('totalIncl') : L('totalAfterTax')}
              </td>
              <td className="num">{sym} {fmt(grandTotal)}</td>
            </tr>
          </tbody>
        </table>

        {currency === 'CNY' && lang === 'cn' && (
          <div className="q-upper">
            人民币（大写）：<strong>{numberToChinese(grandTotal)}</strong>
          </div>
        )}

        {/* 说明 / 条款 */}
        <div className="q-notes">
          {hasTax && (
            <div>* {taxIncluded ? L('noteTaxIncl') : L('noteTaxExcl')} (VAT {(taxRate * 100).toFixed((taxRate * 100) % 1 === 0 ? 0 : 2)}%)</div>
          )}
          <div>* {L('noteCurrency')}: {currencyLabel(lang, currency)}</div>
          <div>* {L('noteValidity')}</div>
          <div>* {L('noteTerms')}</div>
          <div>* {L('noteContract')}</div>
          {(settings.company_phone || settings.company_address) && (
            <div>
              * {L('contactUs')}: {[settings.company_phone, settings.company_address].filter(Boolean).join(' · ')}
            </div>
          )}
          {data.remark && (
            <>
              <div className="q-notes-gap" />
              <div className="q-notes-strong">{L('colRemark')}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{data.remark}</div>
            </>
          )}
        </div>

        {/* 页脚 */}
        <div className="q-foot">
          <img className="q-foot-logo" src={logoPath} alt="" onError={hideBrokenImg} />
          <div>
            <div className="q-foot-name">{companyName} · {L('companySlogan')}</div>
            {settings.company_phone && <div className="q-foot-sub">{settings.company_phone}</div>}
          </div>
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
.doc-page { background: #eef0f4; min-height: 100vh; padding: 24px; font-family: "PingFang SC","Microsoft YaHei",-apple-system,sans-serif; }
/* 悬浮工具栏：贴窗口右侧垂直居中，纸张保持整页居中不被挤 */
.doc-toolbar {
  position: fixed; right: 24px; top: 50%; transform: translateY(-50%); z-index: 10;
  width: 190px; display: flex; flex-direction: column; gap: 10px;
  padding: 14px; background: #fff; border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0,0,0,.12);
}
.doc-toolbar .ant-btn, .doc-toolbar .ant-segmented { width: 100%; }
/* 纸张 820px + 悬浮层 190px + 间距，窄于此就落回纸张上方 */
@media (max-width: 1320px) {
  .doc-toolbar {
    position: static; transform: none; width: 820px; max-width: 100%;
    margin: 0 auto 16px; flex-direction: row; align-items: center;
    justify-content: flex-end; box-shadow: none; background: transparent; padding: 0;
  }
  .doc-toolbar .ant-btn, .doc-toolbar .ant-segmented { width: auto; }
}
/* ===== 纸张：参考斑兔企服报价单版式（蓝分隔线 + 全边框表格 + 说明块 + 品牌页脚） ===== */
.doc-paper {
  width: 820px; margin: 0 auto; background: #fff; color: #333;
  box-shadow: 0 4px 24px rgba(0,32,96,.10);
  padding: 44px 48px 36px; font-size: 13px; line-height: 1.45;
  font-variant-numeric: tabular-nums;
}

.q-head { display: flex; align-items: center; margin-bottom: 18px; }
.q-logo { height: 50px; margin-right: 12px; object-fit: contain; }
.q-org-name { font-size: 22px; font-weight: 800; letter-spacing: 1px; line-height: 1.2; }
.q-org-sub { font-size: 11px; color: #666; letter-spacing: 1px; margin-top: 2px; }
.q-title-box { flex: 1; text-align: right; }
.q-title { font-size: 22px; font-weight: 800; }
.q-title-sub { font-size: 12px; color: #666; margin-top: 2px; }
.q-rule { border-top: 2px solid ${BRAND}; margin-bottom: 14px; }

.q-meta { display: flex; justify-content: space-between; align-items: flex-start; gap: 30px; margin-bottom: 14px; font-size: 13px; }
.q-meta-r { text-align: right; line-height: 1.85; flex-shrink: 0; }
.q-meta strong { font-weight: 600; }

/* 全边框表格：斑兔用 1px solid #333 + 表头浅灰 */
.q-table { width: 100%; border-collapse: collapse; table-layout: fixed; word-break: keep-all; overflow-wrap: anywhere; }
.q-table th, .q-table td { border: 1px solid #333; padding: 8px 10px; text-align: left; vertical-align: top; line-height: 1.45; }
.q-table th { background: #f5f5f5; font-weight: 600; font-size: 14px; }
.q-table td { font-size: 13px; }
.q-table .num { text-align: right; white-space: nowrap; }
.q-table .center { text-align: center; }
.q-sub { color: #888; font-size: 12px; margin-top: 2px; }
/* 合计三行并进表格，避免 PDF 分页时和明细断开 */
.q-sum td { background: #fafafa; font-weight: bold; }
.q-grand td { background: #f0f0f0; font-weight: bold; font-size: 14px; }
.q-grand td:last-child { color: ${BRAND}; }

.q-upper { margin-top: 10px; text-align: right; font-size: 12px; color: #595959; }

.q-notes { margin-top: 20px; padding: 12px 14px; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 4px; font-size: 11px; line-height: 1.7; color: #666; }
.q-notes-gap { height: 8px; }
.q-notes-strong { font-weight: 600; color: #222; }

/* 落款块（此致/BEST REGARDS）已按 20260808-04 号单删除，页脚间距相应加大 */
.q-foot { border-top: 2px solid ${BRAND}; margin-top: 28px; padding-top: 12px; display: flex; align-items: center; }
.q-foot-logo { height: 36px; margin-right: 10px; object-fit: contain; }
.q-foot-name { font-size: 13px; font-weight: bold; }
.q-foot-sub { font-size: 12px; color: #666; }

@media print {
  .doc-page { background: #fff; padding: 0; }
  .no-print { display: none !important; }
  .doc-paper { box-shadow: none; width: 100%; padding: 20px; }
  .q-table tr, .q-table thead { page-break-inside: avoid; }
}
`
