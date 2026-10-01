import { useCallback, useEffect, useState } from 'react'
import { PageContainer } from '@ant-design/pro-components'
import {
  Alert, Button, Checkbox, DatePicker, Drawer, Empty, Form, Input, Modal,
  Radio, Select, Space, Table, Tag, Timeline, Tooltip, Typography, message,
} from 'antd'
import { PlusOutlined, FireOutlined, ClockCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../api'

/**
 * 进线客户跟进（20261001）
 *
 * 老板要的不是台账，是【没做完就一直顶在眼前】：
 * 当前步骤没点完成，这条线索就留在红色待办里，超过阈值标超时。
 * 所以这个页面第一屏不是列表，是待办。
 */

const SOURCES = [
  { value: 'shipinhao', label: '视频号' },
  { value: 'douyin', label: '抖音' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'other', label: '其他' },
]
const SOURCE_LABEL: Record<string, string> = Object.fromEntries(SOURCES.map((s) => [s.value, s.label]))

const LEVELS = [
  { value: 'precise', label: '精准客户', color: 'red' },
  { value: 'potential', label: '潜在客户', color: 'orange' },
  { value: 'normal', label: '普通咨询', color: 'default' },
]
const LEVEL_MAP: Record<string, { label: string; color: string }> =
  Object.fromEntries(LEVELS.map((l) => [l.value, { label: l.label, color: l.color }]))

const STATUSES = [
  { value: 'new', label: '新进客户' },
  { value: 'understanding', label: '了解需求中' },
  { value: 'wait_list', label: '待清单' },
  { value: 'wait_quote', label: '待报价' },
  { value: 'quoted', label: '已报价' },
  { value: 'wait_feedback', label: '待反馈' },
  { value: 'following', label: '跟进中' },
  { value: 'won', label: '已成交' },
  { value: 'paused', label: '暂停跟进' },
  { value: 'invalid', label: '无效客户' },
]
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]))

const STEP_NAMES = [
  '', '客户进线', '已了解客户需求', '已拿到需求清单/具体规格', '报价资料准备完成',
  '报价完成', '报价已发送客户', '客户已确认收到', '已获得客户反馈', '已完成下一次跟进',
]

function StatCard({ label, value, color, hint }: { label: string; value: any; color?: string; hint?: string }) {
  const body = (
    <div style={{
      background: '#fff', borderRadius: 8, padding: '12px 16px',
      boxShadow: '0 1px 4px rgba(0,21,64,.06)', minWidth: 110,
    }}>
      <div style={{ fontSize: 12, color: '#8c96ab' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || '#1d57e0', lineHeight: 1.3 }}>{value}</div>
    </div>
  )
  return hint ? <Tooltip title={hint}>{body}</Tooltip> : body
}

