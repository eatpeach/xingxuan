import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal, Radio, Space, Spin, Table, Tag, Tooltip, message } from 'antd'
import { TranslationOutlined } from '@ant-design/icons'
import { api } from '../../api'
import { unitText } from '../printI18n'
import type { PrintLang } from '../printI18n'

/**
 * 品名译名对照表（20261113）
 * 建材五金有很多专属叫法，不能直译：先查术语表，查不到才让 AI 按印尼建材行业叫法翻，
 * 每一行都要人工核对确认，确认过的可以存进术语表，下次自动用。
 */

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  glossary: { color: 'green', text: '术语表' },
  confirmed: { color: 'blue', text: '已确认' },
  ai: { color: 'orange', text: 'AI · 待确认' },
  '': { color: 'default', text: '未翻译' },
}

export default function ItemTranslateModal({
  quoteId,
  lang: initLang,
  open,
  onClose,
  onConfirmed,
  lockLang = false,
  confirmText = '确认译名',
}: {
  quoteId: number
  lang: 'id' | 'en'
  open: boolean
  onClose: () => void
  onConfirmed?: () => void
  lockLang?: boolean
  confirmText?: string
}) {
  const [lang, setLang] = useState<'id' | 'en'>(initLang)
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [learn, setLearn] = useState(true)
  const nameCol = lang === 'en' ? 'name_en' : 'name_id'
  const specCol = lang === 'en' ? 'spec_en' : 'spec_id'
  const stCol = lang === 'en' ? 'trans_en_status' : 'trans_id_status'

  const run = async (force = false) => {
    setLoading(true)
    try {
      const r = await api.post('translateQuoteItems', { quote_id: quoteId, lang, force: force ? 1 : 0 })
      setRows(r.items || [])
    } catch {
      // 拦截器已提示（比如没配 AI）；退回只读现有译名
      const r = await api.get('getCustomerQuote', { id: quoteId }).catch(() => null)
      setRows(r?.data?.items || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) setLang(initLang)
  }, [open, initLang])
  useEffect(() => {
    if (open) run()
  }, [open, lang])

  const upd = (id: number, patch: any) => setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch, [stCol]: r[stCol] === 'glossary' ? 'glossary_edited' : r[stCol] } : r)))
  const pending = rows.filter((r) => !['glossary', 'confirmed'].includes(r[stCol])).length
  const lowConf = rows.filter((r) => r.ai_note).length

  const confirm = async () => {
    const empty = rows.find((r) => !String(r[nameCol] || '').trim())
    if (empty) return message.warning(`「${empty.product_name}」还没有译名`)
    setSaving(true)
    try {
      const r = await api.post('saveQuoteItemTranslations', {
        quote_id: quoteId,
        lang,
        learn: learn ? 1 : 0,
        items: rows.map((x) => ({ id: x.id, name: x[nameCol], spec: x[specCol] })),
      })
      message.success(`已确认 ${r.confirmed} 行译名${r.learned ? `，${r.learned} 条存进了术语表` : ''}`)
      onConfirmed?.()
      onClose()
    } catch {
      // 拦截器已提示
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`品名译名对照（${lang === 'en' ? 'English' : '印尼语'}）`}
      open={open}
      onCancel={onClose}
      width={1100}
      zIndex={10050}
      destroyOnClose
      footer={[
        <Checkbox key="learn" checked={learn} onChange={(e) => setLearn(e.target.checked)} style={{ float: 'left', marginTop: 6 }}>
          确认后把译名存进术语表，下次自动用
        </Checkbox>,
        <Button key="re" onClick={() => run(true)} disabled={loading}>
          AI 重新翻译未确认的行
        </Button>,
        <Button key="c" onClick={onClose}>取消</Button>,
        <Button key="ok" type="primary" loading={saving} disabled={loading} onClick={confirm}>
          {confirmText}
        </Button>,
      ]}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {!lockLang && (
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            options={[
              { label: '印尼语', value: 'id' },
              { label: 'English', value: 'en' },
            ]}
          />
        )}
        <Alert
          type={pending > 0 ? 'warning' : 'success'}
          showIcon
          message={
            pending > 0
              ? `${pending} 行是 AI 翻译的，请逐行核对（建材叫法不对就直接改），确认后才能用在单据上`
              : '所有行都有可用译名，核对无误点确认'
          }
          description={
            lowConf > 0 ? <span style={{ color: '#d46b08' }}>有 {lowConf} 行 AI 自己也不确定，已标出原因，请重点看。</span> : undefined
          }
        />
        <Spin spinning={loading} tip="正在查术语表 / AI 翻译…">
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            scroll={{ y: 420 }}
            dataSource={rows}
            columns={[
              { title: '#', width: 40, render: (_: any, __: any, i: number) => i + 1 },
              {
                title: '中文品名 / 规格',
                width: 240,
                render: (_: any, r: any) => (
                  <div>
                    <div>{r.product_name}</div>
                    {r.spec && <div style={{ fontSize: 12, color: '#999' }}>{r.spec}</div>}
                  </div>
                ),
              },
              {
                title: lang === 'en' ? 'English 品名' : '印尼语品名',
                render: (_: any, r: any) => (
                  <div>
                    <Input size="small" value={r[nameCol]} onChange={(e) => upd(r.id, { [nameCol]: e.target.value })} />
                    {r.ai_note && <div style={{ fontSize: 12, color: '#d46b08', marginTop: 2 }}>{r.ai_note}</div>}
                  </div>
                ),
              },
              {
                title: '规格',
                width: 200,
                render: (_: any, r: any) => <Input size="small" value={r[specCol]} onChange={(e) => upd(r.id, { [specCol]: e.target.value })} />,
              },
              {
                title: '单位',
                width: 80,
                render: (_: any, r: any) => (
                  <Tooltip title={`中文：${r.unit}`}>{unitText(r.unit, lang as PrintLang)}</Tooltip>
                ),
              },
              {
                title: '来源',
                width: 110,
                render: (_: any, r: any) => {
                  const t = STATUS_TAG[r[stCol]] || { color: 'purple', text: '已手改' }
                  return <Tag color={t.color}>{t.text}</Tag>
                },
              },
            ]}
          />
        </Spin>
      </Space>
    </Modal>
  )
}

/** 报价卡片上的「品名翻译」按钮 */
export function ItemTranslateButton({ quoteId, onDone }: { quoteId: number; onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button icon={<TranslationOutlined />} onClick={() => setOpen(true)}>
        品名翻译
      </Button>
      <ItemTranslateModal quoteId={quoteId} lang="id" open={open} onClose={() => setOpen(false)} onConfirmed={onDone} />
    </>
  )
}
