import { useEffect, useState } from 'react'
import {
  Button,
  Cascader,
  Drawer,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Upload,
  message,
} from 'antd'
import type { UploadFile, UploadProps } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api } from '../../api'
import type { VendorProduct } from './types'

export interface CatNode {
  name: string
  children?: CatNode[]
}

/** 三级树 → AntD Cascader options */
export interface CascOption {
  value: string
  label: string
  children?: CascOption[]
}
export function toCascaderOptions(tree: CatNode[]): CascOption[] {
  return tree.map((c) => ({
    value: c.name,
    label: c.name,
    children: c.children && c.children.length ? toCascaderOptions(c.children) : undefined,
  }))
}

interface Props {
  open: boolean
  record: VendorProduct | null
  categories: CatNode[]
  onClose: () => void
  onSaved: () => void
}

/** 品类名 → 级联路径（递归任意层级） */
export function catPath(tree: CatNode[], name: string): string[] {
  const dfs = (nodes: CatNode[], trail: string[]): string[] | null => {
    for (const n of nodes) {
      const t2 = [...trail, n.name]
      if (n.name === name) return t2
      const r = n.children && n.children.length ? dfs(n.children, t2) : null
      if (r) return r
    }
    return null
  }
  return dfs(tree, []) || (name ? [name] : [])
}

// 新增/编辑商品 Drawer：H5 下接近全屏（width min(560, 100vw)）
export default function ProductFormDrawer({ open, record, categories, onClose, onSaved }: Props) {
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [saving, setSaving] = useState(false)
  const stockStatus = Form.useWatch('stock_status', form)

  useEffect(() => {
    if (!open) return
    if (record) {
      form.setFieldsValue({ ...record, category_path: catPath(categories, record.category) })
      setFileList(
        (record.images || []).map((url, i) => ({
          uid: `img-${i}`,
          name: `图片${i + 1}`,
          status: 'done' as const,
          url,
        })),
      )
    } else {
      form.resetFields()
      form.setFieldsValue({ unit: '件', currency: 'IDR', stock_status: 'in_stock' })
      setFileList([])
    }
  }, [open, record, form])

  const beforeUpload = (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      message.error('仅支持 JPG/PNG/WebP 图片')
      return Upload.LIST_IGNORE
    }
    if (file.size > 10 * 1024 * 1024) {
      message.error('图片不能超过 10MB')
      return Upload.LIST_IGNORE
    }
    return true
  }

  const customRequest: UploadProps['customRequest'] = async ({ file, onSuccess, onError }) => {
    const fd = new FormData()
    fd.append('file', file as File)
    try {
      const r = await api.upload('vendorUploadProductImage', fd)
      onSuccess?.(r)
    } catch (e) {
      onError?.(e as Error)
    }
  }

  const onUploadChange: UploadProps['onChange'] = ({ fileList: fl }) => {
    // 上传完成后把返回的 /storage/ 路径写进 url，与 images 数组保持同步
    setFileList(
      fl.map((f) => {
        const url = (f.response as { url?: string } | undefined)?.url
        return f.status === 'done' && !f.url && url ? { ...f, url } : f
      }),
    )
  }

  const onSubmit = async () => {
    let v: Record<string, unknown>
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    const images = fileList
      .filter((f) => f.status === 'done')
      .map((f) => f.url || (f.response as { url?: string } | undefined)?.url)
      .filter(Boolean)
    setSaving(true)
    try {
      const path = (v.category_path as string[] | undefined) || []
      delete v.category_path
      const r = await api.post('vendorSaveProduct', {
        ...(record ? { id: record.id } : {}),
        ...v,
        category: path[path.length - 1] || '',
        images,
      })
      if (record?.status === 'on' && r.status === 'pending') {
        message.info('改价幅度较大，已自动转平台审核，审核通过前商品暂不展示')
      } else if (record?.status === 'rejected') {
        message.success('已保存并重新送审')
      } else {
        message.success('已保存')
      }
      onSaved()
      onClose()
    } catch {
      // api 拦截器已 toast
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      title={record ? '编辑商品' : '新增商品'}
      open={open}
      onClose={onClose}
      width="min(560px, 100vw)"
      destroyOnClose={false}
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={onSubmit}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="name" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]}>
          <Input placeholder="如：600x600 抛光砖" maxLength={100} />
        </Form.Item>
        <Form.Item name="category_path" label="品类">
          <Cascader
            allowClear
            changeOnSelect
            showSearch
            placeholder="选择品类（大类 / 中类 / 小类）"
            options={toCascaderOptions(categories)}
          />
        </Form.Item>
        <Form.Item name="spec" label="规格">
          <Input placeholder="如：600x600mm" maxLength={100} />
        </Form.Item>
        <Form.Item name="brand" label="品牌">
          <Input maxLength={50} />
        </Form.Item>
        <Form.Item name="model" label="型号">
          <Input maxLength={50} />
        </Form.Item>
        <Form.Item name="unit" label="单位">
          <Input placeholder="件 / 箱 / 平米..." maxLength={20} />
        </Form.Item>
        <Form.Item name="base_price" label="供货底价" rules={[{ required: true, message: '请输入供货底价' }]}>
          <InputNumber
            min={0.01}
            style={{ width: '100%' }}
            placeholder="给平台的供货价"
            addonBefore={
              <Form.Item name="currency" noStyle>
                <Select
                  style={{ width: 80 }}
                  options={[{ value: 'IDR' }, { value: 'CNY' }, { value: 'USD' }]}
                />
              </Form.Item>
            }
          />
        </Form.Item>
        <Form.Item name="moq" label="起订量">
          <InputNumber min={1} style={{ width: '100%' }} placeholder="最少起订数量" />
        </Form.Item>
        <Form.Item name="stock_status" label="库存状态">
          <Radio.Group>
            <Radio value="in_stock">现货</Radio>
            <Radio value="pre_order">订货/定制生产</Radio>
          </Radio.Group>
        </Form.Item>
        {stockStatus === 'pre_order' && (
          <Form.Item name="lead_time" label="交期">
            <Input placeholder="如：7 天" maxLength={50} />
          </Form.Item>
        )}
        <Form.Item name="freight_note" label="运费说明">
          <Input placeholder="如：雅加达市内包运 / 到付" maxLength={100} />
        </Form.Item>
        <Form.Item label="商品图片">
          <Upload
            listType="picture-card"
            fileList={fileList}
            maxCount={6}
            accept="image/jpeg,image/png,image/webp"
            beforeUpload={beforeUpload}
            customRequest={customRequest}
            onChange={onUploadChange}
          >
            {fileList.length >= 6 ? null : (
              <div>
                <PlusOutlined />
                <div style={{ marginTop: 4, fontSize: 12 }}>上传</div>
              </div>
            )}
          </Upload>
          <div style={{ fontSize: 12, color: '#98a1b3' }}>最多 6 张，JPG/PNG/WebP，单张 ≤10MB</div>
        </Form.Item>
        <Form.Item name="description" label="详细描述">
          <Input.TextArea rows={3} placeholder="材质、工艺、适用场景等" maxLength={1000} />
        </Form.Item>
      </Form>
    </Drawer>
  )
}
