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

  // 「所属大类」只能选顶级大类（两级限制），排除自己
  const parentOptions = (cur: CatRow) =>
    items
      .filter((t) => t.parent_id === null && t.id !== cur.id)
      .map((t) => ({ label: t.name, value: t.id }))

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
              <div className="cm-row sub" key={c.id}>
                <span className="cm-name">
                  {c.name}
                  {rowMeta(c)}
                </span>
                {rowOps(c)}
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
            extra="留空则作为大类；选择后成为该大类的子类。名下已有子类的大类不能改为子类。"
          >
            <Select
              allowClear
              placeholder="（作为大类）"
              options={editing ? parentOptions(editing) : []}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  )
}
