import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Space, Spin, message, Segmented } from 'antd'
import { DownloadOutlined, PrinterOutlined } from '@ant-design/icons'
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

  const total = Number(data.total || 0)
  const currency = (data.currency || 'IDR') as 'IDR' | 'CNY'
  const sym = currency === 'IDR' ? 'Rp' : '¥'
  const fmt = (n: number) =>
    currency === 'IDR'
      ? Math.round(n).toLocaleString('id-ID')
      : n.toLocaleString(undefined, { minimumFractionDigits: 2 })

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

      <div className="doc-toolbar no-print">
        <Space size={8}>
          <Button type="primary" size="large" icon={<DownloadOutlined />} loading={exporting} onClick={exportPdf}>
            {L('exportPdf')}
          </Button>
          <Button size="large" icon={<PrinterOutlined />} onClick={() => window.print()}>
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

      <div className="doc-paper" ref={paperRef}>
        {isPaid && <div className="stamp-paid">{L('paid')}</div>}

        {/* 顶部灰底带：左 主体 / 右 单据类型 */}
        <div className="doc-head">
          <div className="doc-head-left">
            <img
              className="doc-logo"
              src={
                data.invoice_entity_logo_path
                  ? '/storage/' + String(data.invoice_entity_logo_path).replace(/^\/+/, '')
                  : settings.pdf_logo_path
                    ? '/storage/' + String(settings.pdf_logo_path).replace(/^\/+/, '')
                    : '/storage/brand/logo.png'
              }
              alt=""
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
            <div>
              <div className="doc-org-name">
                {data.invoice_entity_name || settings.company_name || '星选建材'}
              </div>
              <div className="doc-org-sub">
                {data.invoice_entity_tax_no ? `NPWP ${data.invoice_entity_tax_no}` : '星选建材 · 印尼建材集采'}
              </div>
            </div>
          </div>
          <div className="doc-head-right">
            <div className="doc-kind">{L('invoiceTitle')}</div>
            <div className="doc-no">
              {L('poNo')}: <strong>{data.invoice_no}</strong>
            </div>
          </div>
        </div>

        <div className="doc-body">
          {/* 收票方 */}
          <div className="doc-info-row">
            <div className="doc-billto">
              <span className="doc-billto-label">{L('billTo')}</span>
              <div className="doc-billto-name">
                {customer?.short_name || customer?.name || '-'}
              </div>
              <div className="doc-billto-lines">
                {customer?.company && <>{customer.company}<br /></>}
                {customer?.address && <>{customer.address}<br /></>}
                {customer?.phone}
              </div>
            </div>
            <div className="doc-meta-col">
              <div><span className="mk">{L('date')}</span><strong>{formatDate(data.invoice_issued_at || '')}</strong></div>
              {data.invoice_due_at && (
                <div><span className="mk">{L('dueDate')}</span><strong>{formatDate(data.invoice_due_at)}</strong></div>
              )}
            </div>
          </div>

          {/* 明细 */}
          <table className="doc-items">
            <thead>
              <tr>
                <th style={{ width: '5%' }}>#</th>
                <th style={{ width: '45%' }}>{L('itemName')}</th>
                <th style={{ width: '16%' }} className="num">{L('colUnitPrice')}</th>
                <th style={{ width: '10%' }} className="center">{L('colQty')}</th>
                <th style={{ width: '24%' }} className="num">{L('colAmount')}</th>
              </tr>
            </thead>
            <tbody>
              {(data.items || []).map((it: any, idx: number) => {
                const name = it.display_name || it.product_name || ''
                const lineTotal = Number(it.sell_price) * Number(it.qty)
                const sub = it.show_brand
                  ? [it.brand_display, it.model_display, it.spec].filter(Boolean).join(' · ')
                  : it.spec || ''
                return (
                  <tr key={it.id || idx}>
                    <td className="idx">{idx + 1}.</td>
                    <td>
                      <div className="desc-main">{name}</div>
                      {sub && <div className="desc-sub">{sub}</div>}
                    </td>
                    <td className="num">{fmt(Number(it.sell_price))}</td>
                    <td className="center">
                      {Number(it.qty).toLocaleString()} {it.unit}
                    </td>
                    <td className="num">{fmt(lineTotal)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* 合计 */}
          <div className="doc-totals">
            <div className="doc-grand">
              <span className="k">{L('totalIncl')}</span>
              <span className="v">
                {sym} {fmt(total)}
              </span>
            </div>
          </div>

          {/* 落款 */}
          <div className="doc-sign">
            <div className="doc-sign-role">{L('regards')}</div>
            <div className="doc-sign-line" />
            <div className="doc-sign-name">
              {data.invoice_entity_name || settings.company_name || '星选建材'}
            </div>
          </div>
        </div>

        {/* 三栏页脚 */}
        <div className="doc-foot">
          <div>
            <h5>{L('contactUs')}</h5>
            {data.invoice_entity_phone || settings.company_phone || ''}
            {(data.invoice_entity_address || '') && (
              <>
                <br />
                {data.invoice_entity_address}
              </>
            )}
          </div>
          <div>
            <h5>{L('transferTo')}</h5>
            <div className="kv">
              <span>Bank</span>
              <span>{data.invoice_bank_name || settings.bank_name || ''}</span>
            </div>
            <div className="kv">
              <span>{L('accountName')}</span>
              <span>{data.invoice_bank_account_name || settings.bank_account_name || ''}</span>
            </div>
            <div className="kv">
              <span>{L('accountNo')}</span>
              <span>{data.invoice_bank_account_no || settings.bank_account_no || ''}</span>
            </div>
            {data.invoice_bank_branch && (
              <div className="kv">
                <span>{L('branch')}</span>
                <span>{data.invoice_bank_branch}</span>
              </div>
            )}
            {(data.invoice_bank_swift || settings.bank_swift) && (
              <div className="kv">
                <span>SWIFT</span>
                <span>{data.invoice_bank_swift || settings.bank_swift}</span>
              </div>
            )}
          </div>
          <div>
            <h5>{L('termsTitle')}</h5>
            {terms.map(([cn, id2], i) => (
              <div key={i}>{lang === 'cn' ? cn : id2}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const BRAND = '#1d57e0'

const styles = `
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
`
