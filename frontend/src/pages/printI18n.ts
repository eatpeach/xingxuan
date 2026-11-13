/**
 * 报价单 / 发票打印页的三语文案（中 / English / Bahasa Indonesia）
 * 单据是给客户看的，语言跟随客户而不是操作员，所以选择存在单据 URL 或本地偏好里，
 * 不走全站 i18n。
 */

export type PrintLang = 'cn' | 'en' | 'id'

export const PRINT_LANGS: { value: PrintLang; label: string }[] = [
  { value: 'cn', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'id', label: 'Bahasa' },
]

const LANG_KEY = 'print_lang'

export function getPrintLang(): PrintLang {
  const v = localStorage.getItem(LANG_KEY)
  return v === 'en' || v === 'id' || v === 'cn' ? v : 'cn'
}

export function setPrintLang(v: PrintLang): void {
  localStorage.setItem(LANG_KEY, v)
}

type Dict = Record<PrintLang, string>

const T = {
  // ---- 报价单 ----
  quoteTitle: { cn: '报价单', en: 'QUOTATION', id: 'PENAWARAN' },
  quoteTitleEn: { cn: 'QUOTATION', en: 'QUOTATION', id: 'PENAWARAN HARGA' },
  quoteNo: { cn: '单号', en: 'No.', id: 'No.' },
  quoteNotFound: { cn: '报价单不存在', en: 'Quotation not found', id: 'Penawaran tidak ditemukan' },
  customer: { cn: '客户', en: 'Customer', id: 'Pelanggan' },
  phone: { cn: '联系电话', en: 'Phone', id: 'Telepon' },
  email: { cn: '邮箱', en: 'Email', id: 'Email' },
  validUntil: { cn: '报价有效期', en: 'Valid Until', id: 'Berlaku Sampai' },
  productionCycle: { cn: '生产周期', en: 'Production Lead Time', id: 'Waktu Produksi' },
  docDate: { cn: '日期', en: 'Date', id: 'Tanggal' },

  colNo: { cn: '序号', en: 'No', id: 'No' },
  colProduct: { cn: '产品名称', en: 'Product', id: 'Nama Barang' },
  colSpec: { cn: '规格', en: 'Specification', id: 'Spesifikasi' },
  colBrandModel: { cn: '品牌 / 型号', en: 'Brand / Model', id: 'Merek / Model' },
  colQty: { cn: '数量', en: 'Qty', id: 'Jumlah' },
  colLeadTime: { cn: '交期', en: 'Lead Time', id: 'Waktu Kirim' },
  colUnit: { cn: '单位', en: 'Unit', id: 'Satuan' },
  colUnitPrice: { cn: '单价', en: 'Unit Price', id: 'Harga Satuan' },
  colAmount: { cn: '金额', en: 'Amount', id: 'Total' },
  colRemark: { cn: '备注', en: 'Remark', id: 'Keterangan' },

  subtotalExTax: { cn: '不含税金额', en: 'Subtotal (excl. tax)', id: 'Subtotal (sebelum pajak)' },
  taxAmount: { cn: '税额', en: 'Tax', id: 'Pajak' },
  // 税率为 0（不涉税）时用这个，不带任何含税/不含税的字眼
  totalLabel: { cn: '合计金额', en: 'Total', id: 'Total' },
  totalIncl: { cn: '合计金额（含税）', en: 'Total (incl. tax)', id: 'Total (termasuk pajak)' },
  totalAfterTax: { cn: '合计金额（含税后）', en: 'Total (after tax)', id: 'Total (setelah pajak)' },

  notes: { cn: '说明', en: 'Notes', id: 'Catatan' },
  noteTaxIncl: { cn: '本报价含税', en: 'This quotation is tax-inclusive', id: 'Penawaran ini sudah termasuk pajak' },
  noteTaxExcl: { cn: '本报价不含税', en: 'This quotation is tax-exclusive', id: 'Penawaran ini belum termasuk pajak' },
  noteCurrency: { cn: '货币', en: 'Currency', id: 'Mata Uang' },
  noteContract: {
    cn: '如有变更以最终签订合同为准。',
    en: 'Subject to the final signed contract.',
    id: 'Mengacu pada kontrak final yang ditandatangani.',
  },
  noteValidity: {
    cn: '报价有效期内有效，过期需重新询价。',
    en: 'Valid within the stated period; a new enquiry is required after expiry.',
    id: 'Berlaku dalam periode tersebut; setelah kedaluwarsa perlu permintaan baru.',
  },
  noteTerms: {
    cn: '付款方式、交货方式、运输费用等以双方协商为准。',
    en: 'Payment terms, delivery method and freight to be mutually agreed.',
    id: 'Syarat pembayaran, pengiriman dan ongkos kirim sesuai kesepakatan kedua pihak.',
  },

  // ---- 发票 ----
  invoiceTitle: { cn: 'INVOICE', en: 'INVOICE', id: 'INVOICE' },
  invoiceNotIssued: { cn: '该报价单尚未开具发票', en: 'No invoice issued for this quotation', id: 'Faktur belum diterbitkan' },
  invoiceHint: {
    cn: '请回到「客户报价 → 详情」点击「开具发票」',
    en: 'Go to Customer Quotes → Detail and click "Issue Invoice"',
    id: 'Buka Penawaran Pelanggan → Detail lalu klik "Terbitkan Faktur"',
  },
  billTo: { cn: '收票方', en: 'BILL TO', id: 'KEPADA' },
  address: { cn: '地址', en: 'Address', id: 'Alamat' },
  poNo: { cn: '发票号', en: 'Invoice No', id: 'No. Faktur' },
  date: { cn: '开票日期', en: 'Date', id: 'Tanggal' },
  itemName: { cn: '品名', en: 'ITEM NAME', id: 'JENIS BARANG' },
  transferTo: { cn: '汇款账户', en: 'TRANSFER TO', id: 'TRANSFER KE' },
  branch: { cn: '支行', en: 'Branch', id: 'Cabang' },
  regards: { cn: '此致', en: 'BEST REGARDS', id: 'HORMAT KAMI' },
  paid: { cn: '已付款', en: 'PAID', id: 'LUNAS' },
  dueDate: { cn: '付款到期', en: 'Due Date', id: 'Jatuh Tempo' },
  contactUs: { cn: '联系我们', en: 'Questions?', id: 'Ada Pertanyaan?' },
  accountName: { cn: '户名', en: 'A/C Name', id: 'Nama Rek.' },
  accountNo: { cn: '账号', en: 'A/C No.', id: 'No. Rek.' },
  termsTitle: { cn: '条款与说明', en: 'Terms & Condition', id: 'Syarat & Ketentuan' },

  invoiceLabel: { cn: '发票', en: 'INVOICE', id: 'FAKTUR' },
  subtotal: { cn: '小计', en: 'Subtotal', id: 'Subtotal' },
  // 部分开票时显示，说明本张发票只开了合同的一部分
  contractTotal: { cn: '合同总额', en: 'Contract Total', id: 'Total Kontrak' },
  thisInvoice: { cn: '本次开票', en: 'This Invoice', id: 'Tagihan Ini' },
  uninvoiced: { cn: '未开票余额', en: 'Remaining (not yet invoiced)', id: 'Sisa belum ditagih' },
  grandTotal: { cn: '总计 GRAND TOTAL', en: 'GRAND TOTAL', id: 'GRAND TOTAL' },
  pphWithheld: { cn: 'PPh 23 代扣', en: 'PPh 23 Withholding', id: 'PPh 23 dipotong' },
  amountDue: { cn: '实付金额', en: 'AMOUNT PAYABLE', id: 'JUMLAH YANG DIBAYAR' },
  paymentInfo: { cn: '付款信息 Payment Information', en: 'Payment Information', id: 'Informasi Pembayaran' },
  bankLabel: { cn: '开户行', en: 'Bank', id: 'Bank' },
  // 运费方式（20261112）
  freightCollect: { cn: '运费：到付', en: 'Freight: Collect (paid by buyer on delivery)', id: 'Ongkos kirim: dibayar penerima' },
  freightFree: { cn: '运费：免运费', en: 'Freight: Free shipping', id: 'Ongkos kirim: gratis' },
  freightIncluded: { cn: '单价已含运费', en: 'Unit prices include freight', id: 'Harga satuan sudah termasuk ongkos kirim' },
  // 客户直付工厂：不印我方任何银行账号
  payToFactory: {
    cn: '本单货款由客户直接支付给供货工厂，请按工厂提供的收款账户付款。',
    en: 'Payment for this order is made directly to the supplying factory. Please pay to the account provided by the factory.',
    id: 'Pembayaran pesanan ini langsung ke pabrik pemasok. Silakan bayar ke rekening yang diberikan pabrik.',
  },

  // ---- 通用 ----
  exportPdf: { cn: '导出 PDF', en: 'Export PDF', id: 'Ekspor PDF' },
  print: { cn: '打印', en: 'Print', id: 'Cetak' },
  companySlogan: {
    cn: '让印尼建材采购更简单',
    en: 'Building materials sourcing made easy',
    id: 'Pengadaan material bangunan jadi mudah',
  },
} satisfies Record<string, Dict>

