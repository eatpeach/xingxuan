import { useState } from 'react'
import { Alert, Modal, Spin, Tag, Upload, message } from 'antd'
import type { UploadProps } from 'antd'
import { FileExcelOutlined } from '@ant-design/icons'
import { api } from '../../api'

interface Props {
  open: boolean
  onClose: () => void
  onDone: () => void
}

const HEADERS = ['品名', '规格', '品牌', '型号', '单位', '底价', '品类', '现货', '交期', '起订量', '描述']

// Excel 批量导入商品（.xlsx，首行为表头）
export default function ExcelImportModal({ open, onClose, onDone }: Props) {
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)

  const handleClose = () => {
    if (uploading) return
    setResult(null)
    onClose()
  }

  const customRequest: UploadProps['customRequest'] = async ({ file }) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file as File)
      const r = await api.upload('vendorImportProductsExcel', fd)
      setResult({ imported: r.imported || 0, skipped: r.skipped || 0 })
      message.success(`导入完成：成功 ${r.imported || 0} 条`)
      onDone()
    } catch {
      // api 拦截器已 toast
    } finally {
      setUploading(false)
    }
  }

  return (
    <Modal title="Excel 导入商品" open={open} onCancel={handleClose} footer={null} width={560}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="文件要求"
        description={
          <div style={{ fontSize: 13 }}>
            <div style={{ marginBottom: 6 }}>.xlsx 文件，首行为表头，支持以下列（品名、底价必填）：</div>
            <div>
              {HEADERS.map((h) => (
                <Tag key={h} style={{ marginBottom: 4 }}>
                  {h}
                </Tag>
              ))}
            </div>
          </div>
        }
      />
      <Spin spinning={uploading} tip="导入中...">
        <Upload.Dragger accept=".xlsx" showUploadList={false} customRequest={customRequest} disabled={uploading}>
          <p style={{ fontSize: 36, color: '#52c41a', margin: '8px 0' }}>
            <FileExcelOutlined />
          </p>
          <p style={{ fontSize: 15 }}>点击或拖入 .xlsx 文件</p>
          <p style={{ fontSize: 12, color: '#98a1b3' }}>导入的商品将进入待审核状态</p>
        </Upload.Dragger>
      </Spin>
      {result && (
        <Alert
          type="success"
          showIcon
          style={{ marginTop: 12 }}
          message={`导入 ${result.imported} 条，跳过 ${result.skipped} 条（缺品名或底价）`}
        />
      )}
    </Modal>
  )
}
