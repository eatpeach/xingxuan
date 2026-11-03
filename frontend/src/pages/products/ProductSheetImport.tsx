import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Cascader,
  Checkbox,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Upload,
  message,
} from 'antd'
import { FileExcelOutlined } from '@ant-design/icons'
import { api } from '../../api'
import { toCascaderOptions } from '../vendor/ProductFormDrawer'
import type { CatNode } from '../vendor/ProductFormDrawer'
import {
  PointsPicker,
  SELL_FROM_OPTS,
  fmtRp,
  moneyInputProps,
  parseNum,
  rangeFromCost,
  sellFromRange,
  usePoints,
} from './pricing'

type Field = 'name' | 'spec' | 'brand' | 'model' | 'unit' | 'cost_price' | 'base_price' | 'category' | 'moq' | 'description'

const FIELDS: { key: Field; label: string; required?: boolean }[] = [
  { key: 'name', label: '品名', required: true },
  { key: 'spec', label: '规格' },
  { key: 'brand', label: '品牌' },
  { key: 'model', label: '型号' },
  { key: 'unit', label: '单位' },
  { key: 'cost_price', label: '成本价' },
  { key: 'base_price', label: '出售价' },
  { key: 'category', label: '品类' },
  { key: 'moq', label: '起订量' },
  { key: 'description', label: '备注' },
]

// 按顺序匹配，靠前的先占列。中文 / 印尼文 / 英文表头都认
const ALIASES: [Field, RegExp][] = [
  ['spec', /规格|尺寸|ukuran|spesifikasi|spec|size|dimensi/i],
  ['brand', /品牌|merk|merek|brand/i],
  ['model', /型号|tipe|type|model|kode/i],
  ['unit', /单位|satuan|unit|uom/i],
  // 供应商给的表，价格列默认就是我们的成本价；总价 / 金额 / 合计不是单价，下面会排除
  ['cost_price', /单价|价格|报价|底价|供货价|成本|harga|price/i],
  ['category', /品类|分类|类别|kategori|category/i],
  ['moq', /起订|moq|minimum|min\.?\s*order/i],
  ['description', /备注|说明|keterangan|remark|note|catatan/i],
  ['name', /品名|名称|产品|商品|货物|nama|barang|item|product|description|deskripsi/i],
]
const NOT_UNIT_PRICE = /总价|总额|金额|合计|小计|total|jumlah|subtotal|amount/i

