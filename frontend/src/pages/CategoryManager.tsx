import { useCallback, useEffect, useState } from 'react'
import { Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Spin, Tag, message } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { api } from '../api'

interface CatRow {
  id: number
  parent_id: number | null
  name: string
  sort_weight: number
  is_active: number
  product_count: number
  supplier_count: number
  children: CatRow[]
}

/** 展平出可作为「上级」的节点（大类 + 中类，即前两层），带层级标签 */
function flattenParents(items: CatRow[], depth = 0, out: { id: number; label: string }[] = []) {
  if (depth >= 2) return out
  for (const t of items) {
    out.push({ id: t.id, label: (depth === 0 ? '' : '　') + t.name })
    flattenParents(t.children || [], depth + 1, out)
  }
  return out
}

/** 品类管理（MRO 式两级：大类/子类），仅 admin 可操作 */
export default function CategoryManager({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [items, setItems] = useState<CatRow[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<CatRow | null>(null)
  const [form] = Form.useForm()

  const load = useCallback(() => {
    setLoading(true)
    api
      .get('listCategories')
      .then((r) => setItems(r.items || []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  // 「所属上级」可选大类或中类（前两层），排除自己
  const parentOptions = (cur: CatRow) =>
    flattenParents(items)
      .filter((o) => o.id !== cur.id)
      .map((o) => ({ label: o.label, value: o.id }))

  const openEdit = (r: CatRow) => {
    setEditing(r)
    form.setFieldsValue({ name: r.name, parent_id: r.parent_id ?? undefined })
  }

  const submitEdit = async () => {
    if (!editing) return
    try {
      const v = await form.validateFields()
      await save({ id: editing.id, name: v.name.trim(), parent_id: v.parent_id ?? null })
      setEditing(null)
    } catch (e: unknown) {
      if ((e as { errorFields?: unknown })?.errorFields) return
    }
  }

  const promptName = (title: string, initial: string, onOk: (name: string) => Promise<void>) => {
    let val = initial
    Modal.confirm({
      title,
      zIndex: 9999,
      content: (
        <Input
          defaultValue={initial}
          placeholder="品类名称"
          maxLength={20}
          onChange={(e) => {
            val = e.target.value
          }}
        />
      ),
      onOk: async () => {
        if (!val.trim()) {
          message.warning('请输入名称')
          return Promise.reject()
        }
        await onOk(val.trim())
      },
    })
  }

  const save = async (payload: Record<string, unknown>) => {
    await api.post('saveCategory', payload)
    message.success('已保存')
    load()
  }

  const move = async (id: number, direction: 'up' | 'down') => {
    await api.post('moveCategory', { id, direction })
    load()
  }

  const del = async (id: number) => {
    try {
      await api.post('deleteCategory', { id })
      message.success('已删除')
      load()
    } catch {
      // api 拦截器已 toast（有商品/子类时后端拒绝）
    }
  }

  const rowOps = (r: CatRow) => (
    <Space size={4}>
      <Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={() => move(r.id, 'up')} />
      <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={() => move(r.id, 'down')} />
      <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
      <Button
        size="small"
        type="text"
        onClick={() => save({ id: r.id, name: r.name, parent_id: r.parent_id, is_active: r.is_active ? 0 : 1 })}
      >
        {r.is_active ? '停用' : '启用'}
      </Button>
      <Popconfirm title="确认删除该品类？" onConfirm={() => del(r.id)}>
        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
      </Popconfirm>
    </Space>
  )

  const rowMeta = (r: CatRow) => (
    <span className="cm-meta">
      商品 {r.product_count} · 供应商 {r.supplier_count}
      {!r.is_active && <Tag style={{ marginLeft: 8 }}>已停用</Tag>}
    </span>
  )

  return (
    <Drawer
      title="品类管理（大类 / 子类）"
      open={open}
      onClose={onClose}
      width={Math.min(640, window.innerWidth)}
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => promptName('新增大类', '', (name) => save({ name }))}
        >
          新增大类
        </Button>
      }
    >
      <style>{`
        .cm-top { border: 1px solid #eef0f4; margin-bottom: 10px; }
        .cm-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; gap: 8px; flex-wrap: wrap; }
        .cm-row.head { background: #f7f8fa; font-weight: 600; }
        .cm-row.sub { padding-left: 34px; border-top: 1px dashed #f0f1f4; }
        .cm-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .cm-meta { font-size: 12px; color: #99a1b3; white-space: nowrap; }
        .cm-leaves { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 12px 10px 52px; }
        .cm-leaf { font-size: 12px; color: #556; background: #f4f6fa; padding: 2px 9px; cursor: pointer; }
        .cm-leaf:hover { background: color-mix(in srgb, var(--brand, #1d57e0) 12%, #fff); color: var(--brand, #1d57e0); }
        .cm-leaf.off { color: #bbb; text-decoration: line-through; }
      `}</style>
      <div style={{ color: '#8a94a6', fontSize: 12, marginBottom: 12 }}>
        商品与供应商按品类名称关联；重命名会自动同步存量商品、供应商与品类加价率；有商品或子类的品类不能删除。
      </div>
      <Spin spinning={loading}>
        {items.map((t) => (
          <div className="cm-top" key={t.id}>
            <div className="cm-row head">
              <span className="cm-name">
                {t.name}
                {rowMeta(t)}
              </span>
              <Space size={4}>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => promptName(`「${t.name}」下新增子类`, '', (name) => save({ name, parent_id: t.id }))}
                >
                  子类
                </Button>
                {rowOps(t)}
              </Space>
            </div>
            {t.children.map((c) => (
              <div key={c.id}>
                <div className="cm-row sub">
                  <span className="cm-name">
                    {c.name}
                    {rowMeta(c)}
                  </span>
                  <Space size={4}>
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => promptName(`「${c.name}」下新增小类`, '', (name) => save({ name, parent_id: c.id }))}
                    >
                      小类
                    </Button>
                    {rowOps(c)}
                  </Space>
                </div>
                {(c.children || []).length > 0 && (
                  <div className="cm-leaves">
                    {c.children.map((leaf) => (
                      <span
                        key={leaf.id}
                        className={`cm-leaf${leaf.is_active ? '' : ' off'}`}
                        onClick={() => openEdit(leaf)}
                        title="点击编辑/移动/停用"
                      >
                        {leaf.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        {!loading && items.length === 0 && (
          <div style={{ color: '#bbb', textAlign: 'center', padding: 32 }}>暂无品类，点右上角新增大类</div>
        )}
      </Spin>

      <Modal
        title="编辑品类"
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={submitEdit}
        zIndex={9999}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="品类名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item
            name="parent_id"
            label="所属大类"
            extra="留空作为顶级大类；选大类则成为中类；选中类则成为小类（最多三级）。"
          >
            <Select
              allowClear
              placeholder="（作为顶级大类）"
              options={editing ? parentOptions(editing) : []}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  )
}
