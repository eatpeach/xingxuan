import React, { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Segmented, Spin, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import ItemTranslateModal from './inquiry/ItemTranslate'
import { checkQuoteDoc } from '../utils/docCheck'
import { currencyLabel, getPrintLang, PRINT_LANGS, pt, setPrintLang, itemName, itemSpec, itemBrand, itemModel, unitText, untranslatedCount, type PrintLang } from './printI18n'
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
  // 选了印尼语 / 英文但物品名还没确认译名：直接在这页弹出译名对照表，确认后物品名立刻换成译名
  const [transOpen, setTransOpen] = useState(false)
  const transAsked = useRef<Record<string, boolean>>({})
  const reloadItems = () => api.get('getCustomerQuote', { id }).then((r) => setData(r.data))
  // 切到印尼语 / 英文：没翻完的行自动在后台翻译（物品名 / 规格 / 尺寸单位 / 品牌型号），翻完直接显示；
  // 翻完还有中文（极少数）才弹对照表让人补
  const [autoTranslating, setAutoTranslating] = useState(false)
  useEffect(() => {
    if (!data || lang === 'cn' || transAsked.current[lang]) return
    if (untranslatedCount(data.items || [], lang) === 0) return
    transAsked.current[lang] = true
    setAutoTranslating(true)
    api
      .post('translateQuoteItems', { quote_id: Number(id), lang })
      .then(() => api.get('getCustomerQuote', { id }))
      .then((r) => {
        setData(r.data)
        if (untranslatedCount(r.data?.items || [], lang) > 0) setTransOpen(true)
      })
      .catch(() => setTransOpen(true))
      .finally(() => setAutoTranslating(false))
  }, [data, lang])
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

  // 运费（20261112）：加进单价时客户只看含运费单价；到付 / 免运费在说明里注明
  const freightMode = data.freight_mode || 'collect'
  const inPrice = freightMode === 'in_price'
  const unitPrice = (it: any) => Number(inPrice && it.price_with_freight != null ? it.price_with_freight : it.sell_price)
  const lineAmount = (it: any) =>
    inPrice && it.line_total != null ? Number(it.line_total) : Number(it.sell_price) * Number(it.qty)
  const freightKey = inPrice ? 'freightIncluded' : freightMode === 'absorb' ? 'freightFree' : 'freightCollect'
  const isFactory = data.payment_channel === 'factory'
  // 出门前自检：金额对不上就不许导出 / 打印（20261113）
  const docProblems = checkQuoteDoc(data)
  // 选了印尼语 / 英文：单据上必须全部是该语言，还有中文或没翻完的行一律不许导出（20261113）
  const langBlocked = lang !== 'cn' && (autoTranslating || untranslatedCount(data.items || [], lang) > 0)
  const exportBlocked = docProblems.length > 0 || langBlocked
  const acct = data.payment_account

  const hasTax = taxRate > 0
  const netAmount = !hasTax ? total : taxIncluded ? total / (1 + taxRate) : total
  const taxAmount = !hasTax ? 0 : taxIncluded ? total - netAmount : total * taxRate
  const grandTotal = !hasTax || taxIncluded ? total : total + taxAmount

  // 与发票页同一套实现（html2canvas 截图 → jsPDF 按 A4 切页），避免再引入 html2pdf.js
  const exportPdf = async () => {
    if (exportBlocked) return // 金额自检没通过 / 还有中文没翻，不许导出
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
      {data.status === 'to_review' && (
        <div className="no-print" style={{ background: '#fff7e6', border: '1px solid #ffd591', color: '#ad4e00', padding: '8px 14px', textAlign: 'center', fontSize: 13 }}>
          这张报价单有追加物料还在待审批，审批通过前请不要发给客户
        </div>
      )}
      {docProblems.length > 0 && (
        <div className="no-print" style={{ background: '#fff1f0', border: '2px solid #ff4d4f', color: '#a8071a', padding: '12px 18px', fontSize: 14, lineHeight: 1.8 }}>
          <b>金额自检没通过，已禁止导出和打印，不要把这张单发给客户：</b>
          {docProblems.map((p, i) => (
            <div key={i}>· {p}</div>
          ))}
          <div style={{ fontSize: 12, color: '#cf1322' }}>请回到商机里修正（修改报价单保存一次 / 重新开发票），或联系管理员。</div>
          {/* 浏览器自带的打印（Ctrl+P）也挡掉：打印时整张纸不输出 */}
          <style>{'@media print { .doc-paper { display: none !important; } }'}</style>
        </div>
      )}
      {autoTranslating && (
        <div className="no-print" style={{ background: '#e6f4ff', border: '1px solid #91caff', color: '#0958d9', padding: '8px 14px', textAlign: 'center', fontSize: 13 }}>
          正在把物品名、规格、单位、品牌型号翻译成{lang === 'id' ? '印尼文' : '英文'}…
        </div>
      )}
      {!autoTranslating && lang !== 'cn' && untranslatedCount(data.items || [], lang) > 0 && (
        <div className="no-print" style={{ background: '#fffbe6', border: '1px solid #ffe58f', color: '#ad6800', padding: '8px 14px', textAlign: 'center', fontSize: 13 }}>
          有 {untranslatedCount(data.items || [], lang)} 行物品自动翻译后还有中文，已禁止导出，请补一下。
          <style>{'@media print { .doc-paper { display: none !important; } }'}</style>
          <Button size="small" type="primary" style={{ marginLeft: 10 }} onClick={() => setTransOpen(true)}>
            现在翻译
          </Button>
        </div>
      )}
      {(lang === 'id' || lang === 'en') && (
        <ItemTranslateModal
          quoteId={Number(id)}
          lang={lang}
          lockLang
          open={transOpen}
          confirmText="确认译名"
          onClose={() => setTransOpen(false)}
          onConfirmed={reloadItems}
        />
      )}
      <div className="doc-toolbar no-print">
        <Button
          type="primary"
          size="large"
          icon={<DownloadOutlined />}
          loading={exporting}
          disabled={exportBlocked}
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
                ? [itemBrand(it, lang), itemModel(it, lang)].filter(Boolean).join(' / ')
                : ''
              return (
                <tr key={it.id || idx}>
                  <td className="center">{idx + 1}</td>
                  <td>
                    {itemName(it, lang)}
                    {brand && <div className="q-sub">{brand}</div>}
                  </td>
                  <td>{itemSpec(it, lang) || '-'}</td>
                  <td className="center">
                    {Number(it.qty).toLocaleString()} {unitText(it.unit, lang)}
                  </td>
                  {hasLeadTime && (
                    <td className="center">{it.lead_time || data.production_cycle || '-'}</td>
                  )}
                  <td className="num">{fmt(unitPrice(it))}</td>
                  <td className="num">{fmt(lineAmount(it))}</td>
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
          <div>* {L(freightKey)}</div>
          {/* 收款账户：开单时选定的；客户直付工厂不印我方任何账号 */}
          {isFactory ? (
            <div>* {L('payToFactory')}</div>
          ) : acct ? (
            <div>
              * {L('paymentInfo')}: {[acct.bank_name, acct.branch].filter(Boolean).join(' · ')} · {acct.account_number} · {acct.account_name}
              {acct.swift ? ` · SWIFT ${acct.swift}` : ''}
            </div>
          ) : null}
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
