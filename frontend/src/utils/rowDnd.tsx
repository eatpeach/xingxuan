import { useRef, useState } from 'react'

/**
 * 表格行拖拽排序（原生 HTML5 DnD，不引第三方库）—— 20260824
 *
 * 用法：
 *   const dnd = useRowDnd((from, to) => setRows(reorder(rows, from, to)))
 *   <Table onRow={(_, index) => dnd.rowProps(index!)} />
 *   列里放 <span {...dnd.handleProps}>⠿</span> 作为拖拽把手（可选，整行也能拖）
 */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = list.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function useRowDnd(onMove: (from: number, to: number) => void, enabled = true) {
  const dragFrom = useRef<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  const rowProps = (index: number) => {
    if (!enabled) return {}
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        dragFrom.current = index
        setDragging(index)
        e.dataTransfer.effectAllowed = 'move'
        // Firefox 不设 data 不触发 drag
        try { e.dataTransfer.setData('text/plain', String(index)) } catch {}
      },
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (overIdx !== index) setOverIdx(index)
      },
      onDragLeave: () => {
        if (overIdx === index) setOverIdx(null)
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        const from = dragFrom.current
        if (from !== null && from !== index) onMove(from, index)
        dragFrom.current = null
        setOverIdx(null)
        setDragging(null)
      },
      onDragEnd: () => {
        dragFrom.current = null
        setOverIdx(null)
        setDragging(null)
      },
      className: [
        'dnd-row',
        dragging === index ? 'dnd-row-dragging' : '',
        overIdx === index && dragging !== index ? 'dnd-row-over' : '',
      ].filter(Boolean).join(' '),
      style: { cursor: enabled ? 'grab' : undefined },
    } as any
  }

  return { rowProps, dragging, overIdx }
}

/** 拖拽把手图标（放在第一列） */
export function DragHandle({ disabled }: { disabled?: boolean }) {
  return (
    <span
      title={disabled ? '当前不可排序' : '按住拖动可调整顺序'}
      style={{
        cursor: disabled ? 'not-allowed' : 'grab',
        color: disabled ? '#d9d9d9' : '#8c8c8c',
        fontSize: 15,
        userSelect: 'none',
        lineHeight: 1,
        display: 'inline-block',
      }}
    >
      ⠿
    </span>
  )
}

/** 一次性注入的全局样式（拖拽高亮） */
export const dndStyles = `
.dnd-row { transition: background .12s, box-shadow .12s; }
.dnd-row-dragging > td { opacity: .4; }
.dnd-row-over > td {
  background: #e6f0ff !important;
  box-shadow: inset 0 2px 0 0 #1d57e0;
}
`
