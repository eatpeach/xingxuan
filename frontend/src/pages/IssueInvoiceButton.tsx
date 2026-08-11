import { useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Button, Form, Modal, Select, Spin, message } from 'antd'
import { api } from '../api'

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

  const init = async () => {
    setOpen(true)
    setLoading(true)
    try {
      form.resetFields()
      setAccounts([])
      setEntityId(null)

      const [er, ar] = await Promise.all([
        api.get('listPaymentEntities', { only_active: 1 }),
        api.get('listPaymentAccounts', { only_active: 1 }),
      ])
      const eList: any[] = er.items || []
      const activeIds = new Set(eList.map((e: any) => Number(e.id)))
      // 启用账户里，只有所属主体也启用的才算「可选」——与后端兜底判断口径一致
      const selectable: any[] = (ar.items || []).filter((a: any) => activeIds.has(Number(a.entity_id)))

      setEntities(eList)
      setHasSelectable(selectable.length > 0)

      // 只有一个主体就自动选中，省一步
      const firstId = eList.length === 1 ? Number(eList[0].id) : null
      if (firstId) {
        setEntityId(firstId)
        form.setFieldsValue({ entity_id: firstId })
        pickAccounts(selectable, firstId)
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
  const doIssue = async (accountId?: number) => {
    setSubmitting(true)
    try {
      const r = await api.post('issueInvoice', {
        id: quoteId,
        ...(accountId ? { account_id: accountId } : {}),
      })
      message.success(`已开具发票 ${r.invoice_no}`)
      setOpen(false)
      onIssued()
      if (openAfterIssue) window.open(`/quotes/${quoteId}/invoice`, '_blank')
    } catch (e: any) {
      // 后端兜底拒绝要让操作者看得见，别静默（02、05 号单都踩过这个坑）
      message.error(e?.message || '开票失败')
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async () => {
    const v = await form.validateFields()
    await doIssue(Number(v.account_id))
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
                  name="account_id"
                  label="收款账户"
                  rules={[{ required: true, message: '请选择收款账户' }]}
                >
                  <Select
                    placeholder={entityId ? '选择收款账户' : '请先选择收款主体'}
                    disabled={!entityId}
                    notFoundContent="该主体下还没有启用的收款账户，请换一个主体或先去系统设置里添加"
                    options={accounts.map((a: any) => ({ label: accLabel(a), value: Number(a.id) }))}
                  />
                </Form.Item>
              </Form>
            </>
          )}
        </Spin>
      </Modal>
    </>
  )
}
