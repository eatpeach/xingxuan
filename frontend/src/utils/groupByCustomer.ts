/**
 * 把行按 customer_id 分组并保持组内原顺序：
 *  - 同一客户的多行连续排列
 *  - _gi: 组内序号（从 1 开始）
 *  - _gs: 该组总行数
 *  用于表格 onCell rowSpan 合并相同客户的单元格。
 */
export function groupByCustomer<T extends { customer_id: number }>(
  rows: T[],
): Array<T & { _gi: number; _gs: number }> {
  const byCust = new Map<number, T[]>()
  for (const r of rows) {
    const k = (r as any).customer_id
    if (!byCust.has(k)) byCust.set(k, [])
    byCust.get(k)!.push(r)
  }
  const out: Array<T & { _gi: number; _gs: number }> = []
  byCust.forEach((list) => {
    list.forEach((r, i) => out.push({ ...(r as any), _gi: i + 1, _gs: list.length }))
  })
  return out
}

/** 给客户单元格用：第一行 rowSpan = 整组长度，其余行 rowSpan = 0（即被合并） */
export function customerCellMerge(r: any) {
  return { rowSpan: r._gi === 1 ? r._gs : 0 }
}
