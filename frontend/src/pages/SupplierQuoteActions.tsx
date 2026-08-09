import { useState } from 'react'
import { Checkbox, Modal, Popconfirm, Space, message } from 'antd'
import { api } from '../api'

/**
 * 供应商报价「采纳 / 作废」行内操作（20260810-13）
 *
 * 后端 `adoptSupplierQuote` / `voidSupplierQuote` 一直都在、路由也通，
 * 但**前端零调用**——所以「一询多供最终选了谁」这个动作在系统里从来没有留痕，
 * 所有供应商报价永远停在 `submitted`。这个组件补的就是那个入口。
 *
 * 抽成独立文件：`Inquiries.tsx` 已经一千多行，而且这块逻辑（连带标记、
 * 两个状态的可见性规则、作废的后果提示）独立成块更好改。
 */

/** 同一询价单下，会被「其余标为未采纳」影响到的报价 —— 与后端口径一致：不含自己、不含已作废 */
function affectedSiblings(quote: { id: number }, siblings: any[]): any[] {
  return (siblings || []).filter(
    (s) => Number(s.id) !== Number(quote.id) && ['submitted', 'adopted'].includes(String(s.status)),
  )
}

type Props = {
  /** 当前这条供应商报价 */
  quote: { id: number; status?: string | null; supplier_name?: string }
  /** 同一询价单下的全部供应商报价，用来算「其余 N 家」 */
  siblings: any[]
  /** 操作成功后刷新 */
  onDone: () => void
}

export default function SupplierQuoteActions({ quote, siblings, onDone }: Props) {
  const [busy, setBusy] = useState(false)
  const others = affectedSiblings(quote, siblings)
  // 默认勾选（CTO 裁决）：常规就是一询多供选一家，分单是少数情况，要分单就取消勾选
  const [rejectOthers, setRejectOthers] = useState(true)
  const [open, setOpen] = useState(false)

  const doAdopt = async () => {
    setBusy(true)
    try {
      const r = await api.post('adoptSupplierQuote', {
        id: quote.id,
        reject_others: rejectOthers && others.length > 0 ? 1 : 0,
      })
      const n = Number(r?.rejected || 0)
      message.success(n > 0 ? `已采纳，其余 ${n} 家标为未采纳` : '已采纳')
      setOpen(false)
      onDone()
    } catch (e: any) {
      // 后端拒绝要让操作者看得见，别静默（02/05/06 都踩过这个坑）
      message.error(e?.message || '采纳失败')
    } finally {
      setBusy(false)
    }
  }

  const doVoid = async () => {
    setBusy(true)
    try {
      await api.post('voidSupplierQuote', { id: quote.id })
      message.success('已作废')
      onDone()
    } catch (e: any) {
      message.error(e?.message || '作废失败')
    } finally {
      setBusy(false)
    }
  }

  // 可见性规则：已采纳的不再显示「采纳」，已作废的不再显示「作废」。
  // 其余状态两个都给——销售改主意是常事，rejected 也能再采纳回来。
  const canAdopt = quote.status !== 'adopted'
  const canVoid = quote.status !== 'void'

  return (
    <Space size={8}>
      {canAdopt && (
        <a
          onClick={() => {
            setRejectOthers(others.length > 0)
            setOpen(true)
          }}
        >
          采纳
        </a>
      )}
      {canVoid && (
        <Popconfirm
          title="作废这条供应商报价"
          // 作废的后果必须说清楚：compareInquiry 过滤掉 void，对比页真的看不见了
          description="作废后这条报价会从「对客报价」的对比页消失。若只是没选中，用「采纳其它家」并保留未采纳更合适。"
          okText="确认作废"
          cancelText="取消"
          onConfirm={doVoid}
          // AntD 层级 bug：Drawer 内的浮层要抬 zIndex（见 CLAUDE.md）
          zIndex={9999}
        >
          <a>作废</a>
        </Popconfirm>
      )}

      <Modal
        title="采纳这家的报价"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={doAdopt}
        okText="确认采纳"
        cancelText="取消"
        confirmLoading={busy}
        zIndex={9999}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>
          将采纳 <strong>{quote.supplier_name || '该供应商'}</strong> 的这条报价。
        </div>
        {others.length > 0 ? (
          <Checkbox checked={rejectOthers} onChange={(e) => setRejectOthers(e.target.checked)}>
            同时把其余 {others.length} 家标为「未采纳」
          </Checkbox>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>
            这张询价单下没有其它待处理的报价。
          </div>
        )}
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          「未采纳」只表示没中标，报价本身仍然有效，<strong>仍会留在对比页</strong>，随时可以改采纳它。
          要分单给多家就取消勾选。
        </div>
      </Modal>
    </Space>
  )
}
