import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Segmented, Spin, message } from 'antd'
import { DownloadOutlined, PrinterOutlined } from '@ant-design/icons'
import { api } from '../api'
import { docLine } from '../utils/docCheck'
// @ts-ignore
import html2canvas from 'html2canvas'
// @ts-ignore
import jsPDF from 'jspdf'

/**
 * 合同打印 / 导出 PDF 页（20261120）
 * 以前合同只能生成、编辑、上传签字版，打印不出来。这里把条款排成正式合同：
 * 抬头 + 双语条款（中文 / Bahasa Indonesia 上下排）+ 附件货品清单 + 双方签字栏。
 * 条款内容就是合同编辑器里保存的那份，在这里不能改；要改回商机里点「查看 / 编辑」。
 */

type Mode = 'both' | 'cn' | 'id'
const BRAND = '#1d57e0'

export default function ContractPrintPage() {
  const { id } = useParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<Mode>('both')
  const [exporting, setExporting] = useState(false)
  const paperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    Promise.all([api.get('getContract', { id }), api.get('listSettings')])
      .then(([c, st]) => {
        if (!alive) return
        setData(c.data)
        setSettings(Object.fromEntries((st.items || []).map((s: any) => [s.key, s.value])))
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [id])

  if (loading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>
  if (!data) return <div style={{ padding: 24 }}>合同不存在，或没有权限查看</div>

  const { contract, order, quote } = data
  const clauses: any[] = contract.clauses || []
  const cur = order.currency || 'IDR'
  const sym = cur === 'CNY' ? '¥' : 'Rp'
  const fmt = (n: number) => (cur === 'CNY' ? n.toLocaleString(undefined, { minimumFractionDigits: 2 }) : Math.round(n).toLocaleString('id-ID'))
  const showCn = mode !== 'id'
  const showId = mode !== 'cn'
  const seller = quote.invoice_entity_name || settings.company_name || '星选建材'
  const buyer = quote.invoice_customer_name || order.customer_company || order.customer_name || ''
  const logo = quote.invoice_entity_logo_path
    ? '/storage/' + String(quote.invoice_entity_logo_path).replace(/^\/+/, '')
    : settings.pdf_logo_path
      ? '/storage/' + String(settings.pdf_logo_path).replace(/^\/+/, '')
      : '/storage/brand/logo.png'

  // 货品清单金额：和报价单 / 发票同一套算法（含运费单价、尾差）
  const items: any[] = quote.items || []
  const net = Number(quote.total || 0)
  const taxRate = Number(quote.tax_rate || 0)
  const taxIncluded = !!Number(quote.tax_included ?? 0)
  const tax = taxRate > 0 && !taxIncluded ? Math.round(net * taxRate * 100) / 100 : 0
  const grand = net + tax

  const exportPdf = async () => {
    if (!paperRef.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(paperRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false })
      const pdf = new jsPDF('p', 'mm', 'a4')
      const margin = 8
      const contentW = pdf.internal.pageSize.getWidth() - margin * 2
      const contentH = pdf.internal.pageSize.getHeight() - margin * 2
      const pageImgH = (canvas.width * contentH) / contentW
      const totalPages = Math.max(1, Math.ceil(canvas.height / pageImgH))
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
        pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, contentW, (sh * contentW) / canvas.width)
      }
      pdf.save(`合同_${order.no}_v${contract.version}.pdf`)
    } catch (e: any) {
      message.error('导出失败：' + (e?.message || ''))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="ct-page">
      <style>{styles}</style>
      <div className="ct-toolbar no-print">
        <Button type="primary" size="large" icon={<DownloadOutlined />} loading={exporting} onClick={exportPdf}>
          导出 PDF
        </Button>
        <Button size="large" icon={<PrinterOutlined />} onClick={() => window.print()}>
          打印
        </Button>
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          options={[
            { label: '中印双语', value: 'both' },
            { label: '中文', value: 'cn' },
            { label: 'Bahasa', value: 'id' },
          ]}
        />
        <div style={{ fontSize: 12, color: '#8c8c8c', lineHeight: 1.6 }}>
          条款内容在商机「合同」里点「查看 / 编辑」修改，改完刷新本页。
        </div>
      </div>

      <div className="ct-paper" ref={paperRef}>
        <div className="ct-head">
          <img className="ct-logo" src={logo} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <div className="ct-org">{seller}</div>
          <div className="ct-title-box">
            <div className="ct-title">{showCn ? '销售合同' : 'KONTRAK PENJUALAN'}</div>
            {showCn && showId && <div className="ct-title-sub">KONTRAK PENJUALAN</div>}
          </div>
        </div>
        <div className="ct-rule" />
        <div className="ct-meta">
          <span>{showCn ? '合同编号' : 'Nomor Kontrak'}：<b>{order.no}</b></span>
          <span>{showCn ? '版本' : 'Versi'}：v{contract.version}</span>
          {quote.no && <span>{showCn ? '关联报价单' : 'Quotation'}：{quote.no}</span>}
        </div>

        {clauses.map((c, i) => (
          <div className="ct-clause" key={i}>
            {showCn && (c.title_cn || c.body_cn) && (
              <div className="ct-block">
                {c.title_cn && <div className="ct-ctitle">{c.title_cn}</div>}
                {c.body_cn && <div className="ct-body">{c.body_cn}</div>}
              </div>
            )}
            {showId && (c.title_id || c.body_id) && (
              <div className={'ct-block' + (showCn ? ' ct-id' : '')}>
                {c.title_id && <div className="ct-ctitle">{c.title_id}</div>}
                {c.body_id && <div className="ct-body">{c.body_id}</div>}
              </div>
            )}
          </div>
        ))}

        {items.length > 0 && (
          <div className="ct-clause">
            <div className="ct-ctitle">
              {showCn ? `附件：货品清单（报价单 ${quote.no}）` : ''}
              {showCn && showId ? ' / ' : ''}
              {showId ? `Lampiran: Daftar Barang (Quotation ${quote.no})` : ''}
            </div>
            <table className="ct-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>No</th>
                  <th>{showCn ? '品名' : 'Nama Barang'}</th>
                  <th style={{ width: 150 }}>{showCn ? '规格' : 'Spesifikasi'}</th>
                  <th style={{ width: 90 }} className="c">{showCn ? '数量' : 'Jumlah'}</th>
                  <th style={{ width: 110 }} className="r">{showCn ? '单价' : 'Harga'}({sym})</th>
                  <th style={{ width: 120 }} className="r">{showCn ? '金额' : 'Total'}({sym})</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const l = docLine(quote, it)
                  // 只出印尼语时用确认过的译名，没有就用中文
                  const name = !showCn && String(it.name_id || '').trim() ? it.name_id : it.product_name
                  const spec = !showCn && String(it.name_id || '').trim() ? it.spec_id || '' : it.spec || ''
                  return (
                    <tr key={it.id || idx}>
                      <td className="c">{idx + 1}</td>
                      <td>{name}</td>
                      <td>{spec || '-'}</td>
                      <td className="c">{Number(it.qty).toLocaleString()} {it.unit}</td>
                      <td className="r">{fmt(l.unit)}</td>
                      <td className="r">{fmt(l.amount)}</td>
                    </tr>
                  )
                })}
                {tax > 0 && (
                  <>
                    <tr className="sum">
                      <td colSpan={5} className="r">{showCn ? '小计（不含 PPN）' : 'Subtotal (belum termasuk PPN)'}</td>
                      <td className="r">{fmt(net)}</td>
                    </tr>
                    <tr className="sum">
                      <td colSpan={5} className="r">PPN {(taxRate * 100).toFixed(0)}%</td>
                      <td className="r">{fmt(tax)}</td>
                    </tr>
                  </>
                )}
                <tr className="grand">
                  <td colSpan={5} className="r">{showCn ? '合同总金额' : 'Total Nilai Kontrak'}</td>
                  <td className="r">{sym} {fmt(grand)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="ct-sign">
          {[
            { role: showCn ? '甲方（卖方）' : 'Pihak Pertama (Penjual)', sub: showCn && showId ? 'Pihak Pertama (Penjual)' : '', name: seller },
            { role: showCn ? '乙方（买方）' : 'Pihak Kedua (Pembeli)', sub: showCn && showId ? 'Pihak Kedua (Pembeli)' : '', name: buyer },
          ].map((p) => (
            <div className="ct-sign-col" key={p.role}>
              <div className="ct-sign-role">{p.role}{p.sub && <span> / {p.sub}</span>}</div>
              <div className="ct-sign-name">{p.name}</div>
              <div className="ct-sign-space" />
              <div className="ct-sign-line">{showCn ? '签字 / 盖章' : 'Tanda tangan / Stempel'}{showCn && showId ? ' (Tanda tangan / Stempel)' : ''}</div>
              <div className="ct-sign-line">{showCn ? '日期' : 'Tanggal'}{showCn && showId ? ' (Tanggal)' : ''}：__________________</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles = `
.ct-page { background: #eef0f4; min-height: 100vh; padding: 24px; font-family: "PingFang SC","Microsoft YaHei",-apple-system,sans-serif; }
.ct-toolbar { position: fixed; right: 24px; top: 50%; transform: translateY(-50%); z-index: 10; width: 200px; display: flex; flex-direction: column; gap: 10px; padding: 14px; background: #fff; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.12); }
.ct-toolbar .ant-btn, .ct-toolbar .ant-segmented { width: 100%; }
@media (max-width: 1340px) {
  .ct-toolbar { position: static; transform: none; width: 820px; max-width: 100%; margin: 0 auto 16px; flex-direction: row; flex-wrap: wrap; align-items: center; box-shadow: none; background: transparent; padding: 0; }
  .ct-toolbar .ant-btn, .ct-toolbar .ant-segmented { width: auto; }
}
.ct-paper { width: 820px; margin: 0 auto; background: #fff; color: #222; box-shadow: 0 4px 24px rgba(0,32,96,.10); padding: 44px 52px 40px; font-size: 13px; line-height: 1.7; }
.ct-head { display: flex; align-items: center; margin-bottom: 14px; }
.ct-logo { height: 46px; margin-right: 12px; object-fit: contain; }
.ct-org { font-size: 18px; font-weight: 800; }
.ct-title-box { flex: 1; text-align: right; }
.ct-title { font-size: 22px; font-weight: 800; letter-spacing: 2px; }
.ct-title-sub { font-size: 12px; color: #666; letter-spacing: 1px; }
.ct-rule { border-top: 2px solid ${BRAND}; margin-bottom: 10px; }
.ct-meta { display: flex; gap: 28px; flex-wrap: wrap; font-size: 12px; color: #444; margin-bottom: 16px; }
.ct-clause { margin-bottom: 14px; }
.ct-block { margin-bottom: 4px; }
.ct-id { color: #333; padding-left: 10px; border-left: 2px solid #e3e8f2; margin-top: 4px; }
.ct-ctitle { font-weight: 700; margin-bottom: 2px; }
.ct-body { white-space: pre-wrap; text-align: justify; }
.ct-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; font-variant-numeric: tabular-nums; }
.ct-table th, .ct-table td { border: 1px solid #333; padding: 5px 8px; vertical-align: top; }
.ct-table th { background: #f3f3f3; font-weight: 600; text-align: left; }
.ct-table .c { text-align: center; } .ct-table .r { text-align: right; }
.ct-table tr.sum td { background: #fafafa; }
.ct-table tr.grand td { font-weight: 800; background: #f3f6fd; }
.ct-sign { display: flex; gap: 40px; margin-top: 36px; }
.ct-sign-col { flex: 1; }
.ct-sign-role { font-weight: 700; } .ct-sign-role span { font-weight: 400; color: #555; }
.ct-sign-name { margin-top: 2px; }
.ct-sign-space { height: 86px; border-bottom: 1px solid #333; margin-bottom: 6px; }
.ct-sign-line { font-size: 12px; color: #444; }
@media print {
  .no-print { display: none !important; }
  .ct-page { background: #fff; padding: 0; }
  .ct-paper { box-shadow: none; width: auto; padding: 0; }
  .ct-clause, .ct-sign-col, .ct-table tr { break-inside: avoid; }
  @page { size: A4; margin: 14mm; }
}
`
