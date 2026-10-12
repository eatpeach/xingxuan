import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Button, Calendar, Checkbox, DatePicker, Empty, Input, Popconfirm, Progress,
  Segmented, Select, Space, Spin, Tag, Tooltip, message,
} from 'antd'
import { DeleteOutlined, LeftOutlined, PlusOutlined, RightOutlined, SwapRightOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { api } from '../api'

/**
 * 工作台 ·「工作计划」页签（20261012）
 *
 * 老板要的是一打开工作台就能看到今天要干什么、顺手打勾，
 * 而不是再点右上角按钮拉一个抽屉出来。数据和右上角那个是同一套 work_plans，
 * 这里只是把「今天」这一天搬到工作台上，完整的周视图 / 团队看板仍在抽屉里。
 */

const QUADRANTS: Record<number, { color: string; text: string; bg: string; border: string }> = {
  1: { color: '#cf1322', text: '重要 · 紧急', bg: '#fff1f0', border: '#ffa39e' },
  2: { color: '#d46b08', text: '重要 · 不紧急', bg: '#fff7e6', border: '#ffd591' },
  3: { color: '#1d57e0', text: '不重要 · 紧急', bg: '#e6f0ff', border: '#91b3f0' },
  4: { color: '#389e0d', text: '不重要 · 不紧急', bg: '#f6ffed', border: '#b7eb8f' },
}

interface Plan {
  id: number
  plan_date: string
  title: string
  quadrant: number
  status: string
  remark: string
  customer_id: number
  inquiry_id: number
  customer_short_name?: string
  customer_name?: string
}

export default function TodayPlans() {
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [plans, setPlans] = useState<Plan[]>([])
  const [leftover, setLeftover] = useState<Plan[]>([]) // 之前没做完的
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [quadrant, setQuadrant] = useState<number>(1)
  const [view, setView] = useState<'list' | 'quad' | 'cal'>(() => {
    try { return (localStorage.getItem('plan_view') as any) || 'list' } catch { return 'list' }
  })
  // 日历视图：当前翻到的月份 + 这个月所有计划
  const [month, setMonth] = useState<Dayjs>(dayjs())
  const [monthPlans, setMonthPlans] = useState<Plan[]>([])

  const ds = date.format('YYYY-MM-DD')
  const isToday = date.isSame(dayjs(), 'day')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('listWorkPlans', { start: ds, end: ds })
      setPlans(r.items || [])
      // 只有看「今天」时才翻旧账：过去 14 天没勾掉的，提示挪到今天，
      // 不然昨天没做完的事第二天就从眼前消失了
      if (isToday) {
        const r2 = await api.get('listWorkPlans', {
          start: dayjs().subtract(14, 'day').format('YYYY-MM-DD'),
          end: dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
        })
        setLeftover((r2.items || []).filter((p: Plan) => p.status !== 'done'))
      } else {
        setLeftover([])
      }
    } finally {
      setLoading(false)
    }
  }, [ds, isToday])

  useEffect(() => { load() }, [load])

  // 日历要整月的数据。往前后各多拿一周：月历首尾那几格是上/下月的日子，也要显示计划
  const loadMonth = useCallback(async () => {
    const start = month.startOf('month').subtract(7, 'day').format('YYYY-MM-DD')
    const end = month.endOf('month').add(14, 'day').format('YYYY-MM-DD')
    const r = await api.get('listWorkPlans', { start, end })
    setMonthPlans(r.items || [])
  }, [month])

  useEffect(() => { if (view === 'cal') loadMonth() }, [view, loadMonth])

  const changeView = (v: 'list' | 'quad' | 'cal') => {
    setView(v)
    try { localStorage.setItem('plan_view', v) } catch { /* 写不进就算了 */ }
  }

  const add = async () => {
    const t = title.trim()
    if (!t) return
    await api.post('saveWorkPlan', { title: t, plan_date: ds, quadrant })
    setTitle('')
    load()
    if (view === 'cal') loadMonth()
  }

  const toggle = async (p: Plan) => {
    // 先在界面上打勾，别让人等接口 —— 勾待办要的就是那一下的手感
    setPlans((list) => list.map((x) => (x.id === p.id ? { ...x, status: x.status === 'done' ? 'pending' : 'done' } : x)))
    setMonthPlans((list) => list.map((x) => (x.id === p.id ? { ...x, status: x.status === 'done' ? 'pending' : 'done' } : x)))
    try {
      await api.post('toggleWorkPlanDone', { id: p.id })
    } catch {
      load()
      if (view === 'cal') loadMonth()
    }
  }

  const remove = async (p: Plan) => {
    await api.post('deleteWorkPlan', { id: p.id })
    load()
    if (view === 'cal') loadMonth()
  }

  const moveToToday = async (items: Plan[]) => {
    const today = dayjs().format('YYYY-MM-DD')
    for (const p of items) {
      await api.post('saveWorkPlan', {
        id: p.id, title: p.title, plan_date: today, quadrant: p.quadrant,
        customer_id: p.customer_id || 0, inquiry_id: p.inquiry_id || 0, remark: p.remark || '',
      })
    }
    message.success(`已把 ${items.length} 条挪到今天`)
    load()
    if (view === 'cal') loadMonth()
  }

  const done = plans.filter((p) => p.status === 'done').length
  const pct = plans.length ? Math.round((done / plans.length) * 100) : 0
  // 没做完的排前面、重要紧急排前面
  const sorted = [...plans].sort((a, b) =>
    (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || a.quadrant - b.quadrant || a.id - b.id)

  const renderItem = (p: Plan, compact = false) => {
    const q = QUADRANTS[p.quadrant] || QUADRANTS[2]
    const isDone = p.status === 'done'
    return (
      <div key={p.id} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '6px 8px' : '10px 12px',
        borderRadius: 6, marginBottom: 6, background: isDone ? '#fafafa' : '#fff',
        border: '1px solid #f0f0f0', borderLeft: `3px solid ${isDone ? '#d9d9d9' : q.color}`,
      }}>
        <Checkbox checked={isDone} onChange={() => toggle(p)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: isDone ? '#bfbfbf' : '#1f1f1f', textDecoration: isDone ? 'line-through' : undefined,
            wordBreak: 'break-all',
          }}>
            {p.title}
          </div>
          {(p.customer_short_name || p.customer_name) && (
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>客户：{p.customer_short_name || p.customer_name}</div>
          )}
        </div>
        {!compact && <Tag color={isDone ? 'default' : undefined} style={{ color: isDone ? undefined : q.color, background: isDone ? undefined : q.bg, borderColor: isDone ? undefined : q.border, marginInlineEnd: 0 }}>{q.text}</Tag>}
        <Popconfirm title="删除这条？" onConfirm={() => remove(p)}>
          <DeleteOutlined style={{ color: '#bfbfbf', cursor: 'pointer' }} />
        </Popconfirm>
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 20 }}>
      {/* 头部：日期切换 + 完成进度 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Space size={4}>
          <Button size="small" icon={<LeftOutlined />} onClick={() => setDate((d) => d.subtract(1, 'day'))} />
          <DatePicker value={date} onChange={(d) => d && setDate(d)} allowClear={false} size="small" />
          <Button size="small" icon={<RightOutlined />} onClick={() => setDate((d) => d.add(1, 'day'))} />
          {!isToday && <Button size="small" type="link" onClick={() => setDate(dayjs())}>回到今天</Button>}
        </Space>
        <span style={{ fontSize: 16, fontWeight: 600 }}>
          {isToday ? '今日待办' : `${date.format('M月D日')} 的计划`}
        </span>
        <span style={{ color: '#8c8c8c' }}>已完成 {done} / {plans.length}</span>
        <Progress percent={pct} size="small" style={{ width: 160, margin: 0 }} />
        <Segmented
          style={{ marginLeft: 'auto' }}
          size="small"
          value={view}
          onChange={(v) => changeView(v as any)}
          options={[
            { label: '列表', value: 'list' },
            { label: '四象限', value: 'quad' },
            { label: '日历', value: 'cal' },
          ]}
        />
      </div>

      {/* 快速添加：回车就加，不弹窗 */}
      <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
        <Select
          value={quadrant}
          onChange={setQuadrant}
          style={{ width: 150 }}
          options={[1, 2, 3, 4].map((k) => ({ value: k, label: QUADRANTS[k].text }))}
        />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onPressEnter={add}
          placeholder={isToday ? '今天要做什么？输入后回车' : '给这一天加一条计划，回车添加'}
          maxLength={200}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={add}>添加</Button>
      </Space.Compact>

      {leftover.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`之前还有 ${leftover.length} 条没做完`}
          description={
            <div>
              <div style={{ marginBottom: 8, maxHeight: 120, overflow: 'auto' }}>
                {leftover.slice(0, 8).map((p) => (
                  <div key={p.id} style={{ fontSize: 13 }}>
                    <span style={{ color: '#8c8c8c', marginRight: 6 }}>{p.plan_date.slice(5)}</span>
                    {p.title}
                  </div>
                ))}
                {leftover.length > 8 && <div style={{ color: '#8c8c8c', fontSize: 12 }}>…还有 {leftover.length - 8} 条</div>}
              </div>
              <Tooltip title="原日期改成今天，进今日待办">
                <Button size="small" icon={<SwapRightOutlined />} onClick={() => moveToToday(leftover)}>
                  全部挪到今天
                </Button>
              </Tooltip>
            </div>
          }
        />
      )}

      {view === 'cal' && (
        <div className="plan-cal" style={{ marginBottom: 16 }}>
          <style>{`
            .plan-cal .ant-picker-calendar-date-content { height: 92px !important; overflow: hidden; }
            .plan-cal .pc-item { font-size: 12px; line-height: 18px; padding: 0 4px; border-radius: 3px;
              margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .plan-cal .pc-done { color: #bfbfbf !important; text-decoration: line-through; background: #fafafa !important; }
          `}</style>
          <Calendar
            value={date}
            onSelect={(d, info) => {
              setDate(d)
              // 点到上/下月的格子时顺手翻过去
              if (info?.source === 'date' && !d.isSame(month, 'month')) setMonth(d)
            }}
            onPanelChange={(d) => setMonth(d)}
            cellRender={(current, info) => {
              if (info.type !== 'date') return info.originNode
              const dk = current.format('YYYY-MM-DD')
              const list = monthPlans
                .filter((p) => p.plan_date === dk)
                .sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || a.quadrant - b.quadrant)
              if (!list.length) return null
              const shown = list.slice(0, 3)
              const doneN = list.filter((p) => p.status === 'done').length
              return (
                <div>
                  {shown.map((p) => {
                    const q = QUADRANTS[p.quadrant] || QUADRANTS[2]
                    return (
                      <Tooltip key={p.id} title={`${q.text}：${p.title}`}>
                        <div
                          className={'pc-item' + (p.status === 'done' ? ' pc-done' : '')}
                          style={{ background: q.bg, color: q.color, borderLeft: `2px solid ${q.color}` }}
                        >
                          {p.title}
                        </div>
                      </Tooltip>
                    )
                  })}
                  <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                    {list.length > 3 ? `+${list.length - 3} 条 · ` : ''}完成 {doneN}/{list.length}
                  </div>
                </div>
              )
            }}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 8px' }}>
            {date.format('M月D日')} 的计划（点日历上的格子切换日期）
          </div>
        </div>
      )}

      <Spin spinning={loading}>
        {plans.length === 0 ? (
          <Empty description={isToday ? '今天还没有计划，上面输入一条回车就行' : '这一天没有计划'} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : view !== 'quad' ? (
          <div>{sorted.map((p) => renderItem(p))}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {[1, 2, 3, 4].map((k) => {
              const q = QUADRANTS[k]
              const list = sorted.filter((p) => p.quadrant === k)
              return (
                <div key={k} style={{ background: q.bg, border: `1px solid ${q.border}`, borderRadius: 8, padding: 12, minHeight: 120 }}>
                  <div style={{ color: q.color, fontWeight: 600, marginBottom: 8 }}>
                    {q.text} <span style={{ fontWeight: 400, color: '#8c8c8c' }}>({list.length})</span>
                  </div>
                  {list.length === 0
                    ? <div style={{ color: '#bfbfbf', fontSize: 12 }}>无</div>
                    : list.map((p) => renderItem(p, true))}
                </div>
              )
            })}
          </div>
        )}
      </Spin>

      <div style={{ marginTop: 12, color: '#8c8c8c', fontSize: 12 }}>
        周视图、团队看板、关联客户/商机 —— 点右上角「工作计划」打开完整版，数据是同一份。
      </div>
    </div>
  )
}
