import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Calendar,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  PageContainer,
  ProCard,
} from '@ant-design/pro-components'
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { api } from '../api'
import { getHolidays } from '../data/holidays'

interface CalendarEvent {
  id: number
  user_id: number
  title: string
  description: string
  start_at: string
  end_at: string | null
  all_day: number
  category: string
}

const CATEGORIES: Record<string, { label: string; color: string; badge: any }> = {
  visit: { label: '拜访客户', color: 'blue', badge: 'processing' },
  follow: { label: '跟进供应商', color: 'orange', badge: 'warning' },
  meeting: { label: '内部会议', color: 'purple', badge: 'default' },
  other: { label: '其他', color: 'default', badge: 'default' },
}

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState<Dayjs>(dayjs())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [selectedDate, setSelectedDate] = useState<Dayjs | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [diaryContent, setDiaryContent] = useState('')
  const [diaryLoading, setDiaryLoading] = useState(false)
  const [diarySaving, setDiarySaving] = useState(false)
  const [diaryDirty, setDiaryDirty] = useState(false)
  const diarySaveTimer = useRef<any>(null)

  const monthStart = currentMonth.startOf('month').startOf('week').format('YYYY-MM-DD 00:00:00')
  const monthEnd = currentMonth.endOf('month').endOf('week').format('YYYY-MM-DD 23:59:59')

  const loadEvents = async () => {
    const r = await api.get('listCalendarEvents', { start: monthStart, end: monthEnd })
    setEvents(r.items || [])
  }

  useEffect(() => {
    loadEvents()
  }, [currentMonth])

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const e of events) {
      const key = e.start_at.slice(0, 10)
      if (!map[key]) map[key] = []
      map[key].push(e)
    }
    return map
  }, [events])

  const dateCellRender = (value: Dayjs) => {
    const key = value.format('YYYY-MM-DD')
    const list = eventsByDay[key] || []
    const holidays = getHolidays(key)
    if (list.length === 0 && holidays.length === 0) return null

    // 同一天可能既有中国节又有印尼节，合并按国家分组展示
    const cnHols = holidays.filter((h) => h.country === 'CN')
    const idHols = holidays.filter((h) => h.country === 'ID')

    return (
      <div style={{ fontSize: 12 }}>
        {cnHols.length > 0 && (
          <div className="hol-tag hol-cn" title={cnHols.map((h) => h.name).join(' / ')}>
            🇨🇳 {cnHols.map((h) => h.name).join('·')}
          </div>
        )}
        {idHols.length > 0 && (
          <div className="hol-tag hol-id" title={idHols.map((h) => h.name).join(' / ')}>
            🇮🇩 {idHols.map((h) => h.name).join(' · ')}
          </div>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {list.slice(0, 3).map((e) => {
            const cat = CATEGORIES[e.category] || CATEGORIES.other
            return (
              <li key={e.id} style={{ fontSize: 12, lineHeight: '18px' }}>
                <Badge status={cat.badge} text={
                  <span style={{ fontSize: 12 }}>
                    {e.all_day ? '' : e.start_at.slice(11, 16) + ' '}
                    {e.title}
                  </span>
                } />
              </li>
            )
          })}
          {list.length > 3 && (
            <li style={{ fontSize: 11, color: '#8c8c8c' }}>+ {list.length - 3} 更多</li>
          )}
        </ul>
      </div>
    )
  }

  const openDay = async (d: Dayjs) => {
    setSelectedDate(d)
    setDrawerOpen(true)
    setDiaryLoading(true)
    setDiaryDirty(false)
    try {
      const r = await api.get('getDiary', { date: d.format('YYYY-MM-DD') })
      setDiaryContent(r.data?.content || '')
    } finally {
      setDiaryLoading(false)
    }
  }

  const saveDiary = async () => {
    if (!selectedDate || !diaryDirty) return
    setDiarySaving(true)
    try {
      await api.post('saveDiary', {
        date: selectedDate.format('YYYY-MM-DD'),
        content: diaryContent,
      })
      setDiaryDirty(false)
    } finally {
      setDiarySaving(false)
    }
  }

  // debounce auto-save
  useEffect(() => {
    if (!diaryDirty || !selectedDate) return
    if (diarySaveTimer.current) clearTimeout(diarySaveTimer.current)
    diarySaveTimer.current = setTimeout(() => {
      saveDiary()
    }, 1500)
    return () => clearTimeout(diarySaveTimer.current)
  }, [diaryContent, diaryDirty])

  const dayEvents = selectedDate
    ? (eventsByDay[selectedDate.format('YYYY-MM-DD')] || []).slice().sort((a, b) =>
        a.start_at.localeCompare(b.start_at),
      )
    : []

  return (
    <PageContainer
      title="日历 / 行程 / 工作日记"
      extra={
        <Space>
          <Button onClick={() => setCurrentMonth(dayjs())}>今天</Button>
        </Space>
      }
    >
      <ProCard bordered>
        <Calendar
          value={currentMonth}
          onPanelChange={(d) => setCurrentMonth(d)}
          onSelect={(d) => openDay(d)}
          cellRender={(date, info) => (info.type === 'date' ? dateCellRender(date) : null)}
        />
      </ProCard>

      <Drawer
        open={drawerOpen}
        width={620}
        title={
          selectedDate ? (
            <Space size="small" wrap>
              <span>{selectedDate.format('YYYY-MM-DD dddd')}</span>
              {getHolidays(selectedDate.format('YYYY-MM-DD')).map((h, i) => (
                <Tag key={i} color={h.country === 'CN' ? 'red' : 'orange'}>
                  {h.country === 'CN' ? '🇨🇳' : '🇮🇩'} {h.name}
                </Tag>
              ))}
            </Space>
          ) : (
            ''
          )
        }
        onClose={async () => {
          if (diaryDirty) await saveDiary()
          setDrawerOpen(false)
        }}
        destroyOnClose
        extra={
          selectedDate && (
            <EventEditor
              date={selectedDate}
              onSaved={() => loadEvents()}
              trigger={
                <Button type="primary" icon={<PlusOutlined />}>
                  新建事件
                </Button>
              }
            />
          )
        }
      >
        {/* 事件区 */}
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          事件
        </Typography.Title>
        {dayEvents.length === 0 ? (
          <Empty
            description="今天还没有事件"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ margin: '12px 0' }}
          />
        ) : (
          <div className="cal-events">
            {dayEvents.map((e) => {
              const cat = CATEGORIES[e.category] || CATEGORIES.other
              return (
                <div key={e.id} className="cal-event-row">
                  <div className="cal-event-time">
                    {e.all_day ? (
                      <Tag color="gold">全天</Tag>
                    ) : (
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {e.start_at.slice(11, 16)}
                        {e.end_at ? ` ~ ${e.end_at.slice(11, 16)}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="cal-event-body">
                    <div>
                      <Tag color={cat.color}>{cat.label}</Tag>
                      <strong>{e.title}</strong>
                    </div>
                    {e.description && (
                      <div className="cal-event-desc">{e.description}</div>
                    )}
                  </div>
                  <Space size={4}>
                    <EventEditor
                      date={selectedDate!}
                      event={e}
                      onSaved={() => loadEvents()}
                      trigger={<a><EditOutlined /></a>}
                    />
                    <Popconfirm
                      title="删除该事件？"
                      onConfirm={async () => {
                        await api.post('deleteCalendarEvent', { id: e.id })
                        message.success('已删除')
                        loadEvents()
                      }}
                    >
                      <a style={{ color: '#ff4d4f' }}><DeleteOutlined /></a>
                    </Popconfirm>
                  </Space>
                </div>
              )
            })}
          </div>
        )}

        {/* 日记区 */}
        <Typography.Title level={5} style={{ marginTop: 32 }}>
          工作日记
          {diarySaving ? (
            <Tag style={{ marginLeft: 8 }} color="processing">保存中</Tag>
          ) : diaryDirty ? (
            <Tag style={{ marginLeft: 8 }} color="orange">未保存</Tag>
          ) : (
            diaryContent && <Tag style={{ marginLeft: 8 }} color="success">已保存</Tag>
          )}
        </Typography.Title>
        <Input.TextArea
          rows={12}
          value={diaryContent}
          onChange={(e) => {
            setDiaryContent(e.target.value)
            setDiaryDirty(true)
          }}
          placeholder="记录今天的工作内容、思考、跟进事项... 1.5 秒不操作自动保存"
          maxLength={50000}
          showCount
          disabled={diaryLoading}
        />
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={diarySaving}
            disabled={!diaryDirty}
            onClick={saveDiary}
          >
            立即保存
          </Button>
        </div>
      </Drawer>

      <style>{`
        .cal-events { display: flex; flex-direction: column; gap: 8px; }
        .cal-event-row {
          display: flex;
          gap: 12px;
          padding: 10px 12px;
          background: #fafbfc;
          border-radius: 6px;
          border-left: 3px solid #1d57e0;
        }
        .cal-event-time {
          min-width: 110px;
          color: #595959;
          font-size: 13px;
        }
        .cal-event-body { flex: 1; min-width: 0; }
        .cal-event-desc {
          color: #8c8c8c;
          font-size: 12px;
          margin-top: 4px;
          white-space: pre-wrap;
        }
        .hol-tag {
          display: block;
          font-size: 11px;
          line-height: 16px;
          padding: 0 4px;
          border-radius: 3px;
          margin-bottom: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .hol-cn { background: #fff1f0; color: #cf1322; border: 1px solid #ffccc7; }
        .hol-id { background: #fff7e6; color: #ad4e00; border: 1px solid #ffd591; }
      `}</style>
    </PageContainer>
  )
}

function EventEditor({
  date,
  event,
  trigger,
  onSaved,
}: {
  date: Dayjs
  event?: CalendarEvent
  trigger: React.ReactElement
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const isEdit = !!event
  const [submitting, setSubmitting] = useState(false)

  const init = () => {
    if (event) {
      form.setFieldsValue({
        title: event.title,
        description: event.description,
        category: event.category || 'other',
        all_day: !!event.all_day,
        time_range: event.all_day
          ? [dayjs(event.start_at), event.end_at ? dayjs(event.end_at) : dayjs(event.start_at)]
          : [dayjs(event.start_at), event.end_at ? dayjs(event.end_at) : dayjs(event.start_at).add(1, 'hour')],
      })
    } else {
      form.setFieldsValue({
        title: '',
        description: '',
        category: 'other',
        all_day: false,
        time_range: [
          date.hour(9).minute(0).second(0),
          date.hour(10).minute(0).second(0),
        ],
      })
    }
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      const [s, e] = v.time_range || []
      const allDay = !!v.all_day
      const payload = {
        title: v.title,
        description: v.description || '',
        category: v.category || 'other',
        all_day: allDay ? 1 : 0,
        start_at: allDay
          ? date.format('YYYY-MM-DD 00:00:00')
          : (s as Dayjs).format('YYYY-MM-DD HH:mm:00'),
        end_at: allDay
          ? date.format('YYYY-MM-DD 23:59:59')
          : (e as Dayjs)?.format('YYYY-MM-DD HH:mm:00') || null,
      }
      if (isEdit) {
        await api.post('updateCalendarEvent', { id: event!.id, ...payload })
      } else {
        await api.post('createCalendarEvent', payload)
      }
      message.success(isEdit ? '已更新' : '已创建')
      setOpen(false)
      onSaved()
    } catch (e: any) {
      if (e?.errorFields) return
    } finally {
      setSubmitting(false)
    }
  }

  const triggerEl = (
    <span onClick={init} style={{ cursor: 'pointer' }}>
      {trigger}
    </span>
  )

  return (
    <>
      {triggerEl}
      <Modal
        title={isEdit ? '编辑事件' : `新建事件 · ${date.format('YYYY-MM-DD')}`}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        zIndex={9999}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入' }]}>
            <Input placeholder="例如：拜访张总，确认插座规格" />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Radio.Group>
              {Object.entries(CATEGORIES).map(([k, v]) => (
                <Radio.Button key={k} value={k}>
                  <Tag color={v.color} style={{ margin: 0 }}>{v.label}</Tag>
                </Radio.Button>
              ))}
            </Radio.Group>
          </Form.Item>
          <Form.Item name="all_day" label="全天" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(p, n) => p.all_day !== n.all_day}
          >
            {() =>
              form.getFieldValue('all_day') ? null : (
                <Form.Item name="time_range" label="时间" rules={[{ required: true }]}>
                  <DatePicker.RangePicker
                    showTime={{ format: 'HH:mm', minuteStep: 5 }}
                    format="YYYY-MM-DD HH:mm"
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item name="description" label="备注">
            <Input.TextArea rows={3} placeholder="详细内容、联系人、地点等" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
