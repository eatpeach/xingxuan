import { useState } from 'react'
import { depositByDue, depositByNet, depositByPct, pctText } from '../utils/deposit'
import type { ReactNode } from 'react'
import { Alert, Button, Form, Input, InputNumber, Modal, Radio, Select, Space, Spin, message } from 'antd'
import { api } from '../api'
import { PAYMENT_CHANNEL_OPTIONS, normChannel } from './inquiry/DealTerms'
import { getPrintLang, setPrintLang, untranslatedCount } from './printI18n'
import ItemTranslateModal from './inquiry/ItemTranslate'
import type { PrintLang } from './printI18n'

/**
 * 开具发票按钮 + 选收款主体/账户弹窗（20260808-06）
 *
 * 原本这个组件长在 Quotes.tsx 里，而 Quotes.tsx 已经完全脱钩（无路由、无 import），
 * 于是唯一能走到的开票入口 Orders.tsx 从来不传 account_id，
 * 发票的 invoice_entity_* / invoice_bank_* 快照列全写空串。
 * 抽成独立文件是为了不把「Quotes.tsx 去留」这个未决事项绑死。
 *
 * 规则（CTO 2026-08-08 决策）：
 * - 系统里存在「启用主体下的启用账户」→ 必须选一个才能开票
 * - 一个可选账户都没有 → 允许按系统默认开（回落 system_settings），但要明确提示去配置
 * 后端 issueInvoice 有同样的兜底判断，两层都有，换个调用方也绕不过去。
 */

type Props = {
  /** customer_quotes.id */
  quoteId: number
  /** 开票成功后回调（刷新列表/详情） */
  onIssued: () => void
  /** 开票成功后是否新窗口打开发票打印页，默认 true */
  openAfterIssue?: boolean
  /** 渲染成文字链接而非主按钮（放进表格操作列时用） */
  asLink?: boolean
  children?: ReactNode
}

