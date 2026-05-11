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
  AudioFilled,
  AudioOutlined,
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
  const [recording, setRecording] = useState(false)
  const [interim, setInterim] = useState('')
  const recognitionRef = useRef<any>(null)
  const baseTextRef = useRef('')

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
    const cnHols = holidays.filter((h) => h.country === 'CN')
    const idHols = holidays.filter((h) => h.country === 'ID')

    // 节日类型作为隐藏标记，CSS 用 :has() 选择父单元格上色
    const dayClass =
      cnHols.length > 0 && idHols.length > 0
        ? 'is-both-holiday'
        : idHols.length > 0
        ? 'is-id-holiday'
        : cnHols.length > 0
        ? 'is-cn-holiday'
        : ''

    return (
      <div className={`cal-cell ${dayClass}`}>
        {list.length > 0 && (
          <ul className="cal-event-pills">
            {list.slice(0, 3).map((e) => {
              return (
                <li key={e.id} className={`cal-pill cal-pill-${e.category || 'other'}`} title={e.title}>
                  {!e.all_day && (
                    <span className="cal-pill-time">{e.start_at.slice(11, 16)}</span>
                  )}
                  <span className="cal-pill-title">{e.title}</span>
                </li>
              )
            })}
            {list.length > 3 && (
              <li className="cal-pill-more">+ {list.length - 3} 更多</li>
            )}
          </ul>
        )}
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

  const stopRecording = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }
    setRecording(false)
    setInterim('')
  }

  const startRecording = () => {
    const SR: any =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      message.error('当前浏览器不支持语音识别。建议用 Chrome / Edge，并在 HTTPS 域名下使用。')
      return
    }
    if (!window.isSecureContext) {
      message.warning('语音识别需要 HTTPS。当前是 HTTP，可能无法启用麦克风。')
    }
    const r = new SR()
    r.lang = 'zh-CN'
    r.continuous = true
    r.interimResults = true

    baseTextRef.current = diaryContent
    let finalAcc = ''

    r.onresult = (e: any) => {
      let interimStr = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript
        if (e.results[i].isFinal) {
          finalAcc += text
        } else {
          interimStr += text
        }
      }
      // 直接把 final 部分拼到内容里，interim 单独展示
      if (finalAcc) {
        const sep = baseTextRef.current && !baseTextRef.current.endsWith('\n') ? '' : ''
        setDiaryContent(baseTextRef.current + sep + finalAcc)
        setDiaryDirty(true)
      }
      setInterim(interimStr)
    }
    r.onerror = (e: any) => {
      const err = e?.error || 'unknown'
      const msgMap: Record<string, string> = {
        'not-allowed': '麦克风权限被拒绝，请在浏览器地址栏点击锁形图标授权',
        'no-speech': '没听到说话，请再试一次',
        'audio-capture': '没有可用的麦克风',
        'network': '网络异常（部分浏览器语音识别需要联网）',
        'language-not-supported': '语言不支持',
        'service-not-allowed': '语音服务被禁用',
      }
      message.error(msgMap[err] || `语音识别出错: ${err}`)
      stopRecording()
    }
    r.onend = () => {
      // 录音结束时把最后一段 interim 也合入
      if (interim) {
        setDiaryContent((c) => c + interim)
        setInterim('')
      }
      setRecording(false)
    }

    recognitionRef.current = r
    try {
      r.start()
      setRecording(true)
    } catch (e: any) {
      message.error('启动失败：' + (e?.message || ''))
    }
  }

  // 卸载时停止
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch {}
      }
    }
  }, [])

  // 切换日期时停止录音
  useEffect(() => {
    if (!drawerOpen) stopRecording()
  }, [drawerOpen])

  const dayEvents = selectedDate
    ? (eventsByDay[selectedDate.format('YYYY-MM-DD')] || []).slice().sort((a, b) =>
        a.start_at.localeCompare(b.start_at),
      )
    : []

  return (
    <PageContainer
      title={
        <span style={{ fontSize: 18, fontWeight: 600 }}>
          日历 · 行程 · 工作日记
        </span>
      }
      extra={
        <Space>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginRight: 12, fontSize: 12 }}>
            <span className="legend-dot legend-cn" /> 中国节
            <span className="legend-dot legend-id" /> 印尼节
            <span className="legend-dot legend-event" /> 我的事件
          </span>
          <Button type="primary" ghost onClick={() => setCurrentMonth(dayjs())}>
            回到今天
          </Button>
        </Space>
      }
    >
      <ProCard bordered className="cal-card">
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
                <Tag key={i} color={h.country === 'CN' ? 'gold' : 'red'}>
                  {h.country === 'CN' ? '🇨🇳' : '🇮🇩'} {h.name}
                  {h.country === 'ID' && h.name_cn ? `（${h.name_cn}）` : ''}
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
        {/* 节日横幅 */}
        {selectedDate && getHolidays(selectedDate.format('YYYY-MM-DD')).length > 0 && (
          <div style={{ marginTop: -8, marginBottom: 16 }}>
            {getHolidays(selectedDate.format('YYYY-MM-DD')).map((h, i) => (
              <div
                key={i}
                className={h.country === 'CN' ? 'hol-banner hol-banner-cn' : 'hol-banner hol-banner-id'}
              >
                <span className="hol-banner-flag">{h.country === 'CN' ? '🇨🇳 中国' : '🇮🇩 印尼'}</span>
                <span className="hol-banner-name">
                  {h.name}
                  {h.country === 'ID' && h.name_cn && (
                    <span className="hol-banner-cn-name"> · {h.name_cn}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

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
        <div style={{ position: 'relative' }}>
          <Input.TextArea
            rows={12}
            value={diaryContent + (interim ? ` ${interim}` : '')}
            onChange={(e) => {
              setDiaryContent(e.target.value)
              setDiaryDirty(true)
            }}
            placeholder="点下方麦克风开始说话，AI 自动转写；也可以直接打字。1.5 秒不操作自动保存。"
            maxLength={50000}
            showCount
            disabled={diaryLoading || recording}
          />
          {recording && (
            <div className="rec-indicator">
              <span className="rec-dot" />
              正在录音…
              {interim && <span className="rec-interim"> {interim}</span>}
            </div>
          )}
        </div>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Button
            type={recording ? 'primary' : 'default'}
            danger={recording}
            icon={recording ? <AudioFilled /> : <AudioOutlined />}
            size="large"
            onClick={recording ? stopRecording : startRecording}
            style={{ minWidth: 160 }}
          >
            {recording ? '停止录音' : '语音输入'}
          </Button>
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
        :root { --brand: #1d57e0; --brand-light: #e6f0ff; --brand-soft: #f0f5ff; }

        /* ========= 日历整体 ========= */
        .cal-card .ant-pro-card-body { padding: 0 !important; }
        .cal-card .ant-picker-calendar { padding: 16px 20px 24px; background: #fff; border-radius: 8px; }
        .cal-card .ant-picker-calendar-header { margin-bottom: 12px; padding: 0; }
        .cal-card .ant-picker-calendar-mode-switch { display: none; }
        .cal-card .ant-picker-calendar-header .ant-select { min-width: 100px; }

        /* 星期表头 */
        .cal-card .ant-picker-content thead th {
          padding: 10px 8px;
          font-weight: 600;
          color: #595959;
          background: var(--brand-soft);
          border-bottom: 2px solid var(--brand-light);
          font-size: 13px;
        }

        /* 单元格容器 */
        .cal-card .ant-picker-cell { padding: 4px !important; }
        .cal-card .ant-picker-calendar-date {
          border: 1px solid #f0f0f0 !important;
          border-radius: 6px;
          margin: 0 !important;
          padding: 6px 8px !important;
          min-height: 110px;
          transition: all 0.15s;
        }
        .cal-card .ant-picker-cell:hover .ant-picker-calendar-date {
          border-color: var(--brand) !important;
          box-shadow: 0 2px 8px rgba(29, 87, 224, 0.12);
          cursor: pointer;
        }
        /* 非本月日期淡化 */
        .cal-card .ant-picker-cell:not(.ant-picker-cell-in-view) .ant-picker-calendar-date {
          background: #fafafa;
          opacity: 0.55;
        }
        /* 今天 */
        .cal-card .ant-picker-cell-today .ant-picker-calendar-date {
          border-color: var(--brand) !important;
          background: linear-gradient(135deg, var(--brand-soft) 0%, #fff 60%);
        }
        .cal-card .ant-picker-cell-today .ant-picker-calendar-date-value {
          color: var(--brand) !important;
          font-weight: 700;
        }
        /* 选中 */
        .cal-card .ant-picker-cell-selected .ant-picker-calendar-date {
          background: var(--brand-light) !important;
          border-color: var(--brand) !important;
        }
        .cal-card .ant-picker-calendar-date-value {
          font-size: 14px !important;
          font-weight: 500;
          color: #1f1f1f;
          line-height: 22px !important;
          text-align: right;
        }
        /* 周末日期颜色 */
        .cal-card .ant-picker-cell:nth-child(1) .ant-picker-calendar-date-value,
        .cal-card .ant-picker-cell:nth-child(7) .ant-picker-calendar-date-value {
          color: #cf1322;
        }
        .cal-card .ant-picker-calendar-date-content {
          height: auto !important;
          min-height: 70px;
          overflow: hidden !important;
        }

        /* ========= 单元格内 ========= */
        .cal-cell { font-size: 12px; line-height: 1.4; margin-top: 4px; }

        /* 节日整格填充（CSS :has 选择含节日 marker 的父单元格） */
        /* 中国节 = 淡米黄 */
        .cal-card .ant-picker-cell-in-view .ant-picker-calendar-date:has(.is-cn-holiday) {
          background: #fffbe6 !important;
          border-color: #ffe58f !important;
        }
        .cal-card .ant-picker-cell-in-view .ant-picker-calendar-date:has(.is-cn-holiday) .ant-picker-calendar-date-value {
          color: #ad6800 !important;
          font-weight: 600;
        }
        /* 印尼节 = 淡红 */
        .cal-card .ant-picker-cell-in-view .ant-picker-calendar-date:has(.is-id-holiday) {
          background: #fff5f5 !important;
          border-color: #ffa39e !important;
        }
        .cal-card .ant-picker-cell-in-view .ant-picker-calendar-date:has(.is-id-holiday) .ant-picker-calendar-date-value {
          color: #cf1322 !important;
          font-weight: 600;
        }
        /* 同一天既是中国节又是印尼节：红上 / 黄下，对半分 */
        .cal-card .ant-picker-cell-in-view .ant-picker-calendar-date:has(.is-both-holiday) {
          background: linear-gradient(to bottom, #fff5f5 0%, #fff5f5 50%, #fffbe6 50%, #fffbe6 100%) !important;
          border-color: #ffa39e !important;
        }
        .cal-card .ant-picker-cell-in-view .ant-picker-calendar-date:has(.is-both-holiday) .ant-picker-calendar-date-value {
          color: #cf1322 !important;
          font-weight: 600;
        }
        /* hover 时再加重一点 */
        .cal-card .ant-picker-cell:hover .ant-picker-calendar-date:has(.is-cn-holiday) {
          box-shadow: 0 2px 8px rgba(173, 104, 0, 0.15) !important;
          border-color: #ffc53d !important;
        }
        .cal-card .ant-picker-cell:hover .ant-picker-calendar-date:has(.is-id-holiday) {
          box-shadow: 0 2px 8px rgba(207, 19, 34, 0.15) !important;
          border-color: #ff7875 !important;
        }
        .cal-card .ant-picker-cell:hover .ant-picker-calendar-date:has(.is-both-holiday) {
          box-shadow: 0 2px 8px rgba(207, 19, 34, 0.15) !important;
          border-color: #ff7875 !important;
        }
        /* 今天若也是节日，蓝色今天高亮让位给节日色 */
        .cal-card .ant-picker-cell-today .ant-picker-calendar-date:has(.is-cn-holiday),
        .cal-card .ant-picker-cell-today .ant-picker-calendar-date:has(.is-id-holiday),
        .cal-card .ant-picker-cell-today .ant-picker-calendar-date:has(.is-both-holiday) {
          outline: 2px solid #1d57e0;
          outline-offset: -2px;
        }

        /* 事件 pill */
        .cal-event-pills { list-style: none; margin: 4px 0 0; padding: 0; }
        .cal-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          line-height: 16px;
          padding: 1px 6px;
          border-radius: 3px;
          margin-bottom: 2px;
          overflow: hidden;
          white-space: nowrap;
          border-left: 2px solid var(--brand);
          background: var(--brand-light);
          color: #1f1f1f;
        }
        .cal-pill-time { color: #1d57e0; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 10px; }
        .cal-pill-title { overflow: hidden; text-overflow: ellipsis; }
        .cal-pill-visit  { border-left-color: #1d57e0; background: #e6f0ff; }
        .cal-pill-follow { border-left-color: #fa8c16; background: #fff7e6; }
        .cal-pill-meeting{ border-left-color: #722ed1; background: #f9f0ff; }
        .cal-pill-other  { border-left-color: #8c8c8c; background: #f5f5f5; }
        .cal-pill-more { font-size: 10px; color: var(--brand); padding: 0 4px; }

        /* 图例 */
        .legend-dot {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          margin-right: 4px;
          vertical-align: middle;
        }
        .legend-cn { background: #ffd666; }
        .legend-id { background: #ff4d4f; }
        .legend-event { background: var(--brand); }

        /* ========= Drawer 内 ========= */
        .hol-banner {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 18px;
          border-radius: 10px;
          font-size: 15px;
          margin-bottom: 8px;
          font-weight: 600;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
        }
        .hol-banner-flag { font-size: 13px; opacity: 0.85; }
        .hol-banner-name { font-size: 17px; letter-spacing: 1px; }
        .hol-banner-cn {
          background: #fffbe6;
          color: #874d00;
          border: 1px solid #ffe58f;
        }
        .hol-banner-id {
          background: #fff5f5;
          color: #a8071a;
          border: 1px solid #ffa39e;
        }
        .hol-banner-cn-name { opacity: 0.85; font-weight: 500; font-size: 14px; }

        /* 录音指示 */
        .rec-indicator {
          position: absolute;
          top: 10px; right: 12px;
          background: rgba(255, 77, 79, 0.08);
          color: #cf1322;
          padding: 4px 12px;
          border-radius: 14px;
          font-size: 12px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 6px;
          max-width: 60%;
          pointer-events: none;
        }
        .rec-dot {
          display: inline-block;
          width: 8px; height: 8px;
          border-radius: 50%;
          background: #ff4d4f;
          animation: rec-pulse 1.2s ease-in-out infinite;
        }
        .rec-interim {
          color: #595959;
          font-weight: 400;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @keyframes rec-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }

        .cal-events { display: flex; flex-direction: column; gap: 10px; }
        .cal-event-row {
          display: flex;
          gap: 12px;
          padding: 12px 14px;
          background: #fff;
          border-radius: 8px;
          border: 1px solid #f0f0f0;
          border-left: 4px solid var(--brand);
          transition: box-shadow 0.15s;
        }
        .cal-event-row:hover { box-shadow: 0 4px 12px rgba(29, 87, 224, 0.08); }
        .cal-event-time {
          min-width: 110px;
          color: var(--brand);
          font-size: 13px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .cal-event-body { flex: 1; min-width: 0; }
        .cal-event-desc {
          color: #8c8c8c;
          font-size: 12px;
          margin-top: 4px;
          white-space: pre-wrap;
        }
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
