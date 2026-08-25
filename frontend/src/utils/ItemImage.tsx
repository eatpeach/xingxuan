import { Image } from 'antd'
import { PictureOutlined } from '@ant-design/icons'

/**
 * 明细行的需求图缩略图（20260825）
 *
 * 图来自客户 Excel 里嵌的产品图。五金、管件光看名字和规格分不清，
 * 图才是最准的说明——所以商机详情、派单勾选、供应商填报页都要能看到，
 * 而且要能点开放大（缩略图上根本看不清型号）。
 */
export default function ItemImage({
  path,
  size = 40,
}: {
  /** storage 下的相对路径，如 inquiry_img/abc.png；空则显示占位 */
  path?: string
  size?: number
}) {
  if (!path) {
    return (
      <span
        title="这一行没有图片"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: 4,
          background: '#fafafa',
          border: '1px dashed #e8e8e8',
          color: '#d9d9d9',
        }}
      >
        <PictureOutlined />
      </span>
    )
  }
  const url = '/storage/' + String(path).replace(/^\/+/, '')
  return (
    <Image
      src={url}
      width={size}
      height={size}
      style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #f0f0f0' }}
      preview={{ src: url, mask: '看大图' }}
    />
  )
}

/** 一批明细里有几行带图 —— 用来决定要不要显示图片列，没图就别占位置 */
export function hasAnyImage(items: any[] | undefined): boolean {
  return !!items?.some((x) => (x?.image_path || '').trim() !== '')
}
