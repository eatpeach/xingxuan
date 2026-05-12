import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Space, Spin, message } from 'antd'
import { DownloadOutlined, PrinterOutlined } from '@ant-design/icons'
import { api } from '../api'
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
        {isPaid && <div className="stamp stamp-paid">PAID</div>}

        {/* 大标题 */}
        <h1 className="inv-title">INVOICE</h1>

        {/* 顶部信息：左 BILL TO / 右 PO + Date */}
        <div className="inv-top">
          <div className="inv-top-left">
            <div className="inv-row">
              <span className="inv-label">BILL TO :</span>
              <span className="inv-value">
                {customer?.short_name || customer?.name || '-'}
                {customer?.company ? ` / ${customer.company}` : ''}
              </span>
            </div>
            <div className="inv-row" style={{ marginTop: 16 }}>
              <span className="inv-label">Address :</span>
              <span className="inv-value">{customer?.address || ''}</span>
            </div>
          </div>
          <div className="inv-top-right">
            <div className="inv-row-r">
              <span className="inv-label">PO No:</span>
              <span className="inv-value-strong">{data.invoice_no}</span>
            </div>
            <div className="inv-row-r">
              <span className="inv-label">Date</span>
              <span className="inv-value-strong">{formatDate(data.invoice_issued_at || '')}</span>
            </div>
          </div>
        </div>

        {/* 表格 */}
        <table className="inv-items">
          <thead>
            <tr>
              <th style={{ width: 50 }}>NO</th>
              <th>ITEM NAME</th>
              <th style={{ width: 70 }}>QTY</th>
              <th style={{ width: 70 }}>UNIT</th>
              <th style={{ width: 130 }}>UNIT PRICE</th>
              <th style={{ width: 160 }} className="r">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it: any, idx: number) => {
              const lineTotal = Number(it.sell_price) * Number(it.qty)
              const name = [it.product_name, it.spec].filter(Boolean).join(' ')
              return (
                <tr key={it.id}>
                  <td>{idx + 1}</td>
                  <td className="item-name">
                    {name}
                    {it.show_brand && (it.brand_display || it.model_display) ? (
                      <span className="item-brand"> · {[it.brand_display, it.model_display].filter(Boolean).join(' / ')}</span>
                    ) : null}
                  </td>
                  <td>{Number(it.qty).toLocaleString()}</td>
                  <td>{it.unit}</td>
                  <td className="num">{fmt(Number(it.sell_price))}</td>
                  <td className="num">
                    <span className="amount-sym">{sym}</span>
                    <span className="amount-val">{fmt(lineTotal)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* 蓝色 TOTAL 条 */}
        <div className="inv-total-bar">
          <div className="total-label">TOTAL</div>
          <div className="total-amount">
            <span className="total-sym">{sym}</span>
            <span className="total-val">{fmt(total)}</span>
          </div>
        </div>

        {/* 双语条款 */}
        <ol className="inv-terms">
          {terms.map(([cn, id], i) => (
            <li key={i}>
              <div className="t-cn">{cn}</div>
              <div className="t-id">{id}</div>
            </li>
          ))}
        </ol>

        {/* 底部：左 TRANSFER TO / 右 HORMAT KAMI */}
        <div className="inv-bottom">
          <div className="inv-bottom-left">
            <div className="inv-bottom-title">TRANSFER TO :</div>
            <div className="bank-name">{data.invoice_bank_name || settings.bank_name || 'BCA'}</div>
            <div className="bank-no">{data.invoice_bank_account_no || settings.bank_account_no || ''}</div>
            <div className="bank-holder">{data.invoice_bank_account_name || settings.bank_account_name || ''}</div>
            {(data.invoice_bank_swift || settings.bank_swift) && (
              <div className="bank-swift">SWIFT: {data.invoice_bank_swift || settings.bank_swift}</div>
            )}
          </div>
          <div className="inv-bottom-right">
            <div className="inv-bottom-title">HORMAT KAMI</div>
          </div>
        </div>
      </div>
    </div>
  )
}

const BRAND = '#1d57e0'

