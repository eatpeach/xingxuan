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
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { CheckCircleOutlined, ShopOutlined } from '@ant-design/icons'
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
const BRAND = '#1d57e0'

export default function PublicQuotePage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [inquiry, setInquiry] = useState<{
    no: string
    title: string
    remark: string
    deadline?: string
    items: InquiryItem[]
  } | null>(null)
  const [supplier, setSupplier] = useState<{ id: number; name: string } | null>(null)
  const [brand, setBrand] = useState<{ company_name: string; logo_url: string }>({
    company_name: '星选建材',
    logo_url: '',
  })
  const [items, setItems] = useState<ItemFormState[]>([])
  const [validUntil, setValidUntil] = useState<dayjs.Dayjs | null>(null)
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await axios.get(PUBLIC_API, {
          params: { action: 'publicGetInquiry', token },
        })
        if (!alive) return
        if (res.data?.success === false) {
          setErrMsg(res.data.message || '链接无效或已过期')
          return
        }
        const inq = res.data.inquiry
        setInquiry(inq)
        setSupplier(res.data.supplier)
        if (res.data.brand) setBrand(res.data.brand)
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
  const filledCount = items.filter((it) => it.supplier_price && it.supplier_price > 0).length

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
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e: any) {
      message.error(e?.response?.data?.message || e.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="pq-fullpage">
        <Spin tip="加载中..." size="large" />
      </div>
    )
  }
  if (errMsg) {
    return (
      <div className="pq-fullpage">
        <Result status="error" title="无法打开此链接" subTitle={errMsg} />
      </div>
    )
  }
  if (submitted) {
    return (
      <div className="pq-fullpage">
        <Result
          status="success"
          icon={<CheckCircleOutlined style={{ color: BRAND }} />}
          title="提交成功"
          subTitle={`感谢 ${supplier?.name || '您'} 的报价，${brand.company_name} 已收到，我们会尽快处理。`}
        />
      </div>
    )
  }

  return (
    <div className="pq-page">
      <style>{styles}</style>

      <div className="pq-hero">
        <div className="pq-hero-inner">
          <div className="pq-brand">
            {brand.logo_url ? (
              <img
                src={brand.logo_url}
                alt=""
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            ) : null}
            <div>
              <div className="pq-brand-name">{brand.company_name}</div>
              <div className="pq-brand-sub">供应商报价填报</div>
            </div>
          </div>
          <div className="pq-hero-right">
            <div className="pq-supplier">
              <ShopOutlined style={{ marginRight: 6 }} />
              {supplier?.name}
            </div>
          </div>
        </div>
      </div>

      <div className="pq-container">
        <Card className="pq-card" bordered={false}>
          <div className="pq-title-row">
            <Typography.Title level={4} style={{ margin: 0 }}>
              {inquiry?.title || '询价单'}
            </Typography.Title>
            <Tag color="blue" style={{ fontSize: 13, padding: '2px 10px' }}>
              单号 {inquiry?.no}
            </Tag>
          </div>
          {inquiry?.deadline && (
            <div className="pq-deadline">
              报价截止：<strong>{inquiry.deadline.slice(0, 16)}</strong>
            </div>
          )}
          {inquiry?.remark && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              message="客户说明"
              description={<span style={{ whiteSpace: 'pre-wrap' }}>{inquiry.remark}</span>}
            />
          )}
        </Card>

        <Card
          className="pq-card"
          bordered={false}
          title={
            <span>
              请按行填写报价
              <Tag style={{ marginLeft: 12 }} color={filledCount === items.length ? 'success' : 'orange'}>
                已填 {filledCount}/{items.length}
              </Tag>
            </span>
          }
        >
          <Table
            rowKey="inquiry_item_id"
            dataSource={items}
            pagination={false}
            size="small"
            scroll={{ x: 'max-content' }}
            columns={[
              { title: '#', width: 40, render: (_, _r, idx) => idx + 1 },
              {
                title: '产品 / 规格',
                width: 220,
                render: (_, _r, idx) => {
                  const inqItem = inquiry?.items[idx]
                  return (
                    <div>
                      <div style={{ fontWeight: 500 }}>{inqItem?.product_name}</div>
                      {inqItem?.spec && (
                        <div className="pq-muted">{inqItem.spec}</div>
                      )}
                      {inqItem?.remark && (
                        <div className="pq-muted">备注：{inqItem.remark}</div>
                      )}
                    </div>
                  )
                },
              },
              {
                title: '需求数量',
                width: 100,
                render: (_, _r, idx) => {
                  const inqItem = inquiry?.items[idx]
                  return (
                    <span style={{ fontWeight: 500 }}>
                      {inqItem?.qty} {inqItem?.unit}
                    </span>
                  )
                },
              },
              {
                title: '品牌',
                width: 140,
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
                width: 140,
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
                title: <span style={{ color: BRAND }}>单价 *</span>,
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
                    status={row.supplier_price && row.supplier_price > 0 ? '' : 'warning'}
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
                width: 110,
                render: (_, row) => {
                  const sub = (Number(row.supplier_price) || 0) * (Number(row.qty) || 0)
                  return (
                    <strong style={{ color: sub > 0 ? BRAND : '#bfbfbf' }}>
                      ¥ {sub.toLocaleString()}
                    </strong>
                  )
                },
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
          />
        </Card>

        <Card className="pq-card" bordered={false} title="其他">
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
              <Input.TextArea
                rows={3}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="付款方式 / 配送范围 / 其他需要说明的内容"
              />
            </Form.Item>
          </Form>
        </Card>

        <div style={{ height: 96 }} />
      </div>

      <div className="pq-sticky-bar">
        <div className="pq-sticky-inner">
          <div>
            <span className="pq-muted">已填 {filledCount}/{items.length}，预计合计</span>
            <div className="pq-total">¥ {totalPreview.toLocaleString()}</div>
          </div>
          <Button
            type="primary"
            size="large"
            loading={submitting}
            onClick={submit}
            style={{ minWidth: 160, height: 48, fontSize: 16 }}
          >
            提交报价
          </Button>
        </div>
      </div>
    </div>
  )
}

const styles = `
.pq-page { background: #f5f7fa; min-height: 100vh; padding-bottom: 48px; }
.pq-fullpage {
  min-height: 100vh; background: #f5f7fa; display: flex;
  align-items: center; justify-content: center; padding: 32px;
}
.pq-hero {
  background: linear-gradient(135deg, ${BRAND} 0%, #4096ff 100%);
  color: #fff;
  padding: 24px 0;
  margin-bottom: 16px;
}
.pq-hero-inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.pq-brand { display: flex; align-items: center; gap: 12px; }
.pq-brand img { height: 44px; width: 44px; object-fit: contain; background: #fff; padding: 4px; border-radius: 8px; }
.pq-brand-name { font-size: 20px; font-weight: 700; letter-spacing: 2px; }
.pq-brand-sub { font-size: 12px; opacity: 0.85; letter-spacing: 1px; }
.pq-supplier {
  background: rgba(255,255,255,0.15);
  padding: 6px 14px;
  border-radius: 16px;
  font-size: 13px;
  border: 1px solid rgba(255,255,255,0.3);
}
.pq-container { max-width: 1080px; margin: 0 auto; padding: 0 16px; }
.pq-card { margin-bottom: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
.pq-title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pq-deadline { margin-top: 6px; color: #595959; font-size: 13px; }
.pq-muted { color: #999; font-size: 12px; }
.pq-sticky-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: #fff;
  border-top: 1px solid #e8e8e8;
  box-shadow: 0 -4px 16px rgba(0,0,0,0.06);
  padding: 12px 0;
  z-index: 10;
}
.pq-sticky-inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pq-total {
  font-size: 22px;
  font-weight: 700;
  color: ${BRAND};
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

@media (max-width: 720px) {
  .pq-hero { padding: 16px 0; }
  .pq-brand-name { font-size: 16px; }
  .pq-total { font-size: 18px; }
}
`