export default function LeadsPage() {
  const [rows, setRows] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<any>({})
  const [view, setView] = useState<'todo' | 'all'>('todo')
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [staff, setStaff] = useState<any[]>([])
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, s] = await Promise.all([
        api.get('listLeads', { ...filters, todo_only: view === 'todo' ? 1 : '' }),
        api.get('leadStats'),
      ])
      setRows(r.items || [])
      setStats(s)
    } catch {
      /* 拦截器已提示 */
    } finally {
      setLoading(false)
    }
  }, [filters, view])

  useEffect(() => { load() }, [load])
  useEffect(() => { api.get('listUsers').then((r) => setStaff(r.items || [])).catch(() => {}) }, [])

  const openEdit = (row: any) => {
    setEditing(row)
    form.setFieldsValue(row
      ? { ...row, lead_date: row.lead_date ? dayjs(row.lead_date) : dayjs(),
          next_follow_at: row.next_follow_at ? dayjs(row.next_follow_at) : null }
      : { lead_date: dayjs(), level: 'normal', status: 'new', source: 'douyin' })
    setEditOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    await api.post('saveLead', {
      ...v,
      id: editing?.id,
      lead_date: v.lead_date ? v.lead_date.format('YYYY-MM-DD') : '',
      next_follow_at: v.next_follow_at ? v.next_follow_at.format('YYYY-MM-DD') : '',
    })
    message.success('已保存')
    setEditOpen(false)
    load()
  }

  const columns = [
    { title: '进线日', dataIndex: 'lead_date', width: 100 },
    {
      title: '客户',
      width: 170,
      render: (_: any, r: any) => (
        <div>
          <a onClick={() => setDetailId(r.id)} style={{ fontWeight: 600 }}>{r.name}</a>
          {r.contact && <div style={{ color: '#8c8c8c', fontSize: 12 }}>{r.contact}</div>}
        </div>
      ),
    },
    {
      title: '来源', dataIndex: 'source', width: 90,
      render: (v: string) => SOURCE_LABEL[v] || v || '—',
    },
    {
      title: '等级', dataIndex: 'level', width: 90,
      render: (v: string) => <Tag color={LEVEL_MAP[v]?.color}>{LEVEL_MAP[v]?.label || v}</Tag>,
    },
    { title: '需求', dataIndex: 'demand', ellipsis: true },
    { title: '负责人', dataIndex: 'owner_name', width: 90, render: (v: string) => v || '—' },
    {
      title: '进度', width: 120,
      render: (_: any, r: any) => (
        <div>
          <div style={{ fontSize: 12 }}>{r.done_count}/9 · {r.progress}%</div>
          <div style={{ height: 5, background: '#f0f0f0', borderRadius: 3, marginTop: 3 }}>
            <div style={{
              width: `${r.progress}%`, height: 5, borderRadius: 3,
              background: r.finished ? '#52c41a' : '#1d57e0',
            }} />
          </div>
        </div>
      ),
    },
    {
      title: '🔴 待办', width: 210,
      render: (_: any, r: any) =>
        r.finished ? (
          <Tag color="success">九步已走完</Tag>
        ) : (
          <Space size={4} wrap>
            <Tag color="error" style={{ marginInlineEnd: 0 }}>🔴 {r.todo}</Tag>
            {r.overdue ? (
              <Tag color="volcano" style={{ marginInlineEnd: 0 }}>
                <ClockCircleOutlined /> 卡 {r.stalled_days} 天
              </Tag>
            ) : null}
          </Space>
        ),
    },
    { title: '下次跟进', dataIndex: 'next_follow_at', width: 100, render: (v: string) => v || <span style={{ color: '#bfbfbf' }}>未定</span> },
    {
      title: '', width: 90,
      render: (_: any, r: any) => (
        <Space size={8}>
          <a onClick={() => openEdit(r)}>编辑</a>
          <a style={{ color: '#ff4d4f' }} onClick={() => {
            Modal.confirm({
              title: `删除线索「${r.name}」？`,
              content: '跟进记录会一起删掉，删了找不回来。',
              okText: '删除', okButtonProps: { danger: true },
              onOk: async () => { await api.post('deleteLead', { id: r.id }); message.success('已删除'); load() },
            })
          }}>删除</a>
        </Space>
      ),
    },
  ]

  return (
    <PageContainer title="进线客户跟进">
      {stats && (
        <>
          {stats.overdue > 0 && (
            <Alert
              type="error"
              showIcon
              icon={<FireOutlined />}
              style={{ marginBottom: 12 }}
              message={`有 ${stats.overdue} 个客户卡了超过 ${stats.overdue_days} 天没推进`}
              description="排在最前面的就是。处理完点一下对应步骤的「完成」，红色提醒会自动消失。"
            />
          )}
          <Space wrap size={10} style={{ marginBottom: 12 }}>
            <StatCard label="今日进线" value={stats.today_in} />
            <StatCard label="本月进线" value={stats.month_in} />
            <StatCard label="精准客户" value={stats.precise} color="#eb2f96" />
            <StatCard label="待报价" value={stats.wait_quote} color="#fa8c16" hint="还没走到「报价完成」的" />
            <StatCard label="待发送" value={stats.wait_send} color="#fa8c16" hint="报价做好了还没发给客户" />
            <StatCard label="待反馈" value={stats.wait_feedback} color="#722ed1" hint="已发客户、还没记到反馈" />
            <StatCard label="已成交" value={stats.won} color="#52c41a" />
            <StatCard label="超时未处理" value={stats.overdue} color="#f5222d" hint={`卡住超过 ${stats.overdue_days} 天`} />
          </Space>
        </>
      )}

      <div style={{ background: '#fff', borderRadius: 8, padding: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Radio.Group value={view} onChange={(e) => setView(e.target.value)} optionType="button" buttonStyle="solid">
            <Radio.Button value="todo">🔴 待办 ({stats?.todo_total ?? 0})</Radio.Button>
            <Radio.Button value="all">全部客户</Radio.Button>
          </Radio.Group>
          <Input.Search placeholder="搜客户名 / 电话 / 需求" allowClear style={{ width: 220 }}
            onSearch={(v) => setFilters((f: any) => ({ ...f, keyword: v }))} />
          <Select allowClear placeholder="来源" style={{ width: 120 }} options={SOURCES}
            onChange={(v) => setFilters((f: any) => ({ ...f, source: v }))} />
          <Select allowClear placeholder="等级" style={{ width: 120 }}
            options={LEVELS.map((l) => ({ value: l.value, label: l.label }))}
            onChange={(v) => setFilters((f: any) => ({ ...f, level: v }))} />
          <Select allowClear placeholder="状态" style={{ width: 130 }} options={STATUSES}
            onChange={(v) => setFilters((f: any) => ({ ...f, status: v }))} />
          <Select allowClear placeholder="负责人" style={{ width: 130 }}
            options={staff.map((u: any) => ({ value: u.id, label: u.name || u.username }))}
            onChange={(v) => setFilters((f: any) => ({ ...f, owner_id: v }))} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit(null)}>新增进线客户</Button>
        </Space>

        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns as any}
          pagination={rows.length > 30 ? { pageSize: 30, size: 'small' } : false}
          scroll={{ x: 'max-content' }}
          rowClassName={(r: any) => (r.overdue ? 'lead-overdue' : '')}
          locale={{
            emptyText: view === 'todo'
              ? <Empty description="没有待办了 —— 今天不欠账" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              : <Empty description="还没有进线客户，点右上角新增" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
          }}
        />
        <style>{`.lead-overdue > td { background: #fff1f0 !important; }`}</style>
      </div>

      <Modal
        open={editOpen}
        title={editing ? `编辑线索 · ${editing.name}` : '新增进线客户'}
        onCancel={() => setEditOpen(false)}
        onOk={submit}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="lead_date" label="进线日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="name" label="客户名称" rules={[{ required: true, message: '请填写客户名称' }]} style={{ flex: 1 }}>
              <Input placeholder="称呼或公司名" />
            </Form.Item>
            <Form.Item name="contact" label="联系方式" style={{ flex: 1 }}>
              <Input placeholder="电话 / WA / 微信" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="source" label="客户来源" style={{ flex: 1 }}>
              <Select options={SOURCES} />
            </Form.Item>
            <Form.Item name="level" label="客户等级" style={{ flex: 1 }}>
              <Select options={LEVELS.map((l) => ({ value: l.value, label: l.label }))} />
            </Form.Item>
            <Form.Item name="owner_id" label="负责人" style={{ flex: 1 }}>
              <Select allowClear options={staff.map((u: any) => ({ value: u.id, label: u.name || u.username }))} />
            </Form.Item>
          </Space>
          <Form.Item name="demand" label="客户需求">
            <Input placeholder="一句话说清他要什么，如：600×600 瓷砖，工地用" />
          </Form.Item>
          <Form.Item name="demand_list" label="需求清单 / 具体规格">
            <Input.TextArea rows={3} placeholder="客户给的清单原文贴这里，拿到后再填" />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="status" label="当前状态" style={{ flex: 1 }}>
              <Select options={STATUSES} />
            </Form.Item>
            <Form.Item name="next_follow_at" label="下次跟进" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <LeadDetail id={detailId} onClose={() => setDetailId(null)} onChanged={load} />
    </PageContainer>
  )
}

