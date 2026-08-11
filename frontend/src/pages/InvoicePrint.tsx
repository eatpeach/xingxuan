import React, { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Spin, message, Segmented } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import { getPrintLang, PRINT_LANGS, pt, setPrintLang, type PrintLang } from './printI18n'
// @ts-ignore
import html2canvas from 'html2canvas'
// @ts-ignore
import jsPDF from 'jspdf'

/**
 * 发票（Invoice）打印 / 下载页 — 极简双语样式
 * 参考样式：顶部大字 INVOICE / BILL TO + PO 信息 / 简洁表格 / 蓝色 TOTAL 条 / 双语条款 / 左下 TRANSFER TO + 右下 HORMAT KAMI
 */
export default function InvoicePrintPage() {
  const { id } = useParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [customer, setCustomer] = useState<any>(null)
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
  if (!data) return <div style={{ padding: 24 }}>{pt(lang, 'quoteNotFound')}</div>
  if (!data.invoice_no) {
    return (
      <div style={{ padding: 80, textAlign: 'center' }}>
        <div style={{ fontSize: 16, color: '#8c8c8c' }}>{pt(lang, 'invoiceNotIssued')}</div>
        <div style={{ marginTop: 12, fontSize: 13, color: '#bfbfbf' }}>{pt(lang, 'invoiceHint')}</div>
      </div>
    )
  }

  // 开票金额优先用快照（部分开票时 < 报价总额），老发票没这列就回落报价总额
  const total = Number(data.invoice_amount || data.total || 0)
  const isPartial = Number(data.invoice_amount || 0) > 0
    && Number(data.invoice_amount) < Number(data.total || 0) - 0.005
  const currency = (data.currency || 'IDR') as 'IDR' | 'CNY'
  const sym = currency === 'IDR' ? 'Rp' : '¥'
  const fmt = (n: number) =>
    currency === 'IDR'
      ? Math.round(n).toLocaleString('id-ID')
      : n.toLocaleString(undefined, { minimumFractionDigits: 2 })

  // total 是最终应收；含税单据要倒推净额，不含税单据 total 本身即净额
  const taxIncluded = !!Number(data.tax_included ?? 1)
  const taxRate = Number(data.tax_rate ?? 0.11)
  const netAmount = taxIncluded ? total / (1 + taxRate) : total
  const taxAmount = total - netAmount

  // 开票主体优先用开票时的快照，回落到系统设置
  const entityName = data.invoice_entity_name || settings.company_name || '星选建材'
  const entityLogo = data.invoice_entity_logo_path
    ? '/storage/' + String(data.invoice_entity_logo_path).replace(/^\/+/, '')
    : settings.pdf_logo_path
      ? '/storage/' + String(settings.pdf_logo_path).replace(/^\/+/, '')
      : '/storage/brand/logo.png'
  const hideBrokenImg = (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = 'none'
  }

  // 日期格式 11/05/2026
  const formatDate = (s: string) => {
    if (!s) return ''
    const d = new Date(s.replace(' ', 'T'))
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    return `${dd}/${mm}/${yyyy}`
  }

  const isPaid = !!data.paid_at

  // 默认双语条款（可在 system_settings.invoice_terms 覆盖，单行 JSON 或换行分隔 cn||id 格式）
  const defaultTerms: Array<[string, string]> = [
    ['结算方式：付清全款后发货', 'Settlement method: the full payment to be paid before shipment.'],
    ['交货期：现货。', 'Serah terima barang: Delivery after full payment.'],
    ['按照中国标准，如有异议应当天提出。', 'Standarisasi China, keberatan diajukan pada hari yang sama.'],
    ['交货地：工厂自提。', 'Tempat penyerahan barang: Diambil sendiri di pabrik.'],
    ['付款在银行账户收到后视为有效。', 'Pembayaran dianggap sah setelah terima di rekening bank.'],
  ]
  let terms = defaultTerms
  if (settings.invoice_terms) {
    try {
      const parsed = JSON.parse(settings.invoice_terms)
      if (Array.isArray(parsed) && parsed.every((x) => Array.isArray(x) && x.length === 2)) {
        terms = parsed
      }
    } catch {}
  }

  const exportPdf = async () => {
    if (!paperRef.current) return
    setExporting(true)
    try {
      const el = paperRef.current
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      })
      const imgData = canvas.toDataURL('image/jpeg', 0.95)

      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const margin = 8 // mm 留白
      const contentW = pageW - margin * 2
      const contentH = pageH - margin * 2

      // 按内容区宽度等比缩放
      const imgW = contentW
      const imgH = (canvas.height * imgW) / canvas.width

      if (imgH <= contentH) {
        // 单页
        pdf.addImage(imgData, 'JPEG', margin, margin, imgW, imgH)
      } else {
        // 超长 → 按页切片
        const pageImgHCanvas = (canvas.width * contentH) / contentW // 每页对应原图高度
        const totalPages = Math.ceil(canvas.height / pageImgHCanvas)
        for (let i = 0; i < totalPages; i++) {
          if (i > 0) pdf.addPage()
          const sy = i * pageImgHCanvas
          const sh = Math.min(pageImgHCanvas, canvas.height - sy)
          // 截当前页
          const slice = document.createElement('canvas')
          slice.width = canvas.width
          slice.height = sh
          const ctx = slice.getContext('2d')!
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, slice.width, slice.height)
          ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh)
          const sliceData = slice.toDataURL('image/jpeg', 0.95)
          const sliceH = (sh * imgW) / canvas.width
          pdf.addImage(sliceData, 'JPEG', margin, margin, imgW, sliceH)
        }
      }
      pdf.save(`${data.invoice_no}.pdf`)
    } catch (e: any) {
      message.error('导出失败：' + (e?.message || ''))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="doc-page">
      <style>{styles}</style>

      {/* 悬浮在窗口右侧，不占纸张版面 */}
      <div className="doc-toolbar no-print">
        <Button type="primary" size="large" icon={<DownloadOutlined />} loading={exporting} onClick={exportPdf}>
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
        {/* 抬头：左 主体 / 右 定位语 */}
        <div className="i-head">
          <div className="i-head-l">
            <img className="i-logo" src={entityLogo} alt="" onError={hideBrokenImg} />
            <div className="i-org-name">{entityName}</div>
          </div>
          <div className="i-head-r">
            {data.invoice_entity_tax_no ? `NPWP ${data.invoice_entity_tax_no}` : L('companySlogan')}
          </div>
        </div>
        <div className="i-rule" />

        {/* 单号 / 收票方 */}
        <div className="i-title-row">
          <div>
            <div className="i-kind">{L('invoiceLabel')}</div>
            <div className="i-no">{data.invoice_no}</div>
          </div>
          {/* 买方抬头优先用开票时的快照，客户档案后来改名也不影响已开发票 */}
          <div className="i-billto">
            <div className="i-billto-name">
              {data.invoice_customer_name || customer?.company || customer?.name || '-'}
            </div>
            {(data.invoice_customer_tax_no || customer?.tax_no) && (
              <div className="i-billto-sub">
                NPWP {data.invoice_customer_tax_no || customer?.tax_no}
              </div>
            )}
            {(data.invoice_customer_address || customer?.address) && (
              <div className="i-billto-sub">{data.invoice_customer_address || customer?.address}</div>
            )}
            {(data.invoice_customer_phone || customer?.phone) && (
              <div className="i-billto-sub">{data.invoice_customer_phone || customer?.phone}</div>
            )}
          </div>
        </div>

        {/* 日期 */}
        <div className="i-dates">
          <div>
            <span className="k">{L('date')}:</span> <strong>{formatDate(data.invoice_issued_at || '')}</strong>
          </div>
          {data.invoice_due_at && (
            <div>
              <span className="k">{L('dueDate')}:</span> <strong>{formatDate(data.invoice_due_at)}</strong>
            </div>
          )}
        </div>

        {/* 明细：全边框 + 浅灰表头，与报价单同一套版式 */}
        <table className="i-table">
          <thead>
            <tr>
              <th>{L('itemName')}</th>
              <th className="center" style={{ width: 76 }}>{L('colQty')}</th>
              <th className="num" style={{ width: 150 }}>{L('colUnitPrice')}</th>
              <th className="num" style={{ width: 150 }}>{L('colAmount')}</th>
            </tr>
          </thead>
          <tbody>
            {(data.items || []).map((it: any, idx: number) => {
              const name = it.display_name || it.product_name || ''
              const sub = it.show_brand
                ? [it.brand_display, it.model_display, it.spec].filter(Boolean).join(' · ')
                : it.spec || ''
              return (
                <tr key={it.id || idx}>
                  <td>
                    {name}
                    {sub && <span className="i-sub"> {sub}</span>}
                  </td>
                  <td className="center">
                    {Number(it.qty).toLocaleString()} {it.unit}
                  </td>
                  <td className="num">{sym}{fmt(Number(it.sell_price))}</td>
                  <td className="num">{sym}{fmt(Number(it.sell_price) * Number(it.qty))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* 合计：右侧窄栏；已付款印章占左边空位（跟着表格走，不用绝对定位免得压到抬头） */}
        <div className="i-totals-wrap">
          {isPaid && <div className="stamp-paid">{L('paid')}</div>}
          <div className="i-totals">
            {/* 部分开票要标明，否则客户会当成全款发票 */}
            {isPartial && (
              <div className="i-total-row">
                <span>{L('contractTotal')}</span>
                <span>{sym}{fmt(Number(data.total || 0))}</span>
              </div>
            )}
            <div className="i-total-row">
              <span>{L('subtotal')}</span>
              <span>{sym}{fmt(netAmount)}</span>
            </div>
            <div className="i-total-row">
              <span>VAT {(taxRate * 100).toFixed((taxRate * 100) % 1 === 0 ? 0 : 2)}%</span>
              <span>{sym}{fmt(taxAmount)}</span>
            </div>
            <div className="i-grand">
              <span>{L('grandTotal')}</span>
              <span className="v">{sym}{fmt(total)}</span>
            </div>
          </div>
        </div>

        {/* 付款信息块 */}
        <div className="i-pay">
          <div className="i-pay-title">{L('paymentInfo')}</div>
          <div className="i-pay-kv">
            <span>{L('accountNo')}</span>
            <strong>{data.invoice_bank_account_no || settings.bank_account_no || '-'}</strong>
          </div>
          <div className="i-pay-kv">
            <span>{L('bankLabel')}</span>
            <strong>
              {[data.invoice_bank_name || settings.bank_name, data.invoice_bank_branch]
                .filter(Boolean)
                .join(' · ') || '-'}
            </strong>
          </div>
          <div className="i-pay-kv">
            <span>{L('accountName')}</span>
            <strong>{data.invoice_bank_account_name || settings.bank_account_name || '-'}</strong>
          </div>
          {(data.invoice_bank_swift || settings.bank_swift) && (
            <div className="i-pay-kv">
              <span>SWIFT</span>
              <strong>{data.invoice_bank_swift || settings.bank_swift}</strong>
            </div>
          )}
        </div>

        {/* 条款 */}
        <div className="i-terms">
          {terms.map(([cn, id2], i) => (
            <div key={i}>* {lang === 'cn' ? cn : id2}</div>
          ))}
        </div>

        {/* 页脚 */}
        <div className="i-foot">
          <img className="i-foot-logo" src={entityLogo} alt="" onError={hideBrokenImg} />
          <span>
            {entityName}
            {(data.invoice_entity_phone || settings.company_phone) &&
              ` | ${data.invoice_entity_phone || settings.company_phone}`}
            {(data.invoice_entity_address || settings.company_address) &&
              ` | ${data.invoice_entity_address || settings.company_address}`}
          </span>
        </div>
      </div>
    </div>
  )
}

const BRAND = '#1d57e0'

const styles = `
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
/* ===== 纸张：与报价单 QuotePrint 同一套版式（蓝分隔线 + 全边框浅灰表头 + 付款信息块 + 品牌页脚） ===== */
.doc-paper {
  width: 820px; margin: 0 auto; background: #fff; color: #333;
  box-shadow: 0 4px 24px rgba(0,32,96,.10); position: relative;
  padding: 44px 48px 36px; font-size: 13px; line-height: 1.45;
  font-variant-numeric: tabular-nums;
}

.i-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.i-head-l { display: flex; align-items: center; min-width: 0; }
.i-logo { height: 50px; margin-right: 12px; object-fit: contain; }
.i-org-name { font-size: 22px; font-weight: 800; letter-spacing: 1px; line-height: 1.2; }
.i-head-r { font-size: 12px; color: #666; text-align: right; line-height: 1.5; flex-shrink: 0; padding-left: 20px; }
.i-rule { border-top: 2px solid ${BRAND}; margin-bottom: 14px; }

.i-title-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 30px; margin-bottom: 14px; }
.i-kind { font-size: 12px; color: #666; margin-bottom: 2px; }
.i-no { font-size: 20px; font-weight: bold; color: ${BRAND}; }
.i-billto { text-align: right; min-width: 0; }
.i-billto-name { font-size: 15px; font-weight: bold; }
.i-billto-sub { font-size: 12px; color: #888; margin-top: 2px; overflow-wrap: anywhere; }

.i-dates { display: flex; gap: 40px; margin-bottom: 14px; font-size: 13px; color: #555; }
.i-dates .k { color: #666; }

/* 全边框 + 浅灰表头，与报价单 q-table 同一套（原蓝底斑马纹已按 24 号单对齐掉） */
.i-table { width: 100%; border-collapse: collapse; table-layout: fixed; word-break: keep-all; overflow-wrap: anywhere; }
.i-table th, .i-table td { border: 1px solid #333; padding: 8px 10px; text-align: left; vertical-align: top; line-height: 1.45; }
.i-table th { background: #f5f5f5; font-weight: 600; font-size: 14px; }
.i-table td { font-size: 13px; }
.i-table .num { text-align: right; white-space: nowrap; }
.i-table .center { text-align: center; }
.i-sub { color: #888; font-size: 12px; }

.i-totals-wrap { display: flex; justify-content: flex-end; align-items: center; margin-top: 16px; }
.i-totals { width: 360px; }
.i-total-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #eee; font-size: 13px; }
.i-grand { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 0 0; font-size: 15px; font-weight: bold; }
.i-grand .v { color: ${BRAND}; }

.i-sign { margin-top: 22px; text-align: right; }
.i-sign-role { font-size: 10.5px; letter-spacing: 1.6px; color: #8c8c8c; }
.i-sign-line { width: 190px; height: 1px; background: #d9d9d9; margin: 40px 0 7px auto; }
.i-sign-name { font-size: 11.5px; color: #595959; }

.i-pay { margin-top: 20px; padding: 12px 14px; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 4px; font-size: 12px; }
.i-pay-title { color: ${BRAND}; font-weight: bold; margin-bottom: 8px; }
.i-pay-kv { display: flex; gap: 8px; line-height: 1.9; }
.i-pay-kv span { color: #999; min-width: 62px; flex-shrink: 0; }
.i-pay-kv strong { color: #333; overflow-wrap: anywhere; }

.i-terms { margin-top: 16px; font-size: 11px; color: #666; line-height: 1.7; }

.i-foot { border-top: 2px solid ${BRAND}; margin-top: 28px; padding-top: 12px; display: flex; align-items: center; gap: 10px; font-size: 13px; color: #666; }
.i-foot-logo { height: 36px; object-fit: contain; }

.stamp-paid { margin: 0 auto 0 24px; transform: rotate(-14deg); border: 3px solid #52c41a; color: #52c41a; font-size: 26px; font-weight: 900; letter-spacing: 3px; padding: 5px 18px; border-radius: 6px; opacity: .8; }

@media print {
  .doc-page { background: #fff; padding: 0; }
  .no-print { display: none !important; }
  .doc-paper { box-shadow: none; width: 100%; padding: 20px; }
  .i-table tr, .i-table thead { page-break-inside: avoid; }
}
`
