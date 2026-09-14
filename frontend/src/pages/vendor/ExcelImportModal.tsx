import { useState } from 'react'
import { Alert, Button, Modal, Spin, Tag, Upload, message } from 'antd'
import type { UploadProps } from 'antd'
import { DownloadOutlined, FileExcelOutlined } from '@ant-design/icons'
import { api } from '../../api'

interface Props {
  open: boolean
  onClose: () => void
  onDone: () => void
}

// 与 scripts/gen_product_template.py 生成的收集表一致；模板放在 public/templates/，vite 原样拷进 dist
const TEMPLATE_URL = '/templates/product-template.xlsx'
const REQUIRED = ['品名', '品类', '供货价']
const OPTIONAL = ['品牌', '型号', '规格', '材质', '单位', '包装规格', '起订量', '现货', '交期', '产地', '重量', '认证/标准', '质保期', '运费说明', '图片链接', '描述']

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
        message="先下载收集表模板，填好再上传"
        description={
          <div style={{ fontSize: 13 }}>
            <div style={{ marginBottom: 10 }}>
              <Button
                type="primary"
                size="small"
                icon={<DownloadOutlined />}
                href={TEMPLATE_URL}
                download="供应商产品信息收集表.xlsx"
              >
                下载收集表模板
              </Button>
              <span style={{ marginLeft: 8, color: '#666' }}>模板带填写说明和示例行，中文 / 印尼文双语</span>
            </div>
            <div style={{ marginBottom: 4 }}>
              必填：
              {REQUIRED.map((h) => (
                <Tag key={h} color="red" style={{ marginBottom: 4 }}>{h}</Tag>
              ))}
            </div>
            <div>
              选填：
              {OPTIONAL.map((h) => (
                <Tag key={h} style={{ marginBottom: 4 }}>{h}</Tag>
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