export type PrintKey = keyof typeof T

/** 取文案；缺翻译时回落中文，避免出现空白 */
export function pt(lang: PrintLang, key: PrintKey): string {
  const row = T[key] as Dict
  return row?.[lang] || row?.cn || ''
}

/** 币种显示名 */
export function currencyLabel(lang: PrintLang, currency: string): string {
  if (currency === 'CNY') {
    return lang === 'cn' ? 'CNY 人民币' : lang === 'id' ? 'CNY (Yuan)' : 'CNY'
  }
  return lang === 'cn' ? 'IDR 印尼盾' : lang === 'id' ? 'IDR (Rupiah)' : 'IDR'
}

/**
 * 单位翻译（20261113）：印尼语用当地报价单 / 建材店的习惯写法，不是直译。
 * 没收录的单位原样输出（多半本来就是 m、kg、pcs 这种通用写法）。
 */
const UNIT_MAP: Record<string, { en: string; id: string }> = {
  个: { en: 'pcs', id: 'pcs' },
  件: { en: 'pcs', id: 'pcs' },
  只: { en: 'pcs', id: 'buah' },
  块: { en: 'pcs', id: 'buah' },
  把: { en: 'pcs', id: 'pcs' },
  套: { en: 'set', id: 'set' },
  组: { en: 'set', id: 'set' },
  对: { en: 'pair', id: 'pasang' },
  根: { en: 'pcs', id: 'batang' },
  支: { en: 'pcs', id: 'batang' },
  条: { en: 'pcs', id: 'batang' },
  张: { en: 'sheet', id: 'lembar' },
  片: { en: 'sheet', id: 'lembar' },
  盒: { en: 'box', id: 'box' },
  箱: { en: 'carton', id: 'dus' },
  包: { en: 'bag', id: 'sak' },
  袋: { en: 'bag', id: 'sak' },
  卷: { en: 'roll', id: 'roll' },
  桶: { en: 'pail', id: 'pail' },
  瓶: { en: 'bottle', id: 'botol' },
  台: { en: 'unit', id: 'unit' },
  米: { en: 'm', id: 'meter' },
  平方: { en: 'm²', id: 'm²' },
  平方米: { en: 'm²', id: 'm²' },
  立方: { en: 'm³', id: 'm³' },
  吨: { en: 'ton', id: 'ton' },
  公斤: { en: 'kg', id: 'kg' },
  千克: { en: 'kg', id: 'kg' },
  斤: { en: '0.5 kg', id: '0,5 kg' },
  车: { en: 'truck', id: 'truk' },
  项: { en: 'lot', id: 'lot' },
  批: { en: 'lot', id: 'lot' },
}

