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
  ai: { color: 'cyan', text: 'AI 翻译' },
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
  const brandCol = lang === 'en' ? 'brand_en' : 'brand_id'
  const modelCol = lang === 'en' ? 'model_en' : 'model_id'
  const stCol = lang === 'en' ? 'trans_en_status' : 'trans_id_status'
  const langName = lang === 'en' ? '英文' : '印尼文'
  const HAN = /\p{Script=Han}/u
  // 有显示品牌 / 型号的行才需要翻品牌型号
  const hasBrand = rows.some((r) => Number(r.show_brand) && (String(r.brand_display || '').trim() || String(r.model_display || '').trim()))
  /** 这一行还有什么问题（确认前必须全部解决） */
  const rowProblem = (r: any): string => {
    if (!String(r[nameCol] || '').trim()) return `物品名还没翻`
    if (String(r.spec || '').trim() && !String(r[specCol] || '').trim()) return '规格还没翻'
    if (Number(r.show_brand) && String(r.brand_display || '').trim() && !String(r[brandCol] || '').trim()) return '品牌还没填'
    if (Number(r.show_brand) && String(r.model_display || '').trim() && !String(r[modelCol] || '').trim()) return '型号还没填'
    if (HAN.test([r[nameCol], r[specCol], r[brandCol], r[modelCol]].join(' '))) return `还有中文，必须全部是${langName}`
    return ''
  }

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
  const pending = rows.filter((r) => rowProblem(r)).length
  const lowConf = rows.filter((r) => r.ai_note).length

  const confirm = async () => {
    const bad = rows.find((r) => rowProblem(r))
    if (bad) return message.warning(`「${bad.product_name}」${rowProblem(bad)}`)
    setSaving(true)
    try {
      const r = await api.post('saveQuoteItemTranslations', {
        quote_id: quoteId,
        lang,
        learn: learn ? 1 : 0,
        items: rows.map((x) => ({ id: x.id, name: x[nameCol], spec: x[specCol], brand: x[brandCol], model: x[modelCol] })),
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
          AI 重新翻译未确认 / 有问题的行
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
              ? `${pending} 行还有中文或缺项（红框），请补成${langName}`
              : `已全部翻译成${langName}，可以直接用；想改哪个叫法直接改，保存后会记进术语表`
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
                    <Input size="small" value={r[nameCol]} status={!String(r[nameCol] || '').trim() || HAN.test(r[nameCol] || '') ? 'error' : undefined} onChange={(e) => upd(r.id, { [nameCol]: e.target.value })} />
                    {r.ai_note && <div style={{ fontSize: 12, color: '#d46b08', marginTop: 2 }}>{r.ai_note}</div>}
                    {rowProblem(r) && <div style={{ fontSize: 12, color: '#cf1322', marginTop: 2 }}>✗ {rowProblem(r)}</div>}
                  </div>
                ),
              },
              {
                title: `规格（${langName}）`,
                width: 220,
                render: (_: any, r: any) =>
                  String(r.spec || '').trim() || String(r[specCol] || '').trim() ? (
                    <Input
                      size="small"
                      value={r[specCol]}
                      status={String(r.spec || '').trim() && (!String(r[specCol] || '').trim() || HAN.test(r[specCol] || '')) ? 'error' : undefined}
                      onChange={(e) => upd(r.id, { [specCol]: e.target.value })}
                    />
                  ) : (
                    <span style={{ color: '#bbb' }}>无规格</span>
                  ),
              },
              ...(hasBrand
                ? [
                    {
                      title: `品牌 / 型号（${langName}）`,
                      width: 200,
                      render: (_: any, r: any) =>
                        Number(r.show_brand) && (String(r.brand_display || '').trim() || String(r.model_display || '').trim()) ? (
                          <Space direction="vertical" size={2} style={{ width: '100%' }}>
                            {String(r.brand_display || '').trim() && (
                              <Input size="small" addonBefore={r.brand_display} value={r[brandCol]} status={!String(r[brandCol] || '').trim() || HAN.test(r[brandCol] || '') ? 'error' : undefined} onChange={(e) => upd(r.id, { [brandCol]: e.target.value })} />
                            )}
                            {String(r.model_display || '').trim() && (
                              <Input size="small" addonBefore="型号" value={r[modelCol]} status={!String(r[modelCol] || '').trim() || HAN.test(r[modelCol] || '') ? 'error' : undefined} onChange={(e) => upd(r.id, { [modelCol]: e.target.value })} />
                            )}
                          </Space>
                        ) : (
                          <span style={{ color: '#bbb' }}>不显示</span>
                        ),
                    },
                  ]
                : []),
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