const styles = `
.inv-page { background: #f0f2f5; min-height: 100vh; padding: 32px 0 64px; }
.inv-toolbar { max-width: 720px; margin: 0 auto 20px; display: flex; }
.inv-paper {
  background: #fff;
  width: 720px;  /* 720px @ 96dpi = 190mm，正好等于 A4 width (210mm) - 左右各 10mm 边距 */
  margin: 0 auto;
  padding: 40px 44px 48px;
  box-shadow: 0 4px 24px rgba(0, 32, 96, 0.1);
  color: #1f1f1f;
  font-family: "PingFang SC", "Microsoft YaHei", Arial, -apple-system, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  position: relative;
  box-sizing: border-box;
}

/* PAID 印章 */
.stamp {
  position: absolute;
  top: 60px;
  right: 56px;
  padding: 8px 24px;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 6px;
  border: 5px solid;
  border-radius: 8px;
  transform: rotate(-12deg);
  opacity: 0.88;
}
.stamp-paid { color: #389e0d; border-color: #389e0d; }

/* 大字标题 INVOICE 居中 */
.inv-title {
  text-align: center;
  font-size: 42px;
  font-weight: 800;
  letter-spacing: 6px;
  margin: 0 0 36px;
  color: #1f1f1f;
}

/* 顶部信息 */
.inv-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 36px;
}
.inv-top-left { flex: 1; }
.inv-top-right { text-align: right; }
.inv-row { display: flex; gap: 12px; font-size: 14px; }
.inv-row-r { font-size: 14px; margin-bottom: 4px; }
.inv-row-r .inv-label { color: ${BRAND}; font-weight: 700; margin-right: 8px; }
.inv-label { color: #8c8c8c; font-weight: 600; min-width: 60px; }
.inv-value { color: #1f1f1f; font-weight: 500; }
.inv-value-strong { color: #1f1f1f; font-weight: 600; }

/* 表格 */
.inv-items {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 0;
}
.inv-items thead th {
  text-align: left;
  font-size: 13px;
  font-weight: 800;
  padding: 12px 8px;
  color: #1f1f1f;
  letter-spacing: 1px;
  border-bottom: 1px solid #595959;
}
.inv-items thead th.r { text-align: right; }
.inv-items tbody td {
  padding: 10px 8px;
  font-size: 13px;
  border-bottom: 1px solid #f0f0f0;
  vertical-align: top;
}
.inv-items .item-name { font-weight: 600; }
.inv-items .item-brand { color: #8c8c8c; font-weight: 400; font-size: 12px; }
.inv-items .num { text-align: right; font-variant-numeric: tabular-nums; }
.amount-sym { display: inline-block; color: #595959; margin-right: 4px; }
.amount-val { font-weight: 600; }

/* 蓝色 TOTAL 条 */
.inv-total-bar {
  background: linear-gradient(90deg, ${BRAND} 0%, #4096ff 100%);
  color: #fff;
  margin-top: 0;
  padding: 14px 24px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 28px;
}
.total-label {
  position: absolute;
  right: 280px;
  font-size: 12px;
  letter-spacing: 4px;
  font-weight: 600;
  opacity: 0.95;
}
.inv-total-bar { position: relative; }
.total-amount {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-variant-numeric: tabular-nums;
}
.total-sym { font-size: 16px; font-weight: 600; opacity: 0.95; }
.total-val { font-size: 22px; font-weight: 700; letter-spacing: 1px; }

/* 双语条款 */
.inv-terms {
  margin: 28px 0 0;
  padding-left: 24px;
  font-size: 13px;
}
.inv-terms li {
  margin-bottom: 10px;
  line-height: 1.5;
  color: #1f1f1f;
}
.inv-terms .t-cn { font-weight: 500; }
.inv-terms .t-id { color: #595959; font-size: 12px; margin-top: 1px; }

/* 底部 */
.inv-bottom {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-top: 32px;
  font-size: 13px;
}
.inv-bottom-title {
  font-weight: 700;
  letter-spacing: 1px;
  margin-bottom: 6px;
  font-size: 13px;
}
.bank-name { color: ${BRAND}; font-weight: 700; font-size: 14px; }
.bank-no { font-family: "Courier New", monospace; font-weight: 600; font-size: 14px; letter-spacing: 1px; }
.bank-holder { font-weight: 500; }
.bank-swift { color: #8c8c8c; font-size: 12px; margin-top: 2px; }
.inv-bottom-right { text-align: right; min-width: 200px; }

@media print {
  body { background: #fff; }
  .inv-page { background: #fff; padding: 0; }
  .no-print { display: none !important; }
  .inv-paper { width: 100%; box-shadow: none; margin: 0; padding: 24px 28px; }
  .inv-total-bar, .stamp { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 12mm 14mm; }
}
`
