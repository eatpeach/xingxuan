import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Checkbox,
  DatePicker,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Tag,
  Tooltip,
  message,
} from 'antd'
import { DeleteOutlined, LeftOutlined, PlusOutlined, RightOutlined, ScheduleOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import { api } from '../api'

dayjs.extend(isoWeek)

const QUADRANTS: Record<number, { color: string; text: string }> = {
  1: { color: '#e02020', text: '重要且紧急' },
  2: { color: '#fa8c16', text: '重要不紧急' },
  3: { color: '#1d57e0', text: '紧急不重要' },
  4: { color: '#8c8c8c', text: '不重要不紧急' },
}
const DOW = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

interface Plan {
  id: number
  plan_date: string
  title: string
  quadrant: number
  status: string
  remark: string
  customer_id: number
  customer_name?: string
  customer_short_name?: string
}

export default function WorkPlanButton() {
  const [open, setOpen] = useState(false)
  const [weekStart, setWeekStart] = useState<Dayjs>(dayjs().isoWeekday(1).startOf('day'))
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(false)
  const [todayPending, setTodayPending] = useState(0)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Partial<Plan> | null>(null)
  const [saving, setSaving] = useState(false)
  const [customers, setCustomers] = useState<{ label: string; value: number }[]>([])
  const [form] = Form.useForm()

  const today = dayjs().format('YYYY-MM-DD')
  const weekEnd = weekStart.add(6, 'day')

  const loadBadge = useCallback(() => {
    api
      .get('listWorkPlans', { start: today, end: today })
      .then((r) => setTodayPending((r.items || []).filter((p: Plan) => p.status !== 'done').length))
      .catch(() => {})
  }, [today])

  const loadWeek = useCallback(() => {
    setLoading(true)
    api
      .get('listWorkPlans', { start: weekStart.format('YYYY-MM-DD'), end: weekEnd.format('YYYY-MM-DD') })
      .then((r) => setPlans(r.items || []))
      .finally(() => setLoading(false))
  }, [weekStart]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadBadge()
  }, [loadBadge])

  useEffect(() => {
    if (open) loadWeek()
  }, [open, loadWeek])

  const refresh = () => {
    loadWeek()
    loadBadge()
  }

  const openEdit = (p: Partial<Plan>) => {
    setEditing(p)
    form.setFieldsValue({
      title: p.title || '',
      plan_date: p.plan_date ? dayjs(p.plan_date) : dayjs(),
      quadrant: p.quadrant || 2,
      customer_id: p.customer_id || undefined,
      remark: p.remark || '',
    })
    if (!customers.length) {
      api
        .get('listCustomers', { page: 1, page_size: 500 })
        .then((r) => setCustomers((r.items || []).map((c: any) => ({ label: c.short_name || c.name, value: c.id }))))
        .catch(() => {})
    }
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
    setPlans((arr) => arr.map((x) => (x.id === p.id ? { ...x, status: p.status === 'done' ? 'pending' : 'done' } : x)))
    try {
      await api.post('toggleWorkPlanDone', { id: p.id })
      loadBadge()
    } catch {
      loadWeek()
    }
  }

  const del = async (p: Plan) => {
    await api.post('deleteWorkPlan', { id: p.id })
    message.success('已删除')
    refresh()
  }

  const days = Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'))
  const byDate: Record<string, Plan[]> = {}
  for (const p of plans) (byDate[p.plan_date] ||= []).push(p)

  return (
    <>
      <span className="gn-wp-trigger" onClick={() => setOpen(true)}>
        <Badge count={todayPending} size="small" offset={[2, -2]}>
          <ScheduleOutlined style={{ fontSize: 16, color: 'inherit' }} />
        </Badge>
        <span>工作计划</span>
      </span>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width="min(1240px, 96vw)"
        title={
          <div className="gn-wp-head">
            <span>工作计划</span>
            <span className="gn-wp-nav">
              <Button size="small" icon={<LeftOutlined />} onClick={() => setWeekStart((d) => d.subtract(7, 'day'))} />
              <Button size="small" onClick={() => setWeekStart(dayjs().isoWeekday(1).startOf('day'))}>
                本周
              </Button>
              <Button size="small" icon={<RightOutlined />} onClick={() => setWeekStart((d) => d.add(7, 'day'))} />
              <span className="range">
                {weekStart.format('YYYY-MM-DD')} ~ {weekEnd.format('MM-DD')}
              </span>
            </span>
          </div>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit({ plan_date: today })}>
            新增计划
          </Button>
        }
      >
        <Spin spinning={loading}>
          <div className="gn-wp-legend">
            {Object.entries(QUADRANTS).map(([k, q]) => (
              <span key={k}>
                <span className="dot" style={{ background: q.color }} />
                {q.text}
              </span>
            ))}
          </div>
          <div className="gn-wp-grid">
            {days.map((d) => {
              const key = d.format('YYYY-MM-DD')
              const isToday = key === today
              return (
                <div
                  key={key}
                  className={'gn-wp-day' + (isToday ? ' today' : '') + (d.isoWeekday() > 5 ? ' weekend' : '')}
                >
                  <div className="gn-wp-day-head">
                    <span className="dow">{DOW[d.isoWeekday() - 1]}</span>
                    <span className="date">{d.format('MM-DD')}</span>
                    {isToday && <Tag color="blue">今天</Tag>}
                  </div>
                  <div className="gn-wp-items">
                    {(byDate[key] || []).map((p) => (
                      <div key={p.id} className={'gn-wp-item' + (p.status === 'done' ? ' done' : '')}>
                        <Checkbox checked={p.status === 'done'} onChange={() => toggle(p)} />
                        <Tooltip
                          title={
                            <>
                              <div>{QUADRANTS[p.quadrant]?.text}</div>
                              {p.customer_id ? <div>客户：{p.customer_short_name || p.customer_name}</div> : null}
                              {p.remark ? <div>备注:{p.remark}</div> : null}
                            </>
                          }
                        >
                          <span
                            className="ttl"
                            style={{ borderLeft: `3px solid ${QUADRANTS[p.quadrant]?.color || '#8c8c8c'}` }}
                            onClick={() => openEdit(p)}
                          >
                            {p.title}
                          </span>
                        </Tooltip>
                        <Popconfirm title="删除该计划？" onConfirm={() => del(p)}>
                          <DeleteOutlined className="del" />
                        </Popconfirm>
                      </div>
                    ))}
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      className="gn-wp-add"
                      onClick={() => openEdit({ plan_date: key })}
                    >
                      添加
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </Spin>
      </Drawer>

      {/* Drawer 内 Modal 必须 zIndex 9999，否则被 Drawer 盖住 */}
      <Modal
        open={editOpen}
        zIndex={9999}
        title={editing?.id ? '编辑计划' : '新增计划'}
        onCancel={() => setEditOpen(false)}
        onOk={save}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
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
          <Form.Item name="customer_id" label="关联客户（选填）">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="不关联"
              options={customers}
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
