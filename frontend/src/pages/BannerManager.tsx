import { useCallback, useEffect, useState } from 'react'
import { Button, Drawer, Empty, Input, Popconfirm, Space, Spin, Switch, Upload, message } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { api } from '../api'

interface BannerRow {
  id: number
  image_url: string
  link_url: string
  sort_weight: number
  is_active: number
}

/** 首页横幅幻灯片管理（仅 admin）：上传整图 + 链接 + 排序 + 启停 */
export default function BannerManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<BannerRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api
      .get('adminListBanners')
      .then((r) => setItems(r.items || []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const save = async (payload: Record<string, unknown>) => {
    await api.post('saveBanner', payload)
    load()
  }

  return (
    <Drawer
      title="首页横幅幻灯片"
      open={open}
      onClose={onClose}
      width={Math.min(560, window.innerWidth)}
      extra={
        <Upload
          accept="image/png,image/jpeg,image/webp"
          showUploadList={false}
          customRequest={async ({ file, onSuccess, onError }) => {
            const fd = new FormData()
            fd.append('file', file as File)
            try {
              const r = await api.upload('uploadBannerImage', fd)
              await api.post('saveBanner', { image_path: r.path, link_url: '', is_active: 1 })
              message.success('已添加横幅')
              load()
              onSuccess?.(r)
            } catch (e) {
              onError?.(e as Error)
            }
          }}
        >
          <Button type="primary" icon={<PlusOutlined />}>
            上传横幅
          </Button>
        </Upload>
      }
    >
      <style>{`
        .bm-item { border: 1px solid #eef0f4; margin-bottom: 12px; }
        .bm-item img { width: 100%; display: block; aspect-ratio: 2.2 / 1; object-fit: cover; background: #f2f3f5; }
        .bm-body { padding: 10px 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      `}</style>
      <div style={{ color: '#8a94a6', fontSize: 12, marginBottom: 12 }}>
        建议尺寸约 1200×540（2.2:1）。链接选填：填了点击横幅跳转（站内路径如 /c/all 或完整外链）。首张固定为默认文案横幅，上传的图排在其后轮播。
      </div>
      <Spin spinning={loading}>
        {items.map((b, idx) => (
          <div className="bm-item" key={b.id}>
            <img src={b.image_url} alt="" />
            <div className="bm-body">
              <Input
                size="small"
                defaultValue={b.link_url}
                placeholder="点击跳转链接（选填）"
                style={{ flex: 1, minWidth: 160 }}
                onBlur={(e) => {
                  if (e.target.value !== b.link_url) save({ id: b.id, link_url: e.target.value, is_active: b.is_active })
                }}
              />
              <Switch
                checkedChildren="显示"
                unCheckedChildren="隐藏"
                checked={!!b.is_active}
                onChange={(v) => save({ id: b.id, link_url: b.link_url, is_active: v ? 1 : 0 })}
              />
              <Button
                size="small"
                type="text"
                icon={<ArrowUpOutlined />}
                disabled={idx === 0}
                onClick={async () => {
                  await api.post('moveBanner', { id: b.id, direction: 'up' })
                  load()
                }}
              />
              <Button
                size="small"
                type="text"
                icon={<ArrowDownOutlined />}
                disabled={idx === items.length - 1}
                onClick={async () => {
                  await api.post('moveBanner', { id: b.id, direction: 'down' })
                  load()
                }}
              />
              <Popconfirm
                title="确认删除该横幅？"
                onConfirm={async () => {
                  await api.post('deleteBanner', { id: b.id })
                  message.success('已删除')
                  load()
                }}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          </div>
        ))}
        {!loading && items.length === 0 && (
          <Empty description="暂无横幅图，点右上角上传（货架显示默认文案横幅）" style={{ padding: 24 }}>
            <Space />
          </Empty>
        )}
      </Spin>
    </Drawer>
  )
}
