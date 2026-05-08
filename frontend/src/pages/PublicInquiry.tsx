import { useState } from 'react'
import axios from 'axios'
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Result,
  Space,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, PlusOutlined, SmileOutlined } from '@ant-design/icons'

interface ItemRow {
  product_name: string
  spec: string
  qty: number
  unit: string
  remark: string
}

const PUBLIC_API = '/api/handler.php'

export default function PublicInquiryPage() {
  const [form] = Form.useForm()
  const [items, setItems] = useState<ItemRow[]>([
    { product_name: '', spec: '', qty: 1, unit: '件', remark: '' },
  ])
  const [submitting, setSubmitting] = useState(false)
  const [submittedNo, setSubmittedNo] = useState<string | null>(null)

  const addRow = () =>
    setItems((p) => [...p, { product_name: '', spec: '', qty: 1, unit: '件', remark: '' }])

  const removeRow = (idx: number) =>
    setItems((p) => (p.length === 1 ? p : p.filter((_, i) => i !== idx)))

  const updateRow = (idx: number, patch: Partial<ItemRow>) =>
    setItems((p) => p.map((x, i) => (i === idx ? { ...x, ...patch } : x)))

  const onSubmit = async () => {
    try {
      const v = await form.validateFields()
      const validItems = items.filter((it) => it.product_name.trim())
      if (validItems.length === 0) {
        message.warning('请至少填写一个产品')
        return
      }
      setSubmitting(true)
      const res = await axios.post(
        PUBLIC_API,
        { ...v, items: validItems },
        { params: { action: 'publicCreateInquiry' } },
      )
      if (res.data?.success === false) {
        message.error(res.data.message || '提交失败')
        return
      }
      setSubmittedNo(res.data.no)
    } catch (e: any) {
      if (e?.errorFields) return // 表单校验
      message.error(e?.response?.data?.message || e.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (submittedNo) {
    return (
      <div style={page}>
        <Result
          icon={<SmileOutlined />}
          status="success"
          title="询价已提交"
          subTitle={
            <>
              询价单号 <Typography.Text code>{submittedNo}</Typography.Text>
              <br />
              我们会尽快与您联系，请保持电话畅通。
            </>
          }
        />
      </div>
    )
  }

  return (
    <div style={{ ...page, alignItems: 'stretch' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
        <Card>
          <Typography.Title level={3} style={{ marginTop: 0 }}>
            星选建材 · 在线询价
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            填写您需要的产品和数量，我们会按行寻源比价，最快当天给您回复报价单。
          </Typography.Paragraph>
        </Card>

        <Card style={{ marginTop: 16 }} title="联系方式" bordered>
          <Form form={form} layout="vertical">
            <Form.Item
              name="name"
              label="姓名 / 称呼"
              rules={[{ required: true, message: '请输入您的称呼' }]}
            >
              <Input placeholder="如 张先生" />
            </Form.Item>
            <Form.Item
              name="phone"
              label="联系电话"
              rules={[
                { required: true, message: '请输入电话' },
                { pattern: /^[\d\-+\s()]{6,20}$/, message: '电话格式不对' },
              ]}
            >
              <Input placeholder="手机或固话" />
            </Form.Item>
            <Form.Item name="company" label="公司 / 项目（可选）">
              <Input />
            </Form.Item>
            <Form.Item name="address" label="项目地址（可选）">
              <Input />
            </Form.Item>
          </Form>
        </Card>

        <Card style={{ marginTop: 16 }} title="询价明细" bordered>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {items.map((row, idx) => (
              <Card key={idx} size="small" type="inner" title={`第 ${idx + 1} 行`}
                extra={
                  items.length > 1 ? (
                    <Button type="link" danger icon={<DeleteOutlined />} onClick={() => removeRow(idx)}>
                      删除
                    </Button>
                  ) : null
                }
              >
                <div style={{ display: 'grid', gap: 8 }}>
                  <Input
                    placeholder="产品名称（如 抛光砖 800x800）*"
                    value={row.product_name}
                    onChange={(e) => updateRow(idx, { product_name: e.target.value })}
                  />
                  <Input
                    placeholder="规格（如 哑光 / 18mm）"
                    value={row.spec}
                    onChange={(e) => updateRow(idx, { spec: e.target.value })}
                  />
                  <Space.Compact style={{ display: 'flex' }}>
                    <InputNumber
                      style={{ flex: 1 }}
                      min={0}
                      value={row.qty}
                      onChange={(v) => updateRow(idx, { qty: Number(v ?? 1) })}
                      placeholder="数量"
                    />
                    <Input
                      style={{ flex: 1 }}
                      value={row.unit}
                      onChange={(e) => updateRow(idx, { unit: e.target.value })}
                      placeholder="单位（件 / 平方米 / 套）"
                    />
                  </Space.Compact>
                  <Input.TextArea
                    rows={2}
                    placeholder="备注（可选，如颜色 / 用途 / 安装要求）"
                    value={row.remark}
                    onChange={(e) => updateRow(idx, { remark: e.target.value })}
                  />
                </div>
              </Card>
            ))}
            <Button type="dashed" icon={<PlusOutlined />} onClick={addRow} block>
              添加一行
            </Button>
          </Space>
        </Card>

        <Card style={{ marginTop: 16 }}>
          <Form form={form} layout="vertical">
            <Form.Item name="remark" label="补充说明（可选）" style={{ marginBottom: 0 }}>
              <Input.TextArea rows={3} placeholder="如交货时间、特殊要求等" />
            </Form.Item>
          </Form>
        </Card>

        <div style={{ marginTop: 24, textAlign: 'center', paddingBottom: 32 }}>
          <Button type="primary" size="large" loading={submitting} onClick={onSubmit}>
            提交询价
          </Button>
          <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
            提交后请保持电话畅通，我们会尽快与您联系
          </div>
        </div>
      </div>
    </div>
  )
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f5f7fa',
  padding: 16,
}