export default function IssueInvoiceButton({
  quoteId,
  onIssued,
  openAfterIssue = true,
  asLink = false,
  children,
}: Props) {
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [entities, setEntities] = useState<any[]>([])
  const [accounts, setAccounts] = useState<any[]>([])
  const [entityId, setEntityId] = useState<number | null>(null)
  /** 全系统是否存在可选账户（启用主体 + 启用账户），决定「必须选」还是「允许回落」 */
  const [hasSelectable, setHasSelectable] = useState(true)
  /** 报价单（总额 + 客户档案），用于开票金额基准和买方抬头预填 */
  const [quote, setQuote] = useState<any>(null)
  // 选了印尼语 / 英文，品名译名没确认完时先弹对照表，确认后再继续开票
  const [transGate, setTransGate] = useState<{ lang: 'id' | 'en'; go: () => void } | null>(null)

  const init = async () => {
    setOpen(true)
    setLoading(true)
    try {
      form.resetFields()
      setAccounts([])
      setEntityId(null)

      const [er, ar, qr] = await Promise.all([
        api.get('listPaymentEntities', { only_active: 1 }),
        api.get('listPaymentAccounts', { only_active: 1 }),
        api.get('getCustomerQuote', { id: quoteId }),
      ])
      // 报价单信息：拿总额做开票金额基准，拿客户档案预填买方抬头
      const q = qr.data || {}
      setQuote(q)
      form.setFieldsValue({
        // 只有重开「还有效的同一张发票」才沿用上次的开票金额；作废后重开 / 首次开票一律默认全额。
        // 原来无条件沿用 invoice_amount，改了明细后重开还是旧金额（20261113 事故）
        invoice_amount:
          q.invoice_no && Number(q.invoice_amount) > 0 && Number(q.invoice_amount) <= Number(q.total)
            ? Number(q.invoice_amount)
            : Number(q.total || 0),
        customer_name: q.invoice_customer_name || q.customer_company || q.customer_name || '',
        customer_tax_no: q.invoice_customer_tax_no || q.customer_tax_no || '',
        // 重开发票时带出上次选的 PPh，免得改个账户把 PPh 弄丢
        pph: Number(q.invoice_pph_rate || 0) > 0,
        // 收款渠道同理；老的「对私」按币种归到印尼盾 / 人民币私户（20261112）
        payment_channel: normChannel(q.payment_channel, q.currency) || 'company',
        // 发票语言：这张票上次选的 > 最近一次打印用的语言
        invoice_lang: (['cn', 'en', 'id'].includes(q.invoice_lang) ? q.invoice_lang : getPrintLang()) as PrintLang,
      })
      const eList: any[] = er.items || []
      const activeIds = new Set(eList.map((e: any) => Number(e.id)))
      // 启用账户里，只有所属主体也启用的才算「可选」——与后端兜底判断口径一致
      const selectable: any[] = (ar.items || []).filter((a: any) => activeIds.has(Number(a.entity_id)))

      setEntities(eList)
      setHasSelectable(selectable.length > 0)

      // 开单时已经选了收款账户（或上次开票用过的）→ 直接带出它所在的主体和账户
      const preAcc = Number(q.invoice_account_id || q.payment_account_id || 0)
      const pre = selectable.find((a: any) => Number(a.id) === preAcc)
      if (pre) {
        const eid = Number(pre.entity_id)
        setEntityId(eid)
        setAccounts(selectable.filter((a: any) => Number(a.entity_id) === eid))
        form.setFieldsValue({ entity_id: eid, account_id: Number(pre.id) })
      } else {
        // 只有一个主体就自动选中，省一步
        const firstId = eList.length === 1 ? Number(eList[0].id) : null
        if (firstId) {
          setEntityId(firstId)
          form.setFieldsValue({ entity_id: firstId })
          pickAccounts(selectable, firstId)
        }
      }
    } catch (e: any) {
      message.error(e?.message || '加载收款主体失败')
    } finally {
      setLoading(false)
    }
  }

  /** 从已拉到的可选账户里筛出某主体的，并默认选中 */
  const pickAccounts = (all: any[], eid: number) => {
    const list = all.filter((a: any) => Number(a.entity_id) === eid)
    setAccounts(list)
    const def = list.find((a: any) => a.is_default) || list[0]
    form.setFieldsValue({ account_id: def ? Number(def.id) : undefined })
  }

  const onEntityChange = async (v: any) => {
    const eid = Number(v)
    setEntityId(eid)
    form.setFieldsValue({ account_id: undefined })
    try {
      const r = await api.get('listPaymentAccounts', { entity_id: eid, only_active: 1 })
      pickAccounts(r.items || [], eid)
    } catch (e: any) {
      setAccounts([])
      message.error(e?.message || '加载收款账户失败')
    }
  }

  /** accountId 为 undefined = 无可选账户时的回落开票 */
  const doIssue = async (accountId?: number, extra?: Record<string, any>) => {
    setSubmitting(true)
    try {
      const r = await api.post('issueInvoice', {
        id: quoteId,
        ...(accountId ? { account_id: accountId } : {}),
        ...(extra || {}),
      })
      // 后端对已开票单不换号，只更新主体/银行快照，提示要说清楚免得以为出了新号
      message.success(r.already_issued ? `已更新发票 ${r.invoice_no} 的收款信息（发票号不变）` : `已开具发票 ${r.invoice_no}`)
      setOpen(false)
      onIssued()
      const lang = (extra?.invoice_lang || form.getFieldValue('invoice_lang') || getPrintLang()) as PrintLang
      setPrintLang(lang)
      if (openAfterIssue) window.open(`/quotes/${quoteId}/invoice?lang=${lang}`, '_blank')
    } catch (e: any) {
      // 后端兜底拒绝要让操作者看得见，别静默（02、05 号单都踩过这个坑）
      message.error(e?.message || '开票失败')
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async () => {
    const v = await form.validateFields()
    // 印尼语 / 英文发票：品名必须用确认过的行业译名，不能直译、也不能留中文
    if (v.invoice_lang === 'id' || v.invoice_lang === 'en') {
      let qr = await api.get('getCustomerQuote', { id: quoteId })
      if (untranslatedCount(qr.data?.items || [], v.invoice_lang) > 0) {
        // 先自动翻译（物品名 / 规格 / 单位 / 品牌型号），翻完还有中文才弹对照表
        await api.post('translateQuoteItems', { quote_id: quoteId, lang: v.invoice_lang }).catch(() => null)
        qr = await api.get('getCustomerQuote', { id: quoteId })
      }
      if (untranslatedCount(qr.data?.items || [], v.invoice_lang) > 0) {
        setTransGate({ lang: v.invoice_lang, go: () => submitAfterTranslate(v) })
        return
      }
    }
    await submitAfterTranslate(v)
  }

  const submitAfterTranslate = async (v: any) => {
    const total = Number(quote?.total || 0)
    const amt = Number(v.invoice_amount || 0)
    const hasTaxC = Number(quote?.tax_rate || 0) > 0 && !Number(quote?.tax_included || 0)
    const dc = depositByNet(total, amt, Number(quote?.tax_rate || 0), !!Number(quote?.tax_included || 0), quote?.currency)
    // 部分开票必须明确确认，不能一路点确定就开出半价发票
    if (total > 0 && amt < total - 0.005) {
      const ok = await new Promise<boolean>((resolve) =>
        Modal.confirm({
          title: `这次只收 ${pctText(dc.pct)}，确认吗？`,
          zIndex: 10000,
          content: (
            <div>
              订单总金额（{hasTaxC ? '含 PPN' : '不涉税'}）<b>{dc.grossTotal.toLocaleString()}</b>，这次只收{' '}
              <b style={{ color: '#cf1322' }}>{dc.due.toLocaleString()}</b>（{pctText(dc.pct)}），余款 {dc.remaining.toLocaleString()} 之后再收。
              <br />
              只有收定金、分期收款时才这样开。要开全款，请点「取消」后选「全款」。
            </div>
          ),
          okText: '确认，按定金开',
          cancelText: '取消',
          okButtonProps: { danger: true },
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        }),
      )
      if (!ok) return
    }
    await doIssue(v.payment_channel === 'factory' ? undefined : Number(v.account_id), {
      confirm_partial: total > 0 && amt < total - 0.005 ? 1 : 0,
      invoice_lang: v.invoice_lang || 'cn',
      payment_channel: v.payment_channel || '',
      pph_rate: v.pph ? 0.02 : 0,
      invoice_amount: Number(v.invoice_amount || 0),
      customer_name: v.customer_name || '',
      customer_tax_no: v.customer_tax_no || '',
    })
  }

  const accLabel = (a: any) =>
    [a.bank_name, a.account_number, a.account_name && `(${a.account_name})`, a.currency]
      .filter(Boolean)
      .join(' · ')

  const noEntity = entities.length === 0
  const fallbackMode = !loading && !hasSelectable

  return (
    <>
      {asLink ? (
        // 表格操作列里用文字链接形态（商机「收款」步骤的订单行）
        <a onClick={init}>{children ?? '开具发票'}</a>
      ) : (
        <Button type="primary" onClick={init}>
          {children ?? '开具发票'}
        </Button>
      )}
      <Modal
        title="开具发票 — 选择收款主体与账户"
        open={open}
        onCancel={() => setOpen(false)}
        okText={fallbackMode ? '仍然开票（用系统默认抬头）' : '确认开票'}
        cancelText="取消"
        confirmLoading={submitting}
        // AntD 层级 bug：Drawer 内的 Modal 必须抬 zIndex，否则被 Drawer 盖住
        zIndex={9999}
        destroyOnClose
        width={560}
        okButtonProps={fallbackMode ? { danger: true } : { disabled: loading }}
        onOk={fallbackMode ? () => doIssue() : submit}
      >
        <Spin spinning={loading}>
          {fallbackMode ? (
            <Alert
              type="warning"
              showIcon
              message={noEntity ? '还没有配置收款主体' : '现有收款主体下没有启用的收款账户'}
              description={
                <>
                  现在开票只能回落到系统默认抬头和银行信息，
                  发票上的公司抬头 / NPWP / 地址 / 银行账户可能不完整。
                  <br />
                  建议先到「系统设置 → 收款主体 / 账户」配置好，再来开票。
                </>
              }
            />
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 16 }}>
                主体信息（公司名 / 税号 / 地址 / Logo）和所选账户会快照进这张发票，之后再改设置不影响已开的票。
              </div>
              <Form form={form} layout="vertical">
                <Form.Item name="invoice_lang" label="发票语言" initialValue="cn" extra="打开的发票就是这种语言；打印页右上角也还能临时切换">
                  <Radio.Group
                    optionType="button"
                    buttonStyle="solid"
                    options={[
                      { label: '中文', value: 'cn' },
                      { label: 'English', value: 'en' },
                      { label: 'Bahasa Indonesia', value: 'id' },
                    ]}
                  />
                </Form.Item>

                <Form.Item
                  name="payment_channel"
                  label="付款方式"
                  initialValue="company"
                  rules={[{ required: true, message: '请选择收款渠道' }]}
                  extra="选「客户直付工厂」时，发票上不会印我们的收款账号"
                >
                  <Radio.Group optionType="button" buttonStyle="solid" options={PAYMENT_CHANNEL_OPTIONS} />
                </Form.Item>

                <Form.Item noStyle shouldUpdate={(a, b) => a.payment_channel !== b.payment_channel}>
                  {({ getFieldValue }) => getFieldValue('payment_channel') === 'factory' ? (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 16 }}
                      message="这笔钱不经我们的账户"
                      description="发票照常开（抬头还是我们），但不会印收款账号 —— 印了客户很可能真打过来，就变成我们代收，还得再退给工厂。"
                    />
                  ) : null}
                </Form.Item>

                <Form.Item
                  name="entity_id"
                  label="收款主体"
                  rules={[{ required: true, message: '请选择收款主体' }]}
                >
                  <Select
                    placeholder="选择开票抬头"
                    options={entities.map((e: any) => ({ label: e.name, value: Number(e.id) }))}
                    onChange={onEntityChange}
                  />
                </Form.Item>
                <Form.Item
                  noStyle
                  shouldUpdate={(a, b) => a.payment_channel !== b.payment_channel}
                >
                  {({ getFieldValue }) => {
                    const toFactory = getFieldValue('payment_channel') === 'factory'
                    return (
                <Form.Item
                  name="account_id"
                  label="收款账户"
                  rules={toFactory ? [] : [{ required: true, message: '请选择收款账户' }]}
                  hidden={toFactory}
                >
                  <Select
                    placeholder={entityId ? '选择收款账户' : '请先选择收款主体'}
                    disabled={!entityId}
                    notFoundContent="该主体下还没有启用的收款账户，请换一个主体或先去系统设置里添加"
                    options={accounts.map((a: any) => ({ label: accLabel(a), value: Number(a.id) }))}
                  />
                </Form.Item>
                    )
                  }}
                </Form.Item>

                {/* PPh 23：客户从货款里代扣 2% 替我们缴税，实付会少这一截 */}
                <Form.Item
                  name="pph"
                  label="PPh 预扣税"
                  initialValue={false}
                  extra="选「扣 2%」时，发票上会多一行 PPh 23 (2%)，并写明客户实际应付金额（按不含 PPN 的金额计算）"
                >
                  <Radio.Group optionType="button" buttonStyle="solid">
                    <Radio.Button value={false}>不扣</Radio.Button>
                    <Radio.Button value={true}>扣 PPh 2%</Radio.Button>
                  </Radio.Group>
                </Form.Item>

                {/* 买方抬头：预填客户档案，可当场改（客户常要求用某个公司主体开票） */}
                <Form.Item
                  name="customer_name"
                  label="客户抬头（买方）"
                  rules={[{ required: true, message: '请填写客户抬头' }]}
                >
                  <Input placeholder="开给哪个公司主体，如 PT Maju Jaya" />
                </Form.Item>
                <Form.Item name="customer_tax_no" label="客户税号 NPWP（选填）">
                  <Input placeholder="印尼客户报销 / 抵扣要用" />
                </Form.Item>

                {/* 收款比例（20261125 重做）：选比例，金额全部自动换算；先给整单总金额，再给这次要付多少 */}
                <Form.Item name="invoice_amount" hidden rules={[{ required: true }]}>
                  <InputNumber />
                </Form.Item>
                <Form.Item noStyle shouldUpdate={(x, y) => x.invoice_amount !== y.invoice_amount}>
                  {({ getFieldValue }) => {
                    if (!quote) return null
                    const cur = quote.currency
                    const sym = cur === 'CNY' ? '¥' : 'Rp'
                    const m = (n: number) => `${sym} ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: cur === 'CNY' ? 2 : 0 })}`
                    const netTotal = Number(quote.total || 0)
                    const rate = Number(quote.tax_rate || 0)
                    const inc = !!Number(quote.tax_included || 0)
                    const c = depositByNet(netTotal, Number(getFieldValue('invoice_amount') ?? netTotal), rate, inc, cur)
                    const hasTax = rate > 0 && !inc
                    const partial = c.net < netTotal - 0.005
                    const setPct = (p: number) => form.setFieldsValue({ invoice_amount: depositByPct(netTotal, p, rate, inc, cur).net })
                    const row = (label: any, val: any, strong = false) => (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontWeight: strong ? 700 : 400 }}>
                        <span>{label}</span>
                        <span>{val}</span>
                      </div>
                    )
                    return (
                      <Form.Item label="收款金额" required style={{ marginBottom: 12 }}>
                        <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                          {hasTax && row('货款（不含 PPN）', m(c.netTotal))}
                          {hasTax && row(`PPN ${+(rate * 100).toFixed(2)}%`, m(c.taxTotal))}
                          {row(hasTax ? '订单总金额（含 PPN）' : '订单总金额', m(c.grossTotal), true)}
                        </div>
                        <Space size={8} wrap style={{ marginBottom: 10 }}>
                          <span>本次收</span>
                          {[100, 50, 30].map((p) => (
                            <Button key={p} size="small" type={Math.abs(c.pct - p) < 0.005 ? 'primary' : 'default'} onClick={() => setPct(p)}>
                              {p === 100 ? '全款' : `${p}%`}
                            </Button>
                          ))}
                          <InputNumber
                            size="small"
                            style={{ width: 120 }}
                            min={0.1}
                            max={100}
                            addonAfter="%"
                            placeholder="自定义"
                            value={Math.round(c.pct * 100) / 100}
                            onChange={(v) => v != null && setPct(Number(v))}
                          />
                          <span style={{ color: '#8c8c8c' }}>或直接填金额</span>
                          <InputNumber
                            size="small"
                            style={{ width: 170 }}
                            min={0}
                            max={c.grossTotal}
                            placeholder={hasTax ? '本次应付（含 PPN）' : '本次应付'}
                            value={c.due}
                            formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                            parser={(v) => Number(String(v).replace(/,/g, '')) as any}
                            onChange={(v) => v != null && form.setFieldsValue({ invoice_amount: depositByDue(netTotal, Number(v), rate, inc, cur).net })}
                          />
                        </Space>
                        <div style={{ background: partial ? '#fff7e6' : '#f6ffed', border: `1px solid ${partial ? '#ffd591' : '#b7eb8f'}`, borderRadius: 8, padding: '10px 12px' }}>
                          {row(
                            <span>{partial ? `本次应付（定金 ${pctText(c.pct)}）` : '本次应付（全款）'}</span>,
                            <span style={{ fontSize: 18, color: partial ? '#d46b08' : '#389e0d' }}>{m(c.due)}</span>,
                            true,
                          )}
                          {hasTax && (
                            <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                              其中货款 {m(c.net)} + PPN {m(c.tax)}
                            </div>
                          )}
                          {partial && row('余款（之后再收）', m(c.remaining))}
                        </div>
                      </Form.Item>
                    )
                  }}
                </Form.Item>
              </Form>
            </>
          )}
        </Spin>
      </Modal>
      {transGate && (
        <ItemTranslateModal
          quoteId={quoteId}
          lang={transGate.lang}
          lockLang
          open
          confirmText="确认译名并开票"
          onClose={() => setTransGate(null)}
          onConfirmed={() => {
            const go = transGate.go
            setTransGate(null)
            go()
          }}
        />
      )}
    </>
  )
}
