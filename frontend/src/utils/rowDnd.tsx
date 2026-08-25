import { useEffect, useRef, useState } from 'react'

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

/**
 * 可直接改数字的序号格（20260825）
 *
 * 拖拽适合挪一两格，但「把第 5 项挪到第 40 项」拖起来很痛苦——
 * 长清单要按住拖过几十行、表格还会跟着滚。直接改数字是长列表的正解。
 *
 * 交互：显示当前行号，改完按回车或点走即生效；超出范围自动夹到 1~total。
 */
export function OrderNoInput({
  index,
  total,
  onJump,
  disabled,
}: {
  /** 当前行下标（0 开始） */
  index: number
  total: number
  /** 把这一行移动到 to（0 开始） */
  onJump: (from: number, to: number) => void
  disabled?: boolean
}) {
  const [val, setVal] = useState<string>(String(index + 1))
  const [editing, setEditing] = useState(false)

  // 拖拽/上下按钮改了顺序后，没在编辑的格子要跟着刷新
  useEffect(() => {
    if (!editing) setVal(String(index + 1))
  }, [index, editing])

  const commit = () => {
    setEditing(false)
    const n = parseInt(val, 10)
    if (!Number.isFinite(n)) {
      setVal(String(index + 1))
      return
    }
    const to = Math.min(total, Math.max(1, n)) - 1
    if (to === index) {
      setVal(String(index + 1))
      return
    }
    onJump(index, to)
  }

  if (disabled) return <span>{index + 1}</span>

  return (
    <input
      value={val}
      onChange={(e) => {
        setEditing(true)
        setVal(e.target.value.replace(/[^\d]/g, ''))
      }}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setVal(String(index + 1))
          setEditing(false)
          ;(e.target as HTMLInputElement).blur()
        }
        // 别让方向键/退格冒泡到表格的拖拽处理
        e.stopPropagation()
      }}
      title="改成目标序号后回车，即可跳到那一行的位置"
      style={{
        width: 42,
        padding: '1px 2px',
        textAlign: 'center',
        border: '1px solid transparent',
        borderRadius: 4,
        background: 'transparent',
        color: 'inherit',
        fontVariantNumeric: 'tabular-nums',
        outline: 'none',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.border = '1px solid #d9d9d9')}
      onMouseLeave={(e) => {
        if (document.activeElement !== e.currentTarget) e.currentTarget.style.border = '1px solid transparent'
      }}
    />
  )
}
