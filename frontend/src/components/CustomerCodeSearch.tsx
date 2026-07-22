import { useRef, useState } from 'react'
import { AutoComplete } from 'antd'
import { api } from '../api'

// 群编号搜索框：输入联想（编号/客户名模糊匹配，选中回填编号）
export default function CustomerCodeSearch(props: any) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>()
  return (
    <AutoComplete
      {...props}
      allowClear
      options={options}
      placeholder="输入群编号联想"
      onSearch={(v: string) => {
        if (timer.current) clearTimeout(timer.current)
        if (!v.trim()) {
          setOptions([])
          return
        }
        timer.current = setTimeout(async () => {
          try {
            const r = await api.get('listCustomers', { keyword: v.trim(), page: 1, page_size: 10 })
            setOptions(
              (r.items || []).map((c: any) => ({
                value: String(c.code || c.id),
                label: `[${c.code || c.id}] ${c.short_name || c.name}`,
              })),
            )
          } catch {
            setOptions([])
          }
        }, 300)
      }}
    />
  )
}
