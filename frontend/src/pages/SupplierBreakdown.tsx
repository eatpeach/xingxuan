import { Empty, Table, Tag, Tooltip, Typography } from 'antd'

/**
 * 多供应商拆分表（20260824）
 *
 * 长清单常常一半走 A 家一半走 B 家。以前报价/订单上只看得到一个供应商名，
 * 「该给谁下单、各下多少钱」全靠脑子记。这里按报价明细的来源行实时拆开。
 */
export default function SupplierBreakdown({
  suppliers,
  currency,
  compact,
}: {
  suppliers: any[]
  currency?: string
  compact?: boolean
}) {
  const sym = currency === 'CNY' ? '¥' : 'Rp'
  const fmt = (n: number) => `${sym} ${Math.round(Number(n) || 0).toLocaleString()}`
  const list = suppliers || []

  if (list.length === 0) {
    return <Empty description="还没有明细" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }

  const costAll = list.reduce((s, g) => s + Number(g.cost_total || 0), 0)
  const sellAll = list.reduce((s, g) => s + Number(g.sell_total || 0), 0)
  const unassigned = list.find((g) => g.supplier_id === null)

  return (
    <div>
      <Table
        size="small"
        rowKey={(r: any) => String(r.supplier_id ?? 'none')}
        dataSource={list}
        pagination={false}
        expandable={{
          expandedRowRender: (g: any) => (
            <Table
              size="small"
              rowKey="item_id"
              dataSource={g.items || []}
              pagination={false}
              columns={[
                { title: '产品', dataIndex: 'product_name', render: (v: string) => <strong>{v}</strong> },
                { title: '规格', dataIndex: 'spec', render: (v: string) => v || <span style={{ color: '#bfbfbf' }}>-</span> },
                {
                  title: '数量',
                  width: 100,
                  render: (_: any, r: any) => (
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.qty} {r.unit}</span>
                  ),
                },
                {
                  title: '采购单价',
                  width: 120,
                  align: 'right' as const,
                  render: (_: any, r: any) => fmt(r.cost_price),
                },
                {
                  title: '采购小计',
                  width: 130,
                  align: 'right' as const,
                  render: (_: any, r: any) => <strong>{fmt(r.line_cost)}</strong>,
                },
              ]}
            />
          ),
        }}
        columns={[
          {
            title: '供应商',
            render: (_: any, g: any) =>
              g.supplier_id === null ? (
                <Tooltip title="这些行没有关联供应商报价（手填成本价生成的），下单前记得确认由谁供货">
                  <Tag color="warning" style={{ marginInlineEnd: 0 }}>⚠ 未指定供应商</Tag>
                </Tooltip>
              ) : (
                <Tag color="purple" style={{ marginInlineEnd: 0 }}>{g.supplier_name}</Tag>
              ),
          },
          { title: '行数', dataIndex: 'lines', width: 70, align: 'right' as const },
          {
            title: '采购成本',
            width: 150,
            align: 'right' as const,
            render: (_: any, g: any) => (
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(g.cost_total)}</span>
            ),
          },
          ...(compact
            ? []
            : [
                {
                  title: '对客售价',
                  width: 150,
                  align: 'right' as const,
                  render: (_: any, g: any) => (
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(g.sell_total)}</span>
                  ),
                },
                {
                  title: '毛利',
                  width: 150,
                  align: 'right' as const,
                  render: (_: any, g: any) => {
                    const p = Number(g.profit_total || 0)
                    return (
                      <strong style={{ color: p >= 0 ? '#52c41a' : '#ff4d4f', fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(p)}
                      </strong>
                    )
                  },
                },
              ]),
          {
            title: '占比',
            width: 80,
            align: 'right' as const,
            render: (_: any, g: any) =>
              costAll > 0 ? `${Math.round((Number(g.cost_total) / costAll) * 100)}%` : '—',
          },
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}><strong>合计</strong></Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">
              <strong>{list.reduce((s, g) => s + Number(g.lines || 0), 0)}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right"><strong>{fmt(costAll)}</strong></Table.Summary.Cell>
            {!compact && (
              <>
                <Table.Summary.Cell index={3} align="right"><strong>{fmt(sellAll)}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  <strong style={{ color: '#52c41a' }}>{fmt(sellAll - costAll)}</strong>
                </Table.Summary.Cell>
              </>
            )}
            <Table.Summary.Cell index={compact ? 3 : 5} align="right">100%</Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
      {unassigned && (
        <Typography.Text type="warning" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          有 {unassigned.lines} 行还没指定供应商（手填成本价生成的）。下单前建议回「对比供应商报价」补选。
        </Typography.Text>
      )}
    </div>
  )
}

/** 一行摘要：报价/订单列表里用 */
export function SupplierTags({ suppliers, max = 3 }: { suppliers: any[]; max?: number }) {
  const named = (suppliers || []).filter((g) => g.supplier_id !== null)
  const unassigned = (suppliers || []).find((g) => g.supplier_id === null)
  if (named.length === 0 && !unassigned) return <span style={{ color: '#bfbfbf' }}>-</span>
  return (
    <span>
      {named.slice(0, max).map((g) => (
        <Tag key={g.supplier_id} color="purple" style={{ marginInlineEnd: 4 }}>
          {g.supplier_name}
          <span style={{ opacity: 0.7, marginLeft: 4 }}>{g.lines}行</span>
        </Tag>
      ))}
      {named.length > max && <Tag style={{ marginInlineEnd: 4 }}>+{named.length - max}</Tag>}
      {unassigned && (
        <Tooltip title={`${unassigned.lines} 行未指定供应商`}>
          <Tag color="warning" style={{ marginInlineEnd: 0 }}>⚠{unassigned.lines}</Tag>
        </Tooltip>
      )}
    </span>
  )
}
