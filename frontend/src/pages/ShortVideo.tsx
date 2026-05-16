import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import {
  ActionType,
  PageContainer,
  ProCard,
} from '@ant-design/pro-components'
import {
  CalendarOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  UploadOutlined,
  VideoCameraAddOutlined,
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { api } from '../api'

const PLATFORMS = [
  { value: 'xiaohongshu', label: '小红书', color: '#ff2442', emoji: '📕' },
  { value: 'douyin', label: '抖音', color: '#000', emoji: '🎵' },
  { value: 'videohao', label: '视频号', color: '#07c160', emoji: '💬' },
  { value: 'tiktok', label: 'TikTok', color: '#25f4ee', emoji: '🌐' },
  { value: 'instagram', label: 'Instagram', color: '#e1306c', emoji: '📷' },
]
const PLAT_MAP: Record<string, { label: string; color: string; emoji: string }> =
  Object.fromEntries(PLATFORMS.map((p) => [p.value, p]))

const TASK_STATUS: Record<string, { color: string; text: string }> = {
  scheduled: { color: 'blue', text: '待发布' },
  reminded: { color: 'orange', text: '已提醒' },
  done: { color: 'success', text: '已发布' },
  failed: { color: 'error', text: '失败' },
  cancelled: { color: 'default', text: '已取消' },
}

function copyText(t: string) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(t)
  }
  return new Promise<void>((resolve, reject) => {
    const ta = document.createElement('textarea')
    ta.value = t
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy') ? resolve() : reject(new Error('copy failed'))
    } catch (e) {
      reject(e)
    } finally {
      document.body.removeChild(ta)
    }
  })
}

export default function ShortVideoPage() {
  const [dashboard, setDashboard] = useState<any>(null)
  useEffect(() => {
    api.get('svDashboard').then(setDashboard)
  }, [])

  return (
    <PageContainer title="短视频矩阵">
      {dashboard && (
        <div style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <ProCard size="small" bordered>
            <Statistic title="今日总任务" value={dashboard.tasks.today_total} />
          </ProCard>
          <ProCard size="small" bordered>
            <Statistic title="今日已发布" value={dashboard.tasks.today_done} valueStyle={{ color: '#52c41a' }} />
          </ProCard>
          <ProCard size="small" bordered>
            <Statistic title="今日待发" value={dashboard.tasks.today_pending} valueStyle={{ color: '#1d57e0' }} />
          </ProCard>
          <ProCard size="small" bordered>
            <Statistic title="24h 内待发" value={dashboard.tasks.upcoming_24h} />
          </ProCard>
          <ProCard size="small" bordered>
            <Statistic
              title="逾期未发"
              value={dashboard.tasks.overdue}
              valueStyle={{ color: dashboard.tasks.overdue > 0 ? '#ff4d4f' : '#bfbfbf' }}
            />
          </ProCard>
        </div>
      )}

      <Tabs
        items={[
          { key: 'tasks', label: '📅 排期 / 任务', children: <TasksTab /> },
          { key: 'assets', label: '🎬 素材库', children: <AssetsTab /> },
          { key: 'accounts', label: '👤 账号矩阵', children: <AccountsTab /> },
        ]}
      />
      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        message="当前为「半自动调度」模式：到点提醒、一键复制文案与封面、记录已发。等你选定矩阵分发 SaaS（易媒/矩阵狗等），我把 publish 接口换成自动调用即可。"
      />
    </PageContainer>
  )
}

