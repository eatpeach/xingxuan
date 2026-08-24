import { useState } from 'react'
import { Button, Input, Modal, Space, Table, Tag, Tooltip, message } from 'antd'
import { FieldTimeOutlined } from '@ant-design/icons'
import { api } from '../api'

interface Row {
  id: number
  product_name: string
  spec: string
  qty: number
  unit: string
  lead_time: string
}

/**
 * 单行交期编辑（20260824）
 *
 * 走 updateQuoteItemLeadTime，不走「改报价单」那条路：改交期不动钱，
 * 不该被已成交单的「必须填修改原因」拦住。
 */
export default function QuoteLeadTimeButton({
  quote,
  onSaved,
}: {
  quote: any
  onSaved?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [bulk, setBulk] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('getCustomerQuote', { id: quote.id })
      setRows(
        (r.items || []).map((it: any) => ({
          id: it.id,
          product_name: it.product_name,
          spec: it.spec,
          qty: it.qty,
          unit: it.unit,
          lead_time: it.lead_time || '',
        })),
      )
    } catch (e: any) {
      message.error(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const openModal = () => {
    setOpen(true)
    setBulk('')
    load()
  }

  const upd = (i: number, v: string) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, lead_time: v } : r)))

  const applyBulk = () => {
    const v = bulk.trim()
    if (!v) return
    setRows((p) => p.map((r) => ({ ...r, lead_time: v })))
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.post('updateQuoteItemLeadTime', {
        quote_id: quote.id,
        items: rows.map((r) => ({ id: r.id, lead_time: r.lead_time })),
      })
      message.success('交期已保存')
      setOpen(false)
      onSaved?.()
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const diffCount = new Set(rows.map((r) => r.lead_time.trim()).filter(Boolean)).size

  return (
    <>
      <Tooltip title="逐行设置交期，现货和长周期的货可以分开报">
        <Button icon={<FieldTimeOutlined />} onClick={openModal}>逐行交期</Button>
      </Tooltip>
      <Modal
        open={open}
        title={`逐行交期 · ${quote.no}`}
        onCancel={() => setOpen(false)}
        onOk={save}
        confirmLoading={saving}
        okText="保存交期"
        width={720}
      >
        <div style={{ marginBottom: 10, color: '#8c8c8c', fontSize: 12 }}>
          留空的行，报价单上显示整单生产周期
          {quote.production_cycle ? <Tag style={{ marginLeft: 6 }}>{quote.production_cycle}</Tag> : ' （整单周期还没填）'}
          。改交期不影响金额，不用填修改原因。
        </div>
        <Space.Compact style={{ marginBottom: 12, width: 360 }}>
          <Input
            placeholder="批量填入，如 现货 / 15-20 个工作日"
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            onPressEnter={applyBulk}
          />
          <Button onClick={applyBulk} disabled={!bulk.trim()}>套用到所有行</Button>
        </Space.Compact>
        {diffCount > 1 && (
          <Tag color="blue" style={{ marginLeft: 8 }}>本单有 {diffCount} 种不同交期</Tag>
        )}
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          pagination={false}
          dataSource={rows}
          scroll={{ y: 380 }}
          columns={[
            { title: '#', width: 44, render: (_: any, __: any, i: number) => i + 1 },
            {
              title: '产品 / 规格',
              render: (_: any, r: Row) => (
                <div>
                  <div>{r.product_name}</div>
                  {r.spec && <div style={{ color: '#8c8c8c', fontSize: 12 }}>{r.spec}</div>}
                </div>
              ),
            },
            {
              title: '数量', width: 90,
              render: (_: any, r: Row) => `${Number(r.qty).toLocaleString()} ${r.unit}`,
            },
            {
              title: '交期', width: 200,
              render: (_: any, r: Row, i: number) => (
                <Input
                  size="small"
                  placeholder="同整单"
                  value={r.lead_time}
                  onChange={(e) => upd(i, e.target.value)}
                />
              ),
            },
          ]}
        />
      </Modal>
    </>
  )
}