function guessHeader(rows: string[][]): number {
  let best = 0
  let bestScore = -1
  rows.slice(0, 15).forEach((r, i) => {
    const score = r.filter((c) => c && ALIASES.some(([, re]) => re.test(c))).length
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}

function guessMapping(header: string[]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {}
  const used = new Set<number>()
  for (const [field, re] of ALIASES) {
    if (map[field] != null) continue
    const idx = header.findIndex((h, i) => !used.has(i) && h && re.test(h) && !(field === 'cost_price' && NOT_UNIT_PRICE.test(h)))
    if (idx >= 0) {
      map[field] = idx
      used.add(idx)
    }
  }
  return map
}

interface Row {
  key: number
  name: string
  spec: string
  brand: string
  model: string
  unit: string
  category: string
  description: string
  moq: number | null
  cost_price: number | null
  base_price: number | null
}

interface Props {
  open: boolean
  suppliers: { label: string; value: number }[]
  categories: CatNode[]
  onClose: () => void
  onDone: () => void
}

export default function ProductSheetImport({ open, suppliers, categories, onClose, onDone }: Props) {
  const [supplierId, setSupplierId] = useState<number>()
  const [parsing, setParsing] = useState(false)
  const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[]>([])
  const [fileName, setFileName] = useState('')
  const [sheetIdx, setSheetIdx] = useState(0)
  const [headerIdx, setHeaderIdx] = useState(0)
  const [mapping, setMapping] = useState<Partial<Record<Field, number>>>({})
  const [edits, setEdits] = useState<Record<number, Partial<Row>>>({})
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [usePts, setUsePts] = useState(true)
  const [pts, setPts] = usePoints()
  const [sellFrom, setSellFrom] = useState('')
  const [status, setStatus] = useState<'off' | 'pending'>('off')
  const [catPath, setCatPath] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setSheets([])
    setFileName('')
    setEdits({})
    setExcluded(new Set())
    setMapping({})
  }

  const pickSheet = (all: { name: string; rows: string[][] }[], i: number) => {
    setSheetIdx(i)
    const rows = all[i]?.rows || []
    const h = guessHeader(rows)
    setHeaderIdx(h)
    setMapping(guessMapping(rows[h] || []))
    setEdits({})
    setExcluded(new Set())
  }

  const rawRows = sheets[sheetIdx]?.rows || []
  const header = rawRows[headerIdx] || []
  const colCount = Math.max(0, ...rawRows.slice(0, 50).map((r) => r.length))
  const colOptions = Array.from({ length: colCount }, (_, i) => ({
    value: i,
    label: `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''} · ${header[i] || '(无表头)'}`,
  }))

  // 表格行 → 商品行（叠加人工改过的值）
  const rows: Row[] = useMemo(() => {
    const cell = (r: string[], f: Field) => (mapping[f] != null ? String(r[mapping[f]!] ?? '').trim() : '')
    const out: Row[] = []
    rawRows.slice(headerIdx + 1).forEach((r, i) => {
      const key = headerIdx + 1 + i
      const base: Row = {
        key,
        name: cell(r, 'name'),
        spec: cell(r, 'spec'),
        brand: cell(r, 'brand'),
        model: cell(r, 'model'),
        unit: cell(r, 'unit'),
        category: cell(r, 'category'),
        description: cell(r, 'description'),
        moq: parseNum(cell(r, 'moq')),
        cost_price: parseNum(cell(r, 'cost_price')),
        base_price: parseNum(cell(r, 'base_price')),
      }
      const row = { ...base, ...edits[key] }
      // 空行、小计行、表尾签字这类没有品名或没有任何价格的跳过
      if (!row.name || ((row.cost_price ?? 0) <= 0 && (row.base_price ?? 0) <= 0)) return
      out.push(row)
    })
    return out
  }, [rawRows, headerIdx, mapping, edits])

  const withRange = (r: Row) => {
    if (!usePts || !r.cost_price || r.cost_price <= 0) return { ...r, quote_min: null, quote_max: null, sell: r.base_price }
    const rg = rangeFromCost(r.cost_price, pts.ptMin, pts.ptMax, pts.unit)
    const s = sellFromRange(rg.min, rg.max, sellFrom, pts.unit)
    return { ...r, quote_min: rg.min, quote_max: rg.max, sell: s ?? r.base_price }
  }

  const chosen = rows.filter((r) => !excluded.has(r.key))

  const submit = async () => {
    if (!supplierId) return message.warning('请选择供应商')
    if (mapping.name == null) return message.warning('请指定「品名」在哪一列')
    if (!chosen.length) return message.warning('没有可导入的行')
    setSaving(true)
    try {
      const payload = chosen.map((r) => {
        const x = withRange(r)
        return {
          name: x.name,
          spec: x.spec,
          brand: x.brand,
          model: x.model,
          unit: x.unit,
          category: x.category,
          description: x.description,
          moq: x.moq,
          cost_price: x.cost_price,
          base_price: x.sell,
          quote_min: x.quote_min,
          quote_max: x.quote_max,
          quote_pt_min: x.quote_min != null ? Math.min(pts.ptMin, pts.ptMax) : null,
          quote_pt_max: x.quote_max != null ? Math.max(pts.ptMin, pts.ptMax) : null,
        }
      })
      const r = await api.post('adminImportProducts', {
        supplier_id: supplierId,
        rows: payload,
        status,
        category: catPath[catPath.length - 1] || '',
      })
      message.success(`导入完成：新增 ${r.created} 个，更新 ${r.updated} 个${r.skipped ? `，跳过 ${r.skipped} 行` : ''}`)
      reset()
      onDone()
    } catch (e: any) {
      message.error(e?.message || '导入失败')
    } finally {
      setSaving(false)
    }
  }

  const setEdit = (key: number, patch: Partial<Row>) => setEdits((e) => ({ ...e, [key]: { ...e[key], ...patch } }))

  return (
    <Modal
      title="表格录入商品"
      open={open}
      onCancel={() => {
        if (saving) return
        reset()
        onClose()
      }}
      width={Math.min(1100, window.innerWidth - 24)}
      zIndex={1100}
      destroyOnClose
      okText={`导入 ${chosen.length} 个商品`}
      okButtonProps={{ disabled: !sheets.length || !chosen.length || !supplierId, loading: saving }}
      onOk={submit}
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <span>供应商</span>
        <Select
          style={{ width: 280 }}
          options={suppliers}
          showSearch
          optionFilterProp="label"
          placeholder="这份表是哪家供应商的"
          value={supplierId}
          onChange={setSupplierId}
        />
        {sheets.length > 0 && (
          <Button size="small" onClick={reset}>
            换一个文件
          </Button>
        )}
      </Space>

      {!sheets.length ? (
        <Spin spinning={parsing} tip="读取中...">
          <Upload.Dragger
            accept=".xlsx,.csv"
            showUploadList={false}
            customRequest={async ({ file }) => {
              setParsing(true)
              try {
                const fd = new FormData()
                fd.append('file', file as File)
                const r = await api.upload('adminParseProductSheet', fd)
                const all = r.sheets || []
                // 默认挑行数最多的那页，供应商的表常有封面页 / 说明页
                let best = 0
                all.forEach((s: any, i: number) => {
                  if (s.rows.length > (all[best]?.rows.length || 0)) best = i
                })
                setSheets(all)
                setFileName((file as File).name)
                pickSheet(all, best)
              } catch (e: any) {
                message.error(e?.message || '读取失败')
              } finally {
                setParsing(false)
              }
            }}
          >
            <p style={{ fontSize: 36, color: '#52c41a', margin: '8px 0' }}>
              <FileExcelOutlined />
            </p>
            <p style={{ fontSize: 15 }}>把供应商发来的表格拖进来（.xlsx / .csv）</p>
            <p style={{ fontSize: 12, color: '#98a1b3' }}>不用改格式，下一步会预览，让你确认每一列是什么</p>
          </Upload.Dragger>
        </Spin>
      ) : (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={
              <span>
                {fileName}：识别到 <b>{rows.length}</b> 行商品。系统已自动对好列，不对的话在下面改。
                同一供应商下「品名 + 规格」已存在的商品会更新价格，不会重复新建。
              </span>
            }
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginBottom: 12 }}>
            {sheets.length > 1 && (
              <div>
                <div style={{ fontSize: 12, color: '#666' }}>工作表</div>
                <Select
                  style={{ width: '100%' }}
                  value={sheetIdx}
                  onChange={(i) => pickSheet(sheets, i)}
                  options={sheets.map((s, i) => ({ value: i, label: `${s.name}（${s.rows.length} 行）` }))}
                />
              </div>
            )}
            <div>
              <div style={{ fontSize: 12, color: '#666' }}>表头在第几行</div>
              <Select
                style={{ width: '100%' }}
                value={headerIdx}
                onChange={(h) => {
                  setHeaderIdx(h)
                  setMapping(guessMapping(rawRows[h] || []))
                  setEdits({})
                }}
                options={rawRows.slice(0, 15).map((r, i) => ({
                  value: i,
                  label: `第 ${i + 1} 行：${r.filter(Boolean).slice(0, 4).join(' / ').slice(0, 40)}`,
                }))}
              />
            </div>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <div style={{ fontSize: 12, color: '#666' }}>
                  {f.label}
                  {f.required ? <span style={{ color: '#e64545' }}> *</span> : null}
                </div>
                <Select
                  style={{ width: '100%' }}
                  allowClear
                  placeholder="不导入"
                  value={mapping[f.key]}
                  options={colOptions}
                  onChange={(v) => {
                    setMapping((m) => ({ ...m, [f.key]: v }))
                    setEdits({})
                  }}
                />
              </div>
            ))}
          </div>

          <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <Checkbox checked={usePts} onChange={(e) => setUsePts(e.target.checked)} style={{ marginBottom: 8 }}>
              <b>按点位生成对客报价区间</b>
              <span style={{ color: '#999', marginLeft: 6 }}>（成本价 × (1 + 点位%)，四舍五入）</span>
            </Checkbox>
            {usePts && (
              <>
                <PointsPicker value={pts} onChange={setPts} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={{ width: 64, color: '#666', flexShrink: 0 }}>出售价</span>
                  <Radio.Group
                    size="small"
                    optionType="button"
                    value={sellFrom}
                    onChange={(e) => setSellFrom(e.target.value)}
                    options={SELL_FROM_OPTS.map((o) => (o.value === '' ? { ...o, label: '用表里的 / 不填' } : o))}
                  />
                </div>
              </>
            )}
          </div>

          <Space wrap style={{ marginBottom: 12 }}>
            <span>导入后状态</span>
            <Radio.Group
              size="small"
              optionType="button"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { label: '放进库里（不上架）', value: 'off' },
                { label: '待审核', value: 'pending' },
              ]}
            />
            <span style={{ marginLeft: 8 }}>统一品类</span>
            <Cascader
              size="small"
              style={{ width: 220 }}
              allowClear
              changeOnSelect
              showSearch
              placeholder="可选；表里有品类列的以表为准"
              options={toCascaderOptions(categories)}
              value={catPath}
              onChange={(v) => setCatPath((v as string[]) || [])}
            />
          </Space>

          <Table
            size="small"
            rowKey="key"
            dataSource={rows.map(withRange)}
            pagination={{ pageSize: 50, showSizeChanger: false, size: 'small' }}
            scroll={{ x: 900, y: 360 }}
            rowSelection={{
              selectedRowKeys: chosen.map((r) => r.key),
              onChange: (keys) => {
                const set = new Set(keys as number[])
                setExcluded(new Set(rows.filter((r) => !set.has(r.key)).map((r) => r.key)))
              },
            }}
            columns={[
              { title: '行', dataIndex: 'key', width: 50, render: (k: number) => k + 1 },
              { title: '品名', dataIndex: 'name', ellipsis: true },
              { title: '规格', dataIndex: 'spec', width: 140, ellipsis: true },
              { title: '单位', dataIndex: 'unit', width: 80 },
              {
                title: '成本价',
                dataIndex: 'cost_price',
                width: 130,
                render: (v: number | null, r: Row) => (
                  <InputNumber
                    size="small"
                    min={0}
                    value={v ?? undefined}
                    style={{ width: '100%' }}
                    {...moneyInputProps}
                    onChange={(n) => setEdit(r.key, { cost_price: n == null ? null : Number(n) })}
                  />
                ),
              },
              {
                title: '出售价',
                dataIndex: 'sell',
                width: 130,
                render: (v: number | null, r: Row) =>
                  usePts && sellFrom ? (
                    <span>{fmtRp(v)}</span>
                  ) : (
                    <InputNumber
                      size="small"
                      min={0}
                      value={v ?? undefined}
                      style={{ width: '100%' }}
                      placeholder="可不填"
                      {...moneyInputProps}
                      onChange={(n) => setEdit(r.key, { base_price: n == null ? null : Number(n) })}
                    />
                  ),
              },
              {
                title: '报价区间',
                width: 190,
                render: (_: any, r: any) =>
                  r.quote_min != null ? (
                    <span>
                      {fmtRp(r.quote_min)} ~ {fmtRp(r.quote_max)}
                    </span>
                  ) : (
                    <Tag>{usePts ? '缺成本价' : '-'}</Tag>
                  ),
              },
            ]}
          />
        </>
      )}
    </Modal>
  )
}
