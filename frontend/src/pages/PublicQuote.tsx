import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Result,
  Space,
  Spin,
  Table,
  Typography,
  message,
} from 'antd'
import { CheckCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

interface InquiryItem {
  id: number
  line_no: number
  product_name: string
  spec: string
  unit: string
  qty: number
  remark: string
}

interface ItemFormState {
  inquiry_item_id: number
  brand: string
  model: string
  supplier_price: number | null
  qty: number
  unit: string
  lead_time: string
  remark: string
}

const PUBLIC_API = '/api/handler.php'

export default function PublicQuotePage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [inquiry, setInquiry] = useState<{ no: string; title: string; remark: string; items: InquiryItem[] } | null>(null)
  const [supplier, setSupplier] = useState<{ id: number; name: string } | null>(null)
  const [items, setItems] = useState<ItemFormState[]>([])
  const [validUntil, setValidUntil] = useState<dayjs.Dayjs | null>(null)
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await axios.get(PUBLIC_API, { params: { action: 'publicGetInquiry', token } })
        if (!alive) return
        if (res.data?.success === false) {
          setErrMsg(res.data.message || '链接无效或已过期')
          return
        }
        const inq = res.data.inquiry
        setInquiry(inq)
        setSupplier(res.data.supplier)
        const existing = res.data.existing_quote
        const fillMap: Record<number, any> = {}
        if (existing?.items) {
          for (const it of existing.items) fillMap[it.inquiry_item_id] = it
        }
        setItems(
          (inq.items || []).map((row: InquiryItem) => {
            const old = fillMap[row.id]
            return {
              inquiry_item_id: row.id,
              brand: old?.brand ?? '',
              model: old?.model ?? '',
              supplier_price: old?.supplier_price ?? null,
              qty: old?.qty ?? row.qty,
              unit: old?.unit ?? row.unit,
              lead_time: old?.lead_time ?? '',
              remark: old?.remark ?? '',
            }
          }),
        )
        if (existing?.valid_until) setValidUntil(dayjs(existing.valid_until))
        if (existing?.remark) setRemark(existing.remark)
      } catch (e: any) {
        setErrMsg(e?.response?.data?.message || e.message || '加载失败')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [token])

  const updateItem = (idx: number, patch: Partial<ItemFormState>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))

  const totalPreview = items.reduce(
    (sum, it) => sum + (Number(it.supplier_price) || 0) * (Number(it.qty) || 0),
    0,
  )

  const submit = async () => {
    const empty = items.find((it) => !it.supplier_price || it.supplier_price <= 0)
    if (empty) {
      message.warning('请确认每行都填了单价')
      return
    }
    setSubmitting(true)
    try {
      const res = await axios.post(
        PUBLIC_API,
        {
          items,
          remark,
          valid_until: validUntil ? validUntil.format('YYYY-MM-DD HH:mm:ss') : null,
        },
        { params: { action: 'publicSubmitQuote', token } },
      )
      if (res.data?.success === false) {
        message.error(res.data.message || '提交失败')
        return
      }
      setSubmitted(true)
    } catch (e: any) {
      message.error(e?.response?.data?.message || e.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={pageStyle}>
        <Spin tip="加载中..." size="large" />
      </div>
    )
  }

  if (errMsg) {
    return (
      <div style={pageStyle}>
        <Result status="error" title="无法打开此链接" subTitle={errMsg} />
      </div>
    )
  }

  if (submitted) {
    return (
      <div style={pageStyle}>
        <Result
          status="success"
          icon={<CheckCircleOutlined />}
          title="提交成功"
          subTitle={`感谢 ${supplier?.name || '您'} 的报价，星选建材已收到，我们会尽快处理。`}
        />
      </div>
    )
  }

  return (
    <div style={{ ...pageStyle, maxWidth: 960, alignItems: 'stretch', padding: '24px 16px' }}>
      <Card>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          {inquiry?.title || '询价单'}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          单号 <Typography.Text code>{inquiry?.no}</Typography.Text> · 供应商：
          <strong>{supplier?.name}</strong>
        </Typography.Paragraph>
        {inquiry?.remark && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message="说明"
            description={inquiry.remark}
          />
        )}
      </Card>

      <Card style={{ marginTop: 16 }} title="请按行填写报价" bordered>
        <Table
          rowKey="inquiry_item_id"
          dataSource={items}
          pagination={false}
          size="small"
          scroll={{ x: 'max-content' }}
          columns={[
            {
              title: '#',
              width: 50,
              render: (_, _row, idx) => idx + 1,
            },
            {
              title: '产品 / 规格',
              width: 220,
              render: (_, _row, idx) => {
                const inqItem = inquiry?.items[idx]
                return (
                  <div>
                    <div style={{ fontWeight: 500 }}>{inqItem?.product_name}</div>
                    {inqItem?.spec && <div style={{ color: '#999', fontSize: 12 }}>{inqItem.spec}</div>}
                    {inqItem?.remark && <div style={{ color: '#999', fontSize: 12 }}>备注：{inqItem.remark}</div>}
                  </div>
                )
              },
            },
            {
              title: '需求数量',
              width: 100,
              render: (_, _row, idx) => {
                const inqItem = inquiry?.items[idx]
                return `${inqItem?.qty} ${inqItem?.unit}`
              },
            },
            {
              title: '品牌',
              width: 160,
              render: (_, row, idx) => (
                <Input
                  size="small"
                  value={row.brand}
                  onChange={(e) => updateItem(idx, { brand: e.target.value })}
                  placeholder="可选"
                />
              ),
            },
            {
              title: '型号',
              width: 160,
              render: (_, row, idx) => (
                <Input
                  size="small"
                  value={row.model}
                  onChange={(e) => updateItem(idx, { model: e.target.value })}
                  placeholder="可选"
                />
              ),
            },
            {
              title: '单价 *',
              width: 130,
              render: (_, row, idx) => (
                <InputNumber
                  size="small"
                  min={0}
                  step={0.01}
                  style={{ width: '100%' }}
                  value={row.supplier_price ?? undefined}
                  onChange={(v) => updateItem(idx, { supplier_price: v == null ? null : Number(v) })}
                  placeholder="必填"
                />
              ),
            },
            {
              title: '货期',
              width: 120,
              render: (_, row, idx) => (
                <Input
                  size="small"
                  value={row.lead_time}
                  onChange={(e) => updateItem(idx, { lead_time: e.target.value })}
                  placeholder="如 7 天"
                />
              ),
            },
            {
              title: '行小计',
              width: 100,
              render: (_, row) => (
                <span>¥ {((Number(row.supplier_price) || 0) * (Number(row.qty) || 0)).toLocaleString()}</span>
              ),
            },
            {
              title: '备注',
              width: 160,
              render: (_, row, idx) => (
                <Input
                  size="small"
                  value={row.remark}
                  onChange={(e) => updateItem(idx, { remark: e.target.value })}
                  placeholder="可选"
                />
              ),
            },
          ]}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6} align="right">
                <strong>合计</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6}>
                <strong style={{ color: '#1677ff' }}>¥ {totalPreview.toLocaleString()}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={7} colSpan={2} />
            </Table.Summary.Row>
          )}
        />
      </Card>

      <Card style={{ marginTop: 16 }}>
        <Form layout="vertical">
          <Form.Item label="报价有效期">
            <DatePicker
              value={validUntil}
              onChange={(d) => setValidUntil(d)}
              style={{ width: 240 }}
              placeholder="如 2026-05-31"
            />
          </Form.Item>
          <Form.Item label="备注 / 说明" style={{ marginBottom: 0 }}>
            <Input.TextArea rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} />
          </Form.Item>
        </Form>
      </Card>

      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <Space>
          <Typography.Text type="secondary">
            提交后还可重新打开链接修改（直到星选采纳此报价为止）
          </Typography.Text>
        </Space>
        <div style={{ marginTop: 12 }}>
          <Button type="primary" size="large" loading={submitting} onClick={submit}>
            提交报价
          </Button>
        </div>
      </div>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f5f7fa',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  padding: 32,
}