/** 详情抽屉：九步勾选 + 跟进记录（只增不改） */
function LeadDetail({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<any>(null)
  const [follows, setFollows] = useState<any[]>([])
  const [text, setText] = useState('')
  const [nextAt, setNextAt] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const r = await api.get('getLead', { id })
    setData(r.data)
    setFollows(r.follows || [])
  }, [id])

  useEffect(() => { if (id) { setText(''); setNextAt(null); load() } else setData(null) }, [id, load])

  const toggleStep = async (n: number, checked: boolean) => {
    setBusy(true)
    try {
      await api.post(checked ? 'completeLeadStep' : 'undoLeadStep', { id, step_no: n })
      await load()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const addFollow = async () => {
    if (!text.trim()) { message.warning('请填写跟进内容'); return }
    await api.post('addLeadFollow', {
      lead_id: id, content: text.trim(),
      next_follow_at: nextAt ? nextAt.format('YYYY-MM-DD') : '',
    })
    setText(''); setNextAt(null)
    await load(); onChanged()
    message.success('已记录')
  }

  const doneSet = new Set<number>(data?.done_steps || [])

  return (
    <Drawer open={!!id} onClose={onClose} width={620} title={data ? `${data.name} · ${data.done_count}/9` : '加载中'}>
      {!data ? null : (
        <>
          {!data.finished && (
            <Alert
              type={data.overdue ? 'error' : 'warning'}
              showIcon
              style={{ marginBottom: 14 }}
              message={`🔴 ${data.todo}`}
              description={data.overdue
                ? `已经卡了 ${data.stalled_days} 天 —— 今天必须推一下`
                : '处理完就在下面勾上，待办会自动落到下一步'}
            />
          )}

          <Typography.Title level={5}>跟进流程</Typography.Title>
          <div style={{ marginBottom: 20 }}>
            {STEP_NAMES.slice(1).map((label, i) => {
              const n = i + 1
              const done = doneSet.has(n)
              const isNext = data.next_step === n
              return (
                <div key={n} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  borderRadius: 6, marginBottom: 4,
                  background: isNext ? '#fff1f0' : done ? '#f6ffed' : 'transparent',
                }}>
                  <Checkbox checked={done} disabled={busy} onChange={(e) => toggleStep(n, e.target.checked)} />
                  <span style={{ color: done ? '#8c8c8c' : undefined, textDecoration: done ? 'line-through' : undefined }}>
                    {n}. {label}
                  </span>
                  {done && data.done_at?.[n] && (
                    <span style={{ marginLeft: 'auto', color: '#8c8c8c', fontSize: 12 }}>
                      {String(data.done_at[n]).slice(5, 16)}
                    </span>
                  )}
                  {isNext && <Tag color="error" style={{ marginLeft: 'auto', marginInlineEnd: 0 }}>当前卡在这</Tag>}
                </div>
              )
            })}
          </div>

          <Typography.Title level={5}>跟进记录</Typography.Title>
          <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 8 }}>
            只新增不覆盖。写客户原话比写结论有用——「比别家贵 15%」能拿回来谈，「嫌贵」不能。
          </div>
          <Input.TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="今天和客户聊了什么？客户怎么说的？" />
          <Space style={{ marginTop: 8, marginBottom: 16 }}>
            <DatePicker placeholder="下次跟进" value={nextAt} onChange={setNextAt} />
            <Button type="primary" onClick={addFollow}>记一条</Button>
          </Space>

          {follows.length === 0 ? (
            <Empty description="还没有跟进记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Timeline
              items={follows.map((f) => ({
                children: (
                  <div>
                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                      {String(f.created_at).slice(0, 16)} · {f.created_by_name || '—'}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{f.content}</div>
                  </div>
                ),
              }))}
            />
          )}
        </>
      )}
    </Drawer>
  )
}
