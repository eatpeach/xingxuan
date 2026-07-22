import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Calendar,
  Checkbox,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Spin,
  Tag,
  Tooltip,
  message,
} from 'antd'
import { DeleteOutlined, PlusOutlined, ScheduleOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import { api } from '../api'
import { ROLE_LABEL } from '../roles'

dayjs.extend(isoWeek)

const QUADRANTS: Record<number, { color: string; text: string; bg: string; border: string }> = {
  1: { color: '#cf1322', text: '重要 · 紧急', bg: '#fff1f0', border: '#ffa39e' },
  2: { color: '#d46b08', text: '重要 · 不紧急', bg: '#fff7e6', border: '#ffd591' },
  3: { color: '#1d57e0', text: '不重要 · 紧急', bg: '#e6f0ff', border: '#91b3f0' },
  4: { color: '#389e0d', text: '不重要 · 不紧急', bg: '#f6ffed', border: '#b7eb8f' },
}
const DOW = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

interface Plan {
  id: number
  user_id: number
  plan_date: string
  title: string
  quadrant: number
  status: string
  remark: string
  customer_id: number
  customer_name?: string
  customer_short_name?: string
}

interface TeamUser {
  id: number
  username: string
  name: string
  role: string
}

type CalCount = { total: number; done: number }

// 左侧迷你月历（带 完成/总数 角标）
function MiniCalendar({
  counts,
  selected,
  onSelect,
  onMonthChange,
}: {
  counts: Record<string, CalCount>
  selected: string
  onSelect: (d: Dayjs) => void
  onMonthChange: (start: Dayjs, end: Dayjs) => void
}) {
  return (
    <Calendar
      fullscreen={false}
      value={dayjs(selected)}
      onSelect={(d, info) => {
        if (info.source === 'date') onSelect(d)
      }}
      onPanelChange={(d) => onMonthChange(d.startOf('month').isoWeekday(1), d.endOf('month').isoWeekday(7))}
      fullCellRender={(d) => {
        const key = d.format('YYYY-MM-DD')
        const c = counts[key]
        const isSel = key === selected
        const isToday = key === dayjs().format('YYYY-MM-DD')
        return (
          <div className={'wp-cal-cell' + (isSel ? ' sel' : '') + (isToday ? ' today' : '')}>
            <div className="d">{String(d.date()).padStart(2, '0')}</div>
            {c ? <span className="c">{Number(c.done)}/{Number(c.total)}</span> : <span className="c empty" />}
          </div>
        )
      }}
    />
  )
}

export default function WorkPlanButton() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'mine' | 'team'>('mine')
  const [dayPlans, setDayPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(false)
  const [todayPending, setTodayPending] = useState(0)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Partial<Plan> | null>(null)
  const [saving, setSaving] = useState(false)
  const [customers, setCustomers] = useState<{ label: string; value: number }[]>([])
  const [inquiries, setInquiries] = useState<{ label: string; value: number }[]>([])
  const custTimer = useRef<ReturnType<typeof setTimeout>>()
  const inqTimer = useRef<ReturnType<typeof setTimeout>>()
  const [form] = Form.useForm()

  // 关联客户：按群名（编号/名称）远程模糊搜索
  const searchCustomers = (v: string) => {
    if (custTimer.current) clearTimeout(custTimer.current)
    custTimer.current = setTimeout(async () => {
      try {
        const r = await api.get('listCustomers', { keyword: v.trim(), page: 1, page_size: 10 })
        setCustomers(
          (r.items || []).map((c: any) => ({
            value: c.id,
            label: `[${c.code || c.id}] ${c.short_name || c.name}`,
          })),
        )
      } catch {
        setCustomers([])
      }
    }, 300)
  }

  // 关联商机：按群名/单号/标题远程模糊搜索
  const searchInquiries = (v: string) => {
    if (inqTimer.current) clearTimeout(inqTimer.current)
    inqTimer.current = setTimeout(async () => {
      try {
        const r = await api.get('searchInquiries', { keyword: v.trim() })
        setInquiries(
          (r.items || []).map((i: any) => ({
            value: i.id,
            label: `[${i.no}] ${i.customer_short_name || i.customer_name || ''} ${i.title || ''}`.trim(),
          })),
        )
      } catch {
        setInquiries([])
      }
    }, 300)
  }

  const today = dayjs().format('YYYY-MM-DD')
  const [selDate, setSelDate] = useState(today)
  const [calCounts, setCalCounts] = useState<Record<string, CalCount>>({})
  const [calRange, setCalRange] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf('month').isoWeekday(1),
    dayjs().endOf('month').isoWeekday(7),
  ])
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([])
  const [teamPlans, setTeamPlans] = useState<Plan[]>([])
  const [teamLoading, setTeamLoading] = useState(false)

  const loadBadge = useCallback(() => {
    api
      .get('listWorkPlans', { start: today, end: today })
      .then((r) => setTodayPending((r.items || []).filter((p: Plan) => p.status !== 'done').length))
      .catch(() => {})
  }, [today])

  const loadDay = useCallback(() => {
    setLoading(true)
    api
      .get('listWorkPlans', { start: selDate, end: selDate })
      .then((r) => setDayPlans(r.items || []))
      .finally(() => setLoading(false))
  }, [selDate])

  const loadCal = useCallback(() => {
    api
      .get('workPlanCalendar', {
        start: calRange[0].format('YYYY-MM-DD'),
        end: calRange[1].format('YYYY-MM-DD'),
        scope: view === 'team' ? 'team' : 'mine',
      })
      .then((r) => {
        const m: Record<string, CalCount> = {}
        for (const it of r.items || []) m[it.plan_date] = { total: Number(it.total), done: Number(it.done) }
        setCalCounts(m)
      })
      .catch(() => {})
  }, [calRange, view])

  const loadTeam = useCallback(() => {
    setTeamLoading(true)
    api
      .get('listTeamWorkPlans', { date: selDate })
      .then((r) => {
        setTeamUsers(r.users || [])
        setTeamPlans(r.items || [])
      })
      .finally(() => setTeamLoading(false))
  }, [selDate])

  useEffect(() => {
    loadBadge()
  }, [loadBadge])

  useEffect(() => {
    if (open && view === 'mine') loadDay()
  }, [open, view, loadDay])

  useEffect(() => {
    if (open) loadCal()
  }, [open, loadCal])

  useEffect(() => {
    if (open && view === 'team') loadTeam()
  }, [open, view, loadTeam])

  const refresh = () => {
    loadBadge()
    loadCal()
    if (view === 'team') loadTeam()
    else loadDay()
  }

  const openEdit = (p: Partial<Plan>) => {
    setEditing(p)
    form.setFieldsValue({
      title: p.title || '',
      plan_date: p.plan_date ? dayjs(p.plan_date) : dayjs(),
      quadrant: p.quadrant || 2,
      customer_id: p.customer_id || undefined,
      inquiry_id: (p as any).inquiry_id || undefined,
      remark: p.remark || '',
    })
    // 编辑时把当前关联项放进选项，避免只显示 id
    setCustomers(
      p.customer_id
        ? [{ value: p.customer_id, label: `[${(p as any).customer_code || p.customer_id}] ${p.customer_short_name || p.customer_name || ''}` }]
        : [],
    )
    setInquiries(
      (p as any).inquiry_id
        ? [{ value: (p as any).inquiry_id, label: `[${(p as any).inquiry_no || (p as any).inquiry_id}] ${p.customer_short_name || p.customer_name || ''}` }]
        : [],
    )
    setEditOpen(true)
  }

  const save = async () => {
    try {
      const v = await form.validateFields()
      setSaving(true)
      await api.post('saveWorkPlan', {
        id: editing?.id,
        title: v.title,
        plan_date: v.plan_date.format('YYYY-MM-DD'),
        quadrant: v.quadrant,
        customer_id: v.customer_id || 0,
        inquiry_id: v.inquiry_id || 0,
        remark: v.remark || '',
      })
      message.success('已保存')
      setEditOpen(false)
      refresh()
    } catch (e: any) {
      if (e?.errorFields) return
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (p: Plan) => {
    setDayPlans((arr) => arr.map((x) => (x.id === p.id ? { ...x, status: p.status === 'done' ? 'pending' : 'done' } : x)))
    try {
      await api.post('toggleWorkPlanDone', { id: p.id })
      loadBadge()
      loadCal()
    } catch {
      loadDay()
    }
  }

  const del = async (p: Plan) => {
    await api.post('deleteWorkPlan', { id: p.id })
    message.success('已删除')
    refresh()
  }

  const dowText = DOW[dayjs(selDate).isoWeekday() - 1]

  // 团队看板：按角色分组
  const roleGroups: Record<string, TeamUser[]> = {}
  for (const u of teamUsers) (roleGroups[u.role] ||= []).push(u)
  const teamByUser: Record<number, Plan[]> = {}
  for (const p of teamPlans) (teamByUser[p.user_id] ||= []).push(p)

  return (
    <>
      <span className="gn-wp-trigger" onClick={() => setOpen(true)}>
        <Badge count={todayPending} size="small" offset={[2, -2]}>
          <ScheduleOutlined className="gn-wp-icon" />
        </Badge>
        <span>工作计划</span>
      </span>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width="min(1360px, 98vw)"
        title={
          <div className="gn-wp-head">
            <span>工作计划</span>
            <Segmented
              options={[
                { label: '我的计划', value: 'mine' },
                { label: '团队看板', value: 'team' },
              ]}
              value={view}
              onChange={(v) => setView(v as 'mine' | 'team')}
            />
          </div>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit({ plan_date: selDate })}>
            新增计划
          </Button>
        }
      >
        <div className="gn-wp-layout">
          {/* 左：迷你月历 */}
          <div className="gn-wp-cal">
            <MiniCalendar
              counts={calCounts}
              selected={selDate}
              onSelect={(d) => setSelDate(d.format('YYYY-MM-DD'))}
              onMonthChange={(s, e) => setCalRange([s, e])}
            />
            <div className="gn-wp-legend vertical">
              {Object.entries(QUADRANTS).map(([k, q]) => (
                <span key={k}>
                  <span className="dot" style={{ background: q.color }} />
                  {q.text}
                </span>
              ))}
            </div>
          </div>

          {/* 右：当日我的计划 / 团队看板 */}
          {view === 'mine' ? (
            <div className="gn-wp-main">
              <div className="gn-wp-mine-head">
                <span className="gn-wp-team-title" style={{ marginBottom: 0 }}>
                  {selDate}（{dowText}）的工作计划
                  {selDate === today && <Tag color="blue" style={{ marginLeft: 8 }}>今天</Tag>}
                </span>
                <span className="gn-wp-donecnt">
                  已完成 {dayPlans.filter((p) => p.status === 'done').length} / {dayPlans.length}
                </span>
              </div>
              <Spin spinning={loading}>
                <div className="gn-wp-quad-grid">
                  {[1, 2, 3, 4].map((qn) => {
                    const q = QUADRANTS[qn]
                    const qPlans = dayPlans.filter((p) => (p.quadrant >= 1 && p.quadrant <= 4 ? p.quadrant : 2) === qn)
                    return (
                      <div key={qn} className="gn-wp-quad" style={{ borderColor: q.border }}>
                        <div className="q-head" style={{ background: q.bg, color: q.color }}>
                          {q.text}
                        </div>
                        <div className="q-body">
                          {qPlans.length === 0 ? (
                            <div className="q-empty">暂无</div>
                          ) : (
                            qPlans.map((p) => (
                              <div key={p.id} className={'gn-wp-item row' + (p.status === 'done' ? ' done' : '')}>
                                <Checkbox checked={p.status === 'done'} onChange={() => toggle(p)} />
                                <span className="ttl" onClick={() => openEdit(p)}>
                                  {p.title}
                                  {p.customer_id ? (
                                    <Tag style={{ marginLeft: 8 }}>{p.customer_short_name || p.customer_name}</Tag>
                                  ) : null}
                                </span>
                                {p.remark ? (
                                  <Tooltip title={p.remark}>
                                    <span className="rmk">备注</span>
                                  </Tooltip>
                                ) : null}
                                <Popconfirm title="删除该计划？" onConfirm={() => del(p)}>
                                  <DeleteOutlined className="del" />
                                </Popconfirm>
                              </div>
                            ))
                          )}
                          <Button
                            type="text"
                            size="small"
                            icon={<PlusOutlined />}
                            className="gn-wp-add"
                            onClick={() => openEdit({ plan_date: selDate, quadrant: qn })}
                          >
                            添加
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Spin>
            </div>
          ) : (
            <div className="gn-wp-main">
              <div className="gn-wp-team-title">{selDate} 团队工作计划</div>
              <Spin spinning={teamLoading}>
                {teamUsers.length === 0 ? (
                  <Empty description="没有启用中的用户" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  Object.entries(roleGroups).map(([role, us]) => (
                    <div key={role} className="gn-wp-team-group">
                      <div className="g-head">
                        <span className="bar" />
                        {ROLE_LABEL[role] || role}
                        <span className="cnt">({us.length})</span>
                      </div>
                      <div className="g-grid">
                        {us.map((u) => {
                          const ups = teamByUser[u.id] || []
                          return (
                            <div key={u.id} className="g-card">
                              <div className="g-user">
                                <span className="name">{u.name || u.username}</span>
                                {ups.length === 0 ? (
                                  <Tag>当日未填</Tag>
                                ) : (
                                  <span className="stat">
                                    {ups.filter((p) => p.status === 'done').length}/{ups.length}
                                  </span>
                                )}
                              </div>
                              {ups.map((p) => (
                                <div key={p.id} className={'g-plan' + (p.status === 'done' ? ' done' : '')}>
                                  <span
                                    className="q"
                                    style={{ background: QUADRANTS[p.quadrant]?.color || '#8c8c8c' }}
                                  />
                                  <span className="t">{p.title}</span>
                                </div>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </Spin>
            </div>
          )}
        </div>
      </Drawer>

      {/* Drawer 内 Modal 必须 zIndex 9999，否则被 Drawer 盖住 */}
      <Modal
        open={editOpen}
        zIndex={9999}
        title={editing?.id ? '编辑计划' : '新增计划'}
        onCancel={() => setEditOpen(false)}
        onOk={save}
        confirmLoading={saving}
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="计划内容" rules={[{ required: true, message: '请输入计划内容' }]}>
            <Input maxLength={200} placeholder="要做什么" />
          </Form.Item>
          <Form.Item name="plan_date" label="日期" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="quadrant" label="优先级（四象限）">
            <Select
              options={Object.entries(QUADRANTS).map(([k, q]) => ({
                value: Number(k),
                label: (
                  <span>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        background: q.color,
                        marginRight: 8,
                      }}
                    />
                    {q.text}
                  </span>
                ),
              }))}
            />
          </Form.Item>
          <Form.Item name="customer_id" label="关联客户（选填，输入群名/编号模糊搜索）">
            <Select
              allowClear
              showSearch
              filterOption={false}
              placeholder="输入群名或群编号搜索"
              options={customers}
              onSearch={searchCustomers}
              notFoundContent={null}
            />
          </Form.Item>
          <Form.Item name="inquiry_id" label="关联商机（选填，按群名/单号搜索）">
            <Select
              allowClear
              showSearch
              filterOption={false}
              placeholder="输入群名或商机单号搜索"
              options={inquiries}
              onSearch={searchInquiries}
              onFocus={() => !inquiries.length && searchInquiries('')}
              notFoundContent={null}
            />
          </Form.Item>
          <Form.Item name="remark" label="备注（选填）">
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
