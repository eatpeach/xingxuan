import { useState } from 'react'
import { Button, Modal, Spin, Table, Tooltip, Upload, message } from 'antd'
import type { UploadProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CameraOutlined } from '@ant-design/icons'
import { api } from '../../api'
import type { ParsedItem } from './types'
import { formatPrice } from './types'

interface Props {
  open: boolean
  onClose: () => void
  onDone: () => void
}

// 拍照识别价格表：上传照片 → AI 解析（10-30 秒）→ 勾选导入
export default function AiParseModal({ open, onClose, onDone }: Props) {
  const [parsing, setParsing] = useState(false)
  const [items, setItems] = useState<ParsedItem[] | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [importing, setImporting] = useState(false)

  const reset = () => {
    setItems(null)
    setSelected([])
  }

  const handleClose = () => {
    if (parsing || importing) return
    reset()
    onClose()
  }

  const customRequest: UploadProps['customRequest'] = async ({ file }) => {
    setParsing(true)
    try {
      const fd = new FormData()
      fd.append('file', file as File)
      const r = await api.upload('vendorAiParseProducts', fd)
      const list: ParsedItem[] = r.items || []
      if (!list.length) {
        message.warning('未识别到商品，请换一张更清晰的照片')
        return
      }
      setItems(list)
      // 默认全选（价格为 0 的不可选，需手动改价后单独录入）
      setSelected(list.map((_, i) => i).filter((i) => Number(list[i].base_price) > 0))
    } catch {
      // api 拦截器已 toast
    } finally {
      setParsing(false)
    }
  }

  const doImport = async () => {
    if (!items || !selected.length) return
    setImporting(true)
    let ok = 0
    try {
      for (const i of selected) {
        const it = items[i]
        await api.post('vendorSaveProduct', {
          name: it.name,
          spec: it.spec,
          brand: it.brand,
          model: it.model,
          unit: it.unit || '件',
          base_price: it.base_price,
          category: it.category,
          lead_time: it.lead_time,
          description: it.remark,
          currency: 'IDR',
        })
        ok++
      }
      message.success(`已导入 ${ok} 条，等待平台审核`)
      reset()
      onDone()
      onClose()
    } catch {
      if (ok > 0) {
        message.warning(`部分导入成功：已导入 ${ok} 条，其余失败可重试`)
        onDone()
      }
    } finally {
      setImporting(false)
    }
  }

  const cols: ColumnsType<ParsedItem> = [
    { title: '品名', dataIndex: 'name', ellipsis: true },
    { title: '规格', dataIndex: 'spec', width: 110, ellipsis: true },
    {
      title: '底价',
      dataIndex: 'base_price',
      width: 120,
      render: (v: number) =>
        Number(v) > 0 ? (
          formatPrice(v, 'IDR')
        ) : (
          <Tooltip title="识别到的价格为 0，请导入后手动改价，或在原表修正后重拍">
            <span style={{ color: '#ff4d4f' }}>0（需手动改价）</span>
          </Tooltip>
        ),
    },
    { title: '单位', dataIndex: 'unit', width: 60 },
  ]

  return (
    <Modal
      title="拍照识别价格表"
      open={open}
      onCancel={handleClose}
      width={640}
      footer={
        items
          ? [
              <Button key="re" onClick={reset} disabled={importing}>
                重新上传
              </Button>,
              <Button
                key="ok"
                type="primary"
                loading={importing}
                disabled={!selected.length}
                onClick={doImport}
              >
                导入所选 {selected.length} 条
              </Button>,
            ]
          : null
      }
    >
      {!items && (
        <Spin spinning={parsing} tip="AI 识别中，约 10-30 秒，请勿关闭...">
          <Upload.Dragger
            accept="image/*"
            showUploadList={false}
            customRequest={customRequest}
            disabled={parsing}
          >
            <p style={{ fontSize: 36, color: 'var(--brand, #1d57e0)', margin: '8px 0' }}>
              <CameraOutlined />
            </p>
            <p style={{ fontSize: 15 }}>点击或拖入一张价格表 / 产品目录照片</p>
            <p style={{ fontSize: 12, color: '#98a1b3' }}>
              AI 自动识别品名、规格、价格等信息，识别后可勾选导入
            </p>
          </Upload.Dragger>
        </Spin>
      )}
      {items && (
        <>
          <div style={{ fontSize: 13, color: '#667085', marginBottom: 8 }}>
            共识别 {items.length} 条，价格为 0 的行需手动录入，不能勾选导入
          </div>
          <Table<ParsedItem>
            size="small"
            rowKey={(_, i) => String(i)}
            columns={cols}
            dataSource={items}
            pagination={false}
            scroll={{ y: 360, x: 480 }}
            rowSelection={{
              selectedRowKeys: selected.map(String),
              onChange: (keys) => setSelected(keys.map(Number)),
              getCheckboxProps: (r) => ({ disabled: Number(r.base_price) <= 0 }),
            }}
          />
        </>
      )}
    </Modal>
  )
}