export function unitText(unit: string | undefined, lang: PrintLang): string {
  const u = String(unit || '').trim()
  if (lang === 'cn' || !u) return u
  return UNIT_MAP[u]?.[lang] ?? u
}

/** 明细在单据上显示的物品名 / 规格 / 品牌 / 型号：选了印尼语 / 英文就用确认过的译名，没有译名回落中文（中文会被拦下不许导出） */
const sfx = (lang: PrintLang) => (lang === 'en' ? 'en' : 'id')
const hasTrans = (it: any, lang: PrintLang) => lang !== 'cn' && String(it[`name_${sfx(lang)}`] || '').trim() !== ''
export function itemName(it: any, lang: PrintLang): string {
  if (hasTrans(it, lang)) return it[`name_${sfx(lang)}`]
  return it.display_name || it.product_name || ''
}
export function itemSpec(it: any, lang: PrintLang): string {
  if (hasTrans(it, lang)) return it[`spec_${sfx(lang)}`] || ''
  return it.spec || ''
}
export function itemBrand(it: any, lang: PrintLang): string {
  if (!it.show_brand) return ''
  if (hasTrans(it, lang)) return it[`brand_${sfx(lang)}`] || ''
  return it.brand_display || ''
}
export function itemModel(it: any, lang: PrintLang): string {
  if (!it.show_brand) return ''
  if (hasTrans(it, lang)) return it[`model_${sfx(lang)}`] || ''
  return it.model_display || ''
}

const HAN = /\p{Script=Han}/u

/**
 * 还不能用在印尼语 / 英文单据上的行数：还没有译名，或单据上要印的物品名 / 规格 / 品牌 / 型号里还有中文，
 * 或原来有规格 / 品牌 / 型号但译文是空的
 */
export function untranslatedCount(items: any[], lang: PrintLang): number {
  if (lang === 'cn') return 0
  return (items || []).filter((it) => {
    if (!hasTrans(it, lang)) return true
    const shown = [itemName(it, lang), itemSpec(it, lang), itemBrand(it, lang), itemModel(it, lang)].join(' ')
    if (HAN.test(shown)) return true
    if (String(it.spec || '').trim() && !itemSpec(it, lang).trim()) return true
    if (it.show_brand && String(it.brand_display || '').trim() && !itemBrand(it, lang).trim()) return true
    if (it.show_brand && String(it.model_display || '').trim() && !itemModel(it, lang).trim()) return true
    return false
  }).length
}
