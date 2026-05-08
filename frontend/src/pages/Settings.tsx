import { useEffect, useState } from 'react'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import { Switch, Input, InputNumber, Button, Space, Divider, message } from 'antd'
import { api } from '../api'

interface SettingItem {
  key: string
  value: string
  description: string
}

const TOGGLE_KEYS = new Set(['hide_supplier_brand_default'])
const NUMBER_KEYS = new Set(['default_markup_pct', 'default_quote_valid_days'])

export default function SettingsPage() {
  const [items, setItems] = useState<SettingItem[]>([])
  const load = async () => setItems((await api.get('listSettings')).items)
  useEffect(() => {
    load()
  }, [])

  const update = async (key: string, value: string) => {
    await api.post('updateSetting', { key, value })
    message.success('已保存')
    load()
  }

  return (
    <PageContainer title="系统设置">
      <ProCard title="对外报价" bordered headerBordered>
        {items
          .filter((i) =>
            ['hide_supplier_brand_default', 'company_name', 'default_quote_valid_days'].includes(i.key),
          )
          .map((i) => (
            <SettingRow key={i.key} item={i} onSave={update} />
          ))}
      </ProCard>
      <Divider />
      <ProCard title="加价 / 业务" bordered headerBordered>
        {items
          .filter((i) => i.key === 'default_markup_pct')
          .map((i) => (
            <SettingRow key={i.key} item={i} onSave={update} />
          ))}
      </ProCard>
    </PageContainer>
  )
}

function SettingRow({
  item,
  onSave,
}: {
  item: SettingItem
  onSave: (k: string, v: string) => void
}) {
  const [val, setVal] = useState<string>(item.value)
  useEffect(() => setVal(item.value), [item.value])

  let editor: React.ReactNode
  if (TOGGLE_KEYS.has(item.key)) {
    editor = (
      <Switch
        checked={val === 'true'}
        onChange={(v) => {
          const nv = v ? 'true' : 'false'
          setVal(nv)
          onSave(item.key, nv)
        }}
      />
    )
  } else if (NUMBER_KEYS.has(item.key)) {
    editor = (
      <Space>
        <InputNumber value={Number(val)} onChange={(v) => setVal(String(v ?? 0))} />
        <Button type="primary" onClick={() => onSave(item.key, val)}>
          保存
        </Button>
      </Space>
    )
  } else {
    editor = (
      <Space>
        <Input value={val} onChange={(e) => setVal(e.target.value)} style={{ width: 320 }} />
        <Button type="primary" onClick={() => onSave(item.key, val)}>
          保存
        </Button>
      </Space>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
      <div>
        <div style={{ fontWeight: 500 }}>{item.description || item.key}</div>
        <div style={{ color: '#999', fontSize: 12 }}>{item.key}</div>
      </div>
      {editor}
    </div>
  )
}
