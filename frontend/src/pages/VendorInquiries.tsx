import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Modal, Spin, Table, Tabs, Tag, Typography, message } from 'antd'
import { FileSearchOutlined, EditOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { api } from '../api'

interface InqRow {
  dispatch_id: number
  inquiry_no: string
  title: string
  item_count: number
  deadline: string
  overdue: number
  dispatched_at: string
  responded_at: string
  status: string
  currency: string
  link: string
  link_expired: number
  quote_no: string | null
  quoted_total: number | null
  quote_status: string | null
  valid_until: string | null
}

const sym = (c: string) => (c === 'CNY' ? '¥' : 'Rp')
const money = (c: string, n: number) => `${sym(c)} ${Math.round(n).toLocaleString()}`

const QUOTE_STATUS: Record<string, { color: string; text: string }> = {
  submitted: { color: 'blue', text: '已提交，等平台确认' },
  adopted: { color: 'green', text: '已采纳' },
  rejected: { color: 'default', text: '未采纳' },
}

/**
 * 供应商门户 · 我的询价
 *
 * 以前供应商只能靠销售发来的那条 token 链接进报价页，链接一丢就找不回来，
 * 也没法回看自己报过什么价。这里把入口和历史都收进门户。
 *
 * 填报仍然跳原来那条 token 链接——报价页逻辑一份不用改，这里只是帮他找回入口。
 */
export default function VendorInquiries() {
  const [tab, setTab] = useState('todo')
  const [rows, setRows] = useState<InqRow[]>([])
  const [stats, setStats] = useState({ todo: 0, responded: 0, urgent: 0 })
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<any>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const load = async (status: string) => {
    setLoading(true)
    try {
      const [r, s] = await Promise.all([
        api.get('vendorListInquiries', { status }),
        api.get('vendorInquiryStats'),
      ])
      setRows(r.items || [])
      setStats({ todo: s.todo || 0, responded: s.responded || 0, urgent: s.urgent || 0 })
    } catch {
      /* 拦截器已提示 */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(tab)
  }, [tab])

  const openDetail = async (r: InqRow) => {
    setDetailOpen(true)
    setDetail(null)
    try {
      const d = await api.get('vendorGetInquiry', { dispatch_id: r.dispatch_id })
      setDetail(d)
    } catch (e: any) {
      message.error(e?.message || '打开失败')
      setDetailOpen(false)
    }
  }

  const goQuote = (link: string, expired: number) => {
    if (expired || !link) {
      message.warning('这条报价链接已过期，请联系星选建材重新发一条')
      return
    }
    window.open(link, '_blank')
  }

  const columns = [
    {
      title: '询价单',
      render: (_: any, r: InqRow) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.title || r.inquiry_no}</div>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>
            {r.inquiry_no} · 派给你 {r.item_count} 项 · {String(r.dispatched_at || '').slice(0, 10)}
          </div>
        </div>
      ),
    },
    {
      title: '截止',
      width: 130,
      render: (_: any, r: InqRow) =>
        r.deadline ? (
          <span style={{ color: r.overdue ? '#f5222d' : undefined }}>
            {r.overdue && <ClockCircleOutlined style={{ marginRight: 4 }} />}
            {r.deadline}
            {r.overdue ? ' 已过' : ''}
          </span>
        ) : (
          <span style={{ color: '#bfbfbf' }}>不限</span>
        ),
    },
    {
      title: '我的报价',
      width: 200,
      render: (_: any, r: InqRow) =>
        r.quoted_total != null ? (
          <div>
            <div style={{ fontWeight: 600 }}>{money(r.currency, r.quoted_total)}</div>
            <Tag color={QUOTE_STATUS[r.quote_status || 'submitted']?.color}>
              {QUOTE_STATUS[r.quote_status || 'submitted']?.text}
            </Tag>
          </div>
        ) : (
          <Tag color="orange">还没报价</Tag>
        ),
    },
    {
      title: '',
      width: 170,
      render: (_: any, r: InqRow) => (
        <>
          <a onClick={() => openDetail(r)}>看明细</a>
          <a style={{ marginLeft: 12 }} onClick={() => goQuote(r.link, r.link_expired)}>
            {r.quoted_total != null ? '改报价' : '去报价'}
          </a>
        </>
      ),
    },
  ]

  return (
    <div className="vp-panel" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <FileSearchOutlined style={{ color: '#1d57e0' }} />
        <span style={{ fontWeight: 600, fontSize: 15 }}>我的询价</span>
        {stats.todo > 0 && <Tag color="orange">{stats.todo} 个待报价</Tag>}
      </div>

      {stats.urgent > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 10 }}
          message={`有 ${stats.urgent} 个询价 3 天内截止，尽快报价`}
        />
      )}

      <Tabs
        activeKey={tab}
        onChange={setTab}
        size="small"
        tabBarStyle={{ marginBottom: 8 }}
        items={[
          { key: 'todo', label: `待报价 ${stats.todo ? `(${stats.todo})` : ''}` },
          { key: 'responded', label: `已报价 ${stats.responded ? `(${stats.responded})` : ''}` },
          { key: 'all', label: '全部' },
        ]}
      />

      <Spin spinning={loading}>
        {rows.length === 0 && !loading ? (
          <Empty
            description={tab === 'todo' ? '目前没有待你报价的询价单' : '还没有记录'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Table<InqRow>
            rowKey="dispatch_id"
            size="small"
            pagination={rows.length > 10 ? { pageSize: 10, size: 'small' } : false}
            dataSource={rows}
            columns={columns as any}
            scroll={{ x: 'max-content' }}
          />
        )}
      </Spin>

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        width={860}
        title={detail ? `${detail.title || detail.inquiry_no} · ${detail.inquiry_no}` : '加载中'}
        footer={
          detail ? (
            <>
              <Button onClick={() => setDetailOpen(false)}>关闭</Button>
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={() => goQuote(detail.link, detail.link_expired)}
              >
                {detail.quote ? '修改报价' : '去报价'}
              </Button>
            </>
          ) : null
        }
      >
        {!detail ? (
          <Spin />
        ) : (
          <>
            <div style={{ marginBottom: 12, color: '#8c8c8c', fontSize: 13 }}>
              币种 {detail.currency}
              {Number(detail.tax_included) ? ' · 含税' : ' · 不含税'}
              {detail.tax_rate ? ` ${(detail.tax_rate * 100).toFixed(0)}%` : ''}
              {detail.deadline ? ` · 截止 ${detail.deadline}` : ''}
            </div>
            {detail.remark && (
              <Alert type="info" style={{ marginBottom: 12 }} message={`需求备注：${detail.remark}`} />
            )}
            {detail.quote && (
              <div style={{ marginBottom: 12 }}>
                <Typography.Text>
                  我的报价单 <strong>{detail.quote.no}</strong>，合计{' '}
                  <strong style={{ color: '#1d57e0' }}>
                    {money(detail.currency, detail.quote.total)}
                  </strong>
                </Typography.Text>
                <Tag style={{ marginLeft: 8 }} color={QUOTE_STATUS[detail.quote.status]?.color}>
                  {QUOTE_STATUS[detail.quote.status]?.text}
                </Tag>
              </div>
            )}
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.items || []}
              scroll={{ x: 'max-content', y: 400 }}
              columns={[
                { title: '#', width: 44, render: (_: any, __: any, i: number) => i + 1 },
                {
                  title: '产品 / 规格',
                  render: (_: any, r: any) => (
                    <div>
                      <div>{r.product_name}</div>
                      {r.spec && <div style={{ color: '#8c8c8c', fontSize: 12 }}>{r.spec}</div>}
                    </div>
                  ),
                },
                {
                  title: '需求量',
                  width: 100,
                  render: (_: any, r: any) => `${Number(r.qty).toLocaleString()} ${r.unit}`,
                },
                {
                  title: '我报的单价',
                  width: 140,
                  render: (_: any, r: any) =>
                    r.my_price != null ? (
                      <strong>{money(detail.currency, r.my_price)}</strong>
                    ) : (
                      <span style={{ color: '#bfbfbf' }}>未报</span>
                    ),
                },
                {
                  title: '品牌 / 型号',
                  width: 150,
                  render: (_: any, r: any) =>
                    [r.my_brand, r.my_model].filter(Boolean).join(' / ') || (
                      <span style={{ color: '#bfbfbf' }}>—</span>
                    ),
                },
                {
                  title: '货期',
                  width: 100,
                  render: (_: any, r: any) => r.my_lead_time || <span style={{ color: '#bfbfbf' }}>—</span>,
                },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  )
}
