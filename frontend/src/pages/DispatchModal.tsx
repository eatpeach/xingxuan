import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import { api } from '../api'

/**
 * 按分类拆单派给不同供应商（20260824）
 *
 * 真实流程：一张 50 行的清单，电缆派给 A 家、管材派给 B 家、五金派给 C 家。
 * 以前是整单群发，每家都收到全部 50 行，得自己在里面找能报的那几行。
 * 现在：勾行 → 选供应商 → 派单。可以分多次派，界面上实时显示还有几行没派。
 */
export default function DispatchModal({
  inquiry,
  onDispatched,
}: {
  inquiry: any
  onDispatched: () => void
}) {
  const [open, setOpen] = useState(false)
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [supplierIds, setSupplierIds] = useState<number[]>([])
  const [selectedItems, setSelectedItems] = useState<number[]>([])
  const [rangeText, setRangeText] = useState('')
  const lastClickIdx = useRef<number | null>(null)
  const [coverage, setCoverage] = useState<any>({ items: [], uncovered: 0, total: 0 })
  const [kw, setKw] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [sup, cov] = await Promise.all([
        api.get('listSuppliers', { page_size: 200 }),
        api.get('getDispatchCoverage', { id: inquiry.id }),
      ])
      setSuppliers(sup.items || [])
      setCoverage(cov)
      // 默认勾上「还没派出去」的行 —— 最常见的操作是把剩下的继续派完
      setSelectedItems((cov.items || []).filter((r: any) => r.suppliers.length === 0).map((r: any) => r.id))
      setSupplierIds([])
      setKw('')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  const rows = useMemo(() => {
    const all = coverage.items || []
    if (!kw.trim()) return all
    const k = kw.trim().toLowerCase()
    return all.filter(
      (r: any) =>
        String(r.product_name || '').toLowerCase().includes(k) ||
        String(r.spec || '').toLowerCase().includes(k),
    )
  }, [coverage, kw])

  const submit = async () => {
    if (supplierIds.length === 0) return message.warning('请选择供应商')
    if (selectedItems.length === 0) return message.warning('请勾选要派给他们的明细行')
    setSubmitting(true)
    try {
      const r = await api.post('dispatchInquiry', {
        id: inquiry.id,
        supplier_ids: supplierIds,
        item_ids: selectedItems,
        expire_days: 7,
      })
      const names = suppliers.filter((s) => supplierIds.includes(s.id)).map((s) => s.name).join('、')
      message.success(
        `已把 ${selectedItems.length} 行派给 ${names}` +
          (r.updated?.length ? `（其中 ${r.updated.length} 家是追加到已有派单）` : ''),
        5,
      )
      // 不关窗：接着可以给下一家派剩下的行
      await load()
      onDispatched()
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '派单失败')
    } finally {
      setSubmitting(false)
    }
  }

  const uncoveredNow = (coverage.items || []).filter((r: any) => r.suppliers.length === 0).length

  /**
   * 序号区间选择（20260825）
   *
   * 长清单按分类派单时，「第 10 到 25 行是管材」这种连续段最常见，
   * 一行行点勾太折磨人。支持 10-25、10-25,30、40-45 混写。
   * 认的是表上显示的行号（line_no），不是数组下标 —— 老板看到几就写几。
   */
  const parseRange = (text: string): number[] => {
    const wanted = new Set<number>()
    // 先把连接符两边的空格收掉：「8 到 12」不能被空格拆成 8 和 12 两个孤立行号
    const normalized = text.replace(/\s*[-~—到至]\s*/g, '-')
    for (const seg of normalized.split(/[,，、;；\s]+/)) {
      if (!seg) continue
      const m = seg.match(/^(\d+)-(\d+)$/)
      if (m) {
        let a = parseInt(m[1], 10)
        let b = parseInt(m[2], 10)
        if (a > b) [a, b] = [b, a]      // 写反了也认
        for (let i = a; i <= b; i++) wanted.add(i)
      } else if (/^\d+$/.test(seg)) {
        wanted.add(parseInt(seg, 10))
      }
    }
    if (!wanted.size) return []
    // 只在当前筛选结果里取，行为和「全选当前」一致
    return rows.filter((r: any) => wanted.has(Number(r.line_no))).map((r: any) => r.id)
  }

  const applyRange = (mode: 'set' | 'add' | 'remove') => {
    const ids = parseRange(rangeText)
    if (!ids.length) {
      message.warning('没解析出行号。写法如 10-25 或 10-25,30,40-45')
      return
    }
    setSelectedItems((prev) => {
      if (mode === 'set') return ids
      if (mode === 'add') return Array.from(new Set([...prev, ...ids]))
      const drop = new Set(ids)
      return prev.filter((x) => !drop.has(x))
    })
    message.success(`${mode === 'remove' ? '取消' : '选中'} ${ids.length} 行`)
  }

  /** Shift + 点行：从上次点的那行连选到这行，比敲区间还快 */
  const onRowClick = (rec: any, index: number, e: React.MouseEvent) => {
    const id = rec.id
    if (e.shiftKey && lastClickIdx.current !== null) {
      const a = Math.min(lastClickIdx.current, index)
      const b = Math.max(lastClickIdx.current, index)
      const ids = rows.slice(a, b + 1).map((r: any) => r.id)
      setSelectedItems((prev) => Array.from(new Set([...prev, ...ids])))
      window.getSelection()?.removeAllRanges()   // 别把表格文字也刷蓝
    } else {
      setSelectedItems((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      )
    }
    lastClickIdx.current = index
  }

  return (
    <>
      <Button type="primary" icon={<SendOutlined />} onClick={() => setOpen(true)}>
        派单（按分类拆分）
      </Button>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        okText={`派给选中供应商（${selectedItems.length} 行）`}
        cancelText="关闭"
        width={980}
        destroyOnClose
        title={
          <Space>
            <span>派单 · {inquiry?.no}</span>
            {uncoveredNow > 0 ? (
              <Tag color="warning" style={{ marginInlineEnd: 0 }}>还有 {uncoveredNow} 行没派</Tag>
            ) : (
              <Tag color="success" style={{ marginInlineEnd: 0 }}>全部行已派出</Tag>
            )}
          </Space>
        }
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="一张清单可以拆开派给多家"
            description={
              <span style={{ fontSize: 12 }}>
                比如电缆勾上派给 A 家 → 再把管材勾上派给 B 家。供应商打开链接只会看到分给他的那几行。
                <br />
                派完一批不用关窗，接着勾下一批就行。<strong>不勾任何行 = 整单派给对方</strong>（老行为）。
              </span>
            }
          />

          <div>
            <Space wrap style={{ marginBottom: 8 }}>
              <Input.Search
                placeholder="按产品名/规格筛选，如：电缆"
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                style={{ width: 240 }}
                allowClear
              />
              <Button size="small" onClick={() => setSelectedItems(rows.map((r: any) => r.id))}>
                全选当前 {rows.length} 行
              </Button>
              <Button
                size="small"
                onClick={() =>
                  setSelectedItems(rows.filter((r: any) => r.suppliers.length === 0).map((r: any) => r.id))
                }
              >
                只选未派的
              </Button>
              <Button size="small" onClick={() => setSelectedItems([])}>清空</Button>
            </Space>

            <Space wrap style={{ marginBottom: 8 }}>
              <Input
                placeholder="按序号选，如 10-25 或 10-25,30,40-45"
                value={rangeText}
                onChange={(e) => setRangeText(e.target.value)}
                onPressEnter={() => applyRange('set')}
                style={{ width: 260 }}
                allowClear
              />
              <Button size="small" type="primary" ghost onClick={() => applyRange('set')}>选中这段</Button>
              <Button size="small" onClick={() => applyRange('add')}>追加</Button>
              <Button size="small" onClick={() => applyRange('remove')}>取消这段</Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                也可以点一行、再按住 Shift 点另一行，中间整段选中
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已勾 <strong style={{ color: '#1d57e0' }}>{selectedItems.length}</strong> / {coverage.total} 行
              </Typography.Text>
            </Space>

            <Table
              size="small"
              rowKey="id"
              loading={loading}
              dataSource={rows}
              pagination={false}
              scroll={{ y: 300 }}
              rowSelection={{
                selectedRowKeys: selectedItems,
                onChange: (keys) => setSelectedItems(keys as number[]),
                preserveSelectedRowKeys: true,
              }}
              onRow={(record, index) => ({
                onClick: (e) => onRowClick(record, index as number, e),
                style: { cursor: 'pointer' },
              })}
              columns={[
                { title: '#', dataIndex: 'line_no', width: 50 },
                { title: '产品名', dataIndex: 'product_name', render: (v: string) => <strong>{v}</strong> },
                { title: '规格', dataIndex: 'spec', render: (v: string) => v || <span style={{ color: '#bfbfbf' }}>-</span> },
                {
                  title: '数量',
                  width: 100,
                  render: (_: any, r: any) => `${r.qty} ${r.unit}`,
                },
                {
                  title: '已派给',
                  width: 220,
                  render: (_: any, r: any) =>
                    r.suppliers.length === 0 ? (
                      <Tag color="warning" style={{ marginInlineEnd: 0 }}>未派</Tag>
                    ) : (
                      <Space size={[2, 2]} wrap>
                        {r.suppliers.map((n: string) => (
                          <Tag key={n} color="blue" style={{ marginInlineEnd: 0 }}>{n}</Tag>
                        ))}
                      </Space>
                    ),
                },
              ]}
            />
          </div>

          <div>
            <Typography.Text type="secondary">把勾选的行派给 *</Typography.Text>
            <Select
              mode="multiple"
              style={{ width: '100%', marginTop: 4 }}
              placeholder="选择供应商（可多选，他们会各自收到相同的这批行）"
              value={supplierIds}
              onChange={setSupplierIds}
              optionFilterProp="label"
              options={suppliers.map((s) => ({
                label: `${s.name}（${s.category || '通用'}）`,
                value: s.id,
              }))}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              选多家 = 这批行同时向他们询价，回来后在对比表里逐行选最优的那家。
            </Typography.Text>
          </div>
        </Space>
      </Modal>
    </>
  )
}

/** 派单覆盖提示条：放在派单区块顶部 */
export function DispatchCoverageHint({ inquiryId, refreshKey }: { inquiryId: number; refreshKey?: any }) {
  const [cov, setCov] = useState<any>(null)
  useEffect(() => {
    let alive = true
    api
      .get('getDispatchCoverage', { id: inquiryId })
      .then((r) => { if (alive) setCov(r) })
      .catch(() => {})
    return () => { alive = false }
  }, [inquiryId, refreshKey])
  if (!cov || cov.total === 0) return null
  if (cov.uncovered === 0) {
    return (
      <Tag color="success" style={{ marginInlineEnd: 0 }}>
        {cov.total} 行全部已派出
      </Tag>
    )
  }
  const names = cov.items.filter((r: any) => r.suppliers.length === 0).slice(0, 5).map((r: any) => r.product_name)
  return (
    <Tooltip title={`未派：${names.join('、')}${cov.uncovered > 5 ? ' 等' : ''}`}>
      <Tag color="warning" style={{ marginInlineEnd: 0, cursor: 'help' }}>
        ⚠ 还有 {cov.uncovered} / {cov.total} 行没派给任何供应商
      </Tag>
    </Tooltip>
  )
}
