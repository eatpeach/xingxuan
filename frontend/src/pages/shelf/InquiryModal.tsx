import { useEffect, useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Result, message } from 'antd'
import { api } from '../../api'

export type ShelfCurrency = 'IDR' | 'CNY' | 'USD'

/** 货架列表项（详情页在此基础上扩展） */
export interface ShelfItem {
  id: number
  name: string
  spec: string
  brand: string
  category: string
  unit: string
  moq: number
  currency: ShelfCurrency
  sell_price: number
  stock_status: 'in_stock' | 'pre_order'
  lead_time: string
  cover: string
}

export interface ShelfMeta {
  company_name: string
  logo_url: string
  contact_phone: string
  contact_wechat: string
  qr_douyin_url: string
  qr_channels_url: string
  categories: { name: string; count: number }[]
  total_on: number
}

/** IDR → Rp 整数千分位；CNY → ¥ 两位；USD → $ 两位 */
export function formatPrice(currency: ShelfCurrency, n: number): string {
  const v = Number(n) || 0
  if (currency === 'IDR') return 'Rp ' + Math.round(v).toLocaleString('id-ID')
  if (currency === 'USD') return '$' + v.toFixed(2)
  return '¥' + v.toFixed(2)
}

type InquiryProduct = Pick<ShelfItem, 'id' | 'name' | 'spec' | 'unit' | 'moq' | 'sell_price' | 'currency'>

interface Props {
  open: boolean
  onClose: () => void
  product: InquiryProduct | null
  contactPhone?: string
}

export default function InquiryModal({ open, onClose, product, contactPhone }: Props) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [doneNo, setDoneNo] = useState<string | null>(null)

  useEffect(() => {
    if (open && product) {
      setDoneNo(null)
      form.setFieldsValue({
        name: '',
        phone: '',
        qty: product.moq > 0 ? product.moq : 1,
        remark: '',
      })
    }
  }, [open, product, form])

  const submit = async () => {
    if (!product) return
    try {
      const v = await form.validateFields()
      setSubmitting(true)
      const qty = Number(v.qty) || 1
      const res = await api.post<{ no: string }>('publicCreateInquiry', {
        name: v.name,
        phone: v.phone,
        title: '货架询单-' + product.name,
        items: [
          {
            product_name: product.name,
            spec: product.spec,
            qty,
            unit: product.unit,
            remark:
              '货架商品#' + product.id + ' 展示价 ' + formatPrice(product.currency, product.sell_price) +
              (v.remark ? '；' + v.remark : ''),
          },
        ],
      })
      setDoneNo(res.no)
    } catch (e: any) {
      // 表单校验失败不提示；axios 错误已由 api 拦截器统一 message.error
      if (e?.errorFields || e?.isAxiosError) return
      message.error(e?.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      zIndex={9999}
      forceRender
      title={doneNo ? '询价已提交' : product ? `询价 · ${product.name}` : '询价'}
    >
      {doneNo ? (
        <Result
          status="success"
          title={`询价已提交，单号 ${doneNo}`}
          subTitle={
            <>
              我们会尽快通过电话/WhatsApp 与您联系
              {contactPhone ? (
                <>
                  <br />
                  加急可致电 {contactPhone}
                </>
              ) : null}
            </>
          }
          extra={
            <Button type="primary" onClick={onClose}>
              关闭
            </Button>
          }
        />
      ) : (
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="称呼" rules={[{ required: true, message: '请输入您的称呼' }]}>
            <Input placeholder="如 张先生" />
          </Form.Item>
          <Form.Item
            name="phone"
            label="电话 / WhatsApp"
            rules={[
              { required: true, message: '请输入电话或 WhatsApp' },
              { pattern: /^[\d\-+\s()]{6,20}$/, message: '号码格式不对' },
            ]}
          >
            <Input placeholder="手机号或 WhatsApp" />
          </Form.Item>
          <Form.Item name="qty" label="数量">
            <InputNumber min={1} style={{ width: '100%' }} addonAfter={product?.unit || ''} />
          </Form.Item>
          <Form.Item name="remark" label="备注（可选）">
            <Input.TextArea rows={3} placeholder="颜色/规格要求、送货地址等" />
          </Form.Item>
          <Button type="primary" block size="large" loading={submitting} onClick={submit}>
            提交询价
          </Button>
        </Form>
      )}
    </Modal>
  )
}