// ====================================== 任务 / 排期 ======================================
function TasksTab() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf('day'), dayjs().add(7, 'day').endOf('day')])
  const [creatingFor, setCreatingFor] = useState<any | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('listSvTasks', {
        start: range[0].format('YYYY-MM-DD HH:mm:ss'),
        end: range[1].format('YYYY-MM-DD HH:mm:ss'),
      })
      setItems(r.items || [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [range[0], range[1]])

  const byDate = items.reduce((acc: Record<string, any[]>, t) => {
    const key = (t.scheduled_at || '').slice(0, 10)
    if (!acc[key]) acc[key] = []
    acc[key].push(t)
    return acc
  }, {})

  const markDone = async (id: number) => {
    await api.post('updateSvTask', { id, status: 'done' })
    load()
  }
  const del = async (id: number) => {
    await api.post('deleteSvTask', { id })
    load()
  }
  const copyAll = async (t: any) => {
    const text = [t.title, '', t.description, '', t.tags].filter(Boolean).join('\n')
    await copyText(text)
    message.success('文案已复制到剪贴板')
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => v && setRange([v[0]!, v[1]!])}
          showTime={{ format: 'HH:mm' }}
          format="YYYY-MM-DD HH:mm"
        />
        <Button onClick={() => setRange([dayjs().startOf('day'), dayjs().add(7, 'day').endOf('day')])}>本周</Button>
        <Button onClick={() => setRange([dayjs().startOf('day'), dayjs().add(30, 'day').endOf('day')])}>30 天</Button>
        <Button onClick={() => setRange([dayjs().startOf('day'), dayjs().endOf('day')])}>今天</Button>
        <NewTaskButton onCreated={load} />
      </Space>

      {loading ? (
        '加载中...'
      ) : items.length === 0 ? (
        <Empty description="时段内没有排期任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        Object.entries(byDate)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, list]) => (
            <Card
              key={date}
              size="small"
              style={{ marginBottom: 12 }}
              title={
                <Space>
                  <CalendarOutlined />
                  <strong>{date}</strong>
                  <Tag>{dayjs(date).format('dddd')}</Tag>
                  <span style={{ color: '#8c8c8c', fontSize: 12 }}>{list.length} 个任务</span>
                </Space>
              }
            >
              <Table
                size="small"
                rowKey="id"
                dataSource={list}
                pagination={false}
                columns={[
                  {
                    title: '时间',
                    dataIndex: 'scheduled_at',
                    width: 80,
                    render: (v) => <strong>{(v || '').slice(11, 16)}</strong>,
                  },
                  {
                    title: '平台',
                    dataIndex: 'platform',
                    width: 110,
                    render: (p, r: any) => {
                      const pp = PLAT_MAP[p]
                      return (
                        <Tag color={pp?.color} style={{ color: '#fff' }}>
                          {pp?.emoji} {pp?.label}
                        </Tag>
                      )
                    },
                  },
                  {
                    title: '账号',
                    dataIndex: 'account_name',
                    width: 160,
                    render: (n, r: any) => (
                      <div>
                        <div>{n}</div>
                        {r.owner_phone && <div style={{ fontSize: 11, color: '#8c8c8c' }}>📱 {r.owner_phone}</div>}
                      </div>
                    ),
                  },
                  {
                    title: '素材 / 文案',
                    render: (_, r: any) => (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        {r.asset_cover && (
                          <Image
                            src={r.asset_cover}
                            width={48}
                            height={48}
                            style={{ borderRadius: 4, objectFit: 'cover' }}
                            placeholder
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.title || r.asset_title}
                          </div>
                          <div style={{ fontSize: 11, color: '#8c8c8c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.description}
                          </div>
                          {r.tags && (
                            <div style={{ fontSize: 11, color: '#1d57e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.tags}
                            </div>
                          )}
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 90,
                    render: (s) => <Tag color={TASK_STATUS[s]?.color}>{TASK_STATUS[s]?.text || s}</Tag>,
                  },
                  {
                    title: '操作',
                    width: 240,
                    render: (_, r: any) => (
                      <Space size={4}>
                        <Tooltip title="复制文案">
                          <Button size="small" icon={<CopyOutlined />} onClick={() => copyAll(r)}>复制</Button>
                        </Tooltip>
                        {r.asset_video && (
                          <Tooltip title="下载视频">
                            <Button size="small" href={r.asset_video} target="_blank">视频</Button>
                          </Tooltip>
                        )}
                        {r.status !== 'done' && (
                          <Tooltip title="标记已发布">
                            <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => markDone(r.id)}>
                              发完了
                            </Button>
                          </Tooltip>
                        )}
                        <Popconfirm title="删除任务？" onConfirm={() => del(r.id)}>
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          ))
      )}
    </div>
  )
}

function NewTaskButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [assets, setAssets] = useState<any[]>([])
  const [accounts, setAccounts] = useState<any[]>([])
  const [assetId, setAssetId] = useState<number | undefined>()
  const [accountIds, setAccountIds] = useState<number[]>([])
  const [when, setWhen] = useState<Dayjs | null>(dayjs().add(1, 'hour').minute(0))
  const [submitting, setSubmitting] = useState(false)

  const init = async () => {
    const [a, c] = await Promise.all([
      api.get('listSvAssets', { page_size: 200 }),
      api.get('listSvAccounts'),
    ])
    setAssets(a.items || [])
    setAccounts(c.items || [])
    setOpen(true)
  }

  const submit = async () => {
    if (!assetId || accountIds.length === 0 || !when) {
      message.warning('请选素材 + 账号 + 时间')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.post('createSvTasks', {
        asset_id: assetId,
        account_ids: accountIds,
        scheduled_at: when.format('YYYY-MM-DD HH:mm:00'),
      })
      message.success(`已创建 ${res.created} 个任务`)
      setOpen(false)
      setAssetId(undefined)
      setAccountIds([])
      onCreated()
    } finally {
      setSubmitting(false)
    }
  }

  // 按平台分组账号
  const accountsByPlat: Record<string, any[]> = {}
  for (const acc of accounts) {
    if (!accountsByPlat[acc.platform]) accountsByPlat[acc.platform] = []
    accountsByPlat[acc.platform].push(acc)
  }

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={init}>
        新建排期
      </Button>
      <Modal
        title="新建排期任务"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        okText="创建任务"
        cancelText="取消"
        width={760}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <strong>① 选素材</strong>
            <Select
              showSearch
              value={assetId}
              onChange={setAssetId}
              optionFilterProp="label"
              placeholder="选一个已上传的视频素材"
              style={{ width: '100%', marginTop: 8 }}
              options={assets.map((a) => ({
                value: a.id,
                label: `${a.title} · ${a.created_at?.slice(5, 10)}`,
              }))}
            />
          </div>
          <div>
            <strong>② 选目标账号</strong>{' '}
            <Button size="small" type="link" onClick={() => setAccountIds(accounts.map((a) => a.id))}>
              全选
            </Button>
            <Button size="small" type="link" onClick={() => setAccountIds([])}>清空</Button>
            <div style={{ marginTop: 8 }}>
              {PLATFORMS.map((p) => {
                const list = accountsByPlat[p.value] || []
                if (list.length === 0) return null
                const allSel = list.every((a) => accountIds.includes(a.id))
                return (
                  <div key={p.value} style={{ marginBottom: 8 }}>
                    <Space size={6} wrap>
                      <Tag color={p.color} style={{ color: '#fff', cursor: 'pointer' }} onClick={() => {
                        const ids = list.map((a) => a.id)
                        setAccountIds((p2) => allSel ? p2.filter((x) => !ids.includes(x)) : Array.from(new Set([...p2, ...ids])))
                      }}>
                        {p.emoji} {p.label}（{list.length}）{allSel ? ' ✓' : ''}
                      </Tag>
                      {list.map((a) => (
                        <Tag.CheckableTag
                          key={a.id}
                          checked={accountIds.includes(a.id)}
                          onChange={(checked) => {
                            setAccountIds((p2) => checked ? [...p2, a.id] : p2.filter((x) => x !== a.id))
                          }}
                        >
                          {a.account_name}
                        </Tag.CheckableTag>
                      ))}
                    </Space>
                  </div>
                )
              })}
              {accounts.length === 0 && (
                <Empty description="还没建账号，请先到「账号矩阵」添加" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#8c8c8c' }}>
              已选 <strong style={{ color: '#1d57e0' }}>{accountIds.length}</strong> 个账号
            </div>
          </div>
          <div>
            <strong>③ 发布时间</strong>
            <div style={{ marginTop: 8 }}>
              <DatePicker
                showTime={{ format: 'HH:mm', minuteStep: 5 }}
                format="YYYY-MM-DD HH:mm"
                value={when}
                onChange={setWhen}
                style={{ width: 280 }}
              />
            </div>
          </div>
        </Space>
      </Modal>
    </>
  )
}

// ====================================== 素材库 ======================================
function AssetsTab() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [kw, setKw] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('listSvAssets', { keyword: kw, page_size: 100 })
      setItems(r.items || [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder="搜素材标题 / 描述 / 标签"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          onSearch={load}
          style={{ width: 280 }}
          allowClear
        />
        <Button type="primary" icon={<VideoCameraAddOutlined />} onClick={() => setEditing({})}>
          新增素材
        </Button>
      </Space>

      {loading ? '加载中...' : items.length === 0 ? (
        <Empty description="还没有素材，点上面新增" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {items.map((it) => (
            <Card
              key={it.id}
              hoverable
              cover={
                it.cover_path ? (
                  <img src={it.cover_path} style={{ width: '100%', height: 140, objectFit: 'cover' }} />
                ) : (
                  <div style={{ height: 140, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bfbfbf' }}>
                    <PlayCircleOutlined style={{ fontSize: 40 }} />
                  </div>
                )
              }
              actions={[
                <EditOutlined key="e" onClick={() => setEditing(it)} />,
                <CopyOutlined key="c" onClick={() => copyText([it.title, '', it.description, '', it.tags].filter(Boolean).join('\n')).then(() => message.success('已复制通用文案'))} />,
                <Popconfirm key="d" title="删除该素材？" onConfirm={async () => { await api.post('deleteSvAsset', { id: it.id }); load() }}>
                  <DeleteOutlined />
                </Popconfirm>,
              ]}
              size="small"
            >
              <Card.Meta
                title={<span style={{ fontSize: 13 }}>{it.title}</span>}
                description={
                  <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                    {it.video_path ? <Tag color="green" style={{ fontSize: 10 }}>视频</Tag> : <Tag style={{ fontSize: 10 }}>无视频</Tag>}
                    {it.platform_copies && <Tag color="blue" style={{ fontSize: 10 }}>5 平台文案</Tag>}
                    <div style={{ marginTop: 4 }}>{it.created_at?.slice(0, 10)}</div>
                  </div>
                }
              />
            </Card>
          ))}
        </div>
      )}

      <AssetEditor
        asset={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load() }}
      />
    </div>
  )
}

function AssetEditor({ asset, onClose, onSaved }: { asset: any | null; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm()
  const [videoUrl, setVideoUrl] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [uploadingV, setUploadingV] = useState(false)
  const [uploadingC, setUploadingC] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [platCopies, setPlatCopies] = useState<Record<string, { title: string; description: string; tags: string }>>({})

  useEffect(() => {
    if (asset) {
      form.setFieldsValue({
        title: asset.title || '',
        description: asset.description || '',
        tags: asset.tags || '',
      })
      setVideoUrl(asset.video_path || '')
      setCoverUrl(asset.cover_path || '')
      try {
        setPlatCopies(asset.platform_copies ? JSON.parse(asset.platform_copies) : {})
      } catch {
        setPlatCopies({})
      }
    }
  }, [asset])

  if (!asset) return null
  const isEdit = !!asset.id

  const uploadFile = async (file: File, kind: 'video' | 'cover') => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', kind)
    const r = await api.upload('uploadSvFile', fd)
    return r.url
  }

  const aiGen = async () => {
    const v = await form.validateFields(['title', 'description'])
    setAiBusy(true)
    try {
      const r = await api.post('aiGeneratePlatformCopy', { title: v.title, description: v.description || '' })
      setPlatCopies(r.copies || {})
      message.success('已生成 5 平台文案，可逐条微调')
    } catch (e: any) {
      message.error(e?.message || 'AI 生成失败')
    } finally {
      setAiBusy(false)
    }
  }

  const submit = async () => {
    const v = await form.validateFields()
    const payload = {
      ...v,
      video_path: videoUrl,
      cover_path: coverUrl,
      platform_copies: platCopies,
    }
    if (isEdit) {
      await api.post('updateSvAsset', { id: asset.id, ...payload })
    } else {
      await api.post('createSvAsset', payload)
    }
    message.success('已保存')
    onSaved()
  }

  return (
    <Drawer
      open={!!asset}
      onClose={onClose}
      title={isEdit ? `编辑素材 #${asset.id}` : '新增素材'}
      width={720}
      destroyOnClose
      extra={<Button type="primary" onClick={submit}>保存</Button>}
    >
      <Form form={form} layout="vertical">
        <Space style={{ width: '100%' }} align="start" size={16}>
          <div style={{ width: 180 }}>
            <div style={{ marginBottom: 8 }}><strong>视频</strong></div>
            {videoUrl ? (
              <div>
                <video src={videoUrl} controls style={{ width: 180, height: 100, background: '#000' }} />
                <Button size="small" block onClick={() => setVideoUrl('')} style={{ marginTop: 4 }}>
                  移除
                </Button>
              </div>
            ) : (
              <Upload.Dragger
                accept="video/*"
                showUploadList={false}
                beforeUpload={async (file) => {
                  setUploadingV(true)
                  try {
                    const url = await uploadFile(file, 'video')
                    setVideoUrl(url)
                    message.success('视频已上传')
                  } catch (e: any) {
                    message.error(e?.message || '上传失败')
                  } finally {
                    setUploadingV(false)
                  }
                  return false
                }}
              >
                <p><UploadOutlined /> {uploadingV ? '上传中...' : '点击或拖拽上传'}</p>
                <p style={{ fontSize: 11, color: '#8c8c8c' }}>≤ 500MB</p>
              </Upload.Dragger>
            )}
          </div>
          <div style={{ width: 180 }}>
            <div style={{ marginBottom: 8 }}><strong>封面</strong></div>
            {coverUrl ? (
              <div>
                <img src={coverUrl} style={{ width: 180, height: 100, objectFit: 'cover', borderRadius: 4 }} />
                <Button size="small" block onClick={() => setCoverUrl('')} style={{ marginTop: 4 }}>
                  移除
                </Button>
              </div>
            ) : (
              <Upload.Dragger
                accept="image/*"
                showUploadList={false}
                beforeUpload={async (file) => {
                  setUploadingC(true)
                  try {
                    const url = await uploadFile(file, 'cover')
                    setCoverUrl(url)
                    message.success('封面已上传')
                  } catch (e: any) {
                    message.error(e?.message || '上传失败')
                  } finally {
                    setUploadingC(false)
                  }
                  return false
                }}
              >
                <p><UploadOutlined /> {uploadingC ? '上传中...' : '点击或拖拽上传'}</p>
                <p style={{ fontSize: 11, color: '#8c8c8c' }}>≤ 10MB</p>
              </Upload.Dragger>
            )}
          </div>
        </Space>

        <Form.Item name="title" label="标题" rules={[{ required: true }]} style={{ marginTop: 16 }}>
          <Input placeholder="给这条视频起个名（仅内部识别用）" />
        </Form.Item>
        <Form.Item name="description" label="通用文案">
          <Input.TextArea rows={3} placeholder="原始文案 / 视频要点，AI 会基于这个生成 5 平台版本" />
        </Form.Item>
        <Form.Item name="tags" label="通用标签 / 话题">
          <Input placeholder="#建材 #装修 #雅加达" />
        </Form.Item>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <strong>5 平台差异化文案</strong>
          <Button size="small" type="primary" icon={<RobotOutlined />} loading={aiBusy} onClick={aiGen}>
            AI 一键生成
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            生成后可逐条微调
          </Typography.Text>
        </div>

        {PLATFORMS.map((p) => {
          const c = platCopies[p.value] || { title: '', description: '', tags: '' }
          const upd = (patch: Partial<typeof c>) =>
            setPlatCopies((prev) => ({ ...prev, [p.value]: { ...c, ...patch } }))
          return (
            <Card
              key={p.value}
              size="small"
              title={
                <span>
                  <Tag color={p.color} style={{ color: '#fff' }}>{p.emoji} {p.label}</Tag>
                </span>
              }
              style={{ marginBottom: 12 }}
              extra={
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyText([c.title, '', c.description, '', c.tags].filter(Boolean).join('\n')).then(() => message.success('已复制'))}
                >
                  复制
                </Button>
              }
            >
              <Input
                size="small"
                placeholder="标题"
                value={c.title}
                onChange={(e) => upd({ title: e.target.value })}
                style={{ marginBottom: 6 }}
              />
              <Input.TextArea
                size="small"
                placeholder="描述"
                value={c.description}
                onChange={(e) => upd({ description: e.target.value })}
                autoSize={{ minRows: 2, maxRows: 6 }}
                style={{ marginBottom: 6 }}
              />
              <Input
                size="small"
                placeholder="标签 / 话题"
                value={c.tags}
                onChange={(e) => upd({ tags: e.target.value })}
              />
            </Card>
          )
        })}
      </Form>
    </Drawer>
  )
}

// ====================================== 账号矩阵 ======================================
function AccountsTab() {
  const [items, setItems] = useState<any[]>([])
  const [editing, setEditing] = useState<any | null>(null)

  const load = async () => {
    const r = await api.get('listSvAccounts')
    setItems(r.items || [])
  }
  useEffect(() => { load() }, [])

  const byPlat: Record<string, any[]> = {}
  for (const a of items) {
    if (!byPlat[a.platform]) byPlat[a.platform] = []
    byPlat[a.platform].push(a)
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>
          新增账号
        </Button>
      </Space>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {PLATFORMS.map((p) => {
          const list = byPlat[p.value] || []
          return (
            <Card
              key={p.value}
              size="small"
              title={
                <span>
                  <Tag color={p.color} style={{ color: '#fff' }}>{p.emoji} {p.label}</Tag>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#8c8c8c' }}>{list.length}</span>
                </span>
              }
            >
              {list.length === 0 ? (
                <div style={{ color: '#bfbfbf', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>
                  无账号
                </div>
              ) : (
                list.map((a) => (
                  <div key={a.id} style={{ marginBottom: 8, padding: 8, background: '#fafbfc', borderRadius: 4, fontSize: 12 }}>
                    <div style={{ fontWeight: 600 }}>{a.account_name}</div>
                    {a.handle && <div style={{ color: '#8c8c8c' }}>@{a.handle}</div>}
                    {a.owner_phone && <div style={{ color: '#8c8c8c' }}>📱 {a.owner_phone}</div>}
                    {a.followers > 0 && <div style={{ color: '#8c8c8c' }}>{a.followers.toLocaleString()} 粉</div>}
                    <Space size={4} style={{ marginTop: 4 }}>
                      <Button size="small" type="link" onClick={() => setEditing(a)}>编辑</Button>
                      <Popconfirm title="删除？" onConfirm={async () => { await api.post('deleteSvAccount', { id: a.id }); load() }}>
                        <Button size="small" type="link" danger>删除</Button>
                      </Popconfirm>
                    </Space>
                  </div>
                ))
              )}
            </Card>
          )
        })}
      </div>

      <AccountEditor
        account={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load() }}
      />
    </div>
  )
}

function AccountEditor({ account, onClose, onSaved }: { account: any | null; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm()
  useEffect(() => {
    if (account) {
      form.setFieldsValue({
        platform: account.platform || 'xiaohongshu',
        account_name: account.account_name || '',
        handle: account.handle || '',
        owner_phone: account.owner_phone || '',
        followers: account.followers || 0,
        status: account.status || 'active',
        remark: account.remark || '',
      })
    }
  }, [account])

  if (!account) return null
  const isEdit = !!account.id

  const submit = async () => {
    const v = await form.validateFields()
    if (isEdit) await api.post('updateSvAccount', { id: account.id, ...v })
    else await api.post('createSvAccount', v)
    message.success('已保存')
    onSaved()
  }

  return (
    <Modal
      open={!!account}
      onCancel={onClose}
      title={isEdit ? `编辑账号 #${account.id}` : '新增账号'}
      onOk={submit}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="platform" label="平台" rules={[{ required: true }]}>
          <Select options={PLATFORMS.map((p) => ({ value: p.value, label: `${p.emoji} ${p.label}` }))} />
        </Form.Item>
        <Form.Item name="account_name" label="账号名 / 显示名" rules={[{ required: true }]}>
          <Input placeholder="如：星选建材主号" />
        </Form.Item>
        <Form.Item name="handle" label="账号 ID / handle">
          <Input placeholder="@xxxxxx" />
        </Form.Item>
        <Form.Item name="owner_phone" label="所在手机 / 操作人">
          <Input placeholder="如：1号机 / 张三的手机" />
        </Form.Item>
        <Form.Item name="followers" label="粉丝数">
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select
            options={[
              { value: 'active', label: '正常' },
              { value: 'paused', label: '暂停' },
              { value: 'banned', label: '封停' },
            ]}
          />
        </Form.Item>
        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
