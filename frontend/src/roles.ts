// 角色与模块定义（账户管理 / 权限矩阵 / 菜单过滤共用）
export const ROLE_OPTIONS = [
  { value: 'admin', label: '管理员' },
  { value: 'sales', label: '销售' },
  { value: 'ops', label: '运营' },
  { value: 'finance', label: '财务' },
  { value: 'legal', label: '法务' },
]

export const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label]),
)

// 客户报价 / 订单履约已并入商机步骤，无独立路由，故不再作为可授权模块
export const MODULES = [
  { key: 'dashboard', label: '工作台', path: '/dashboard' },
  { key: 'customers', label: '客户管理', path: '/customers' },
  { key: 'inquiries', label: '商机管理', path: '/inquiries' },
  { key: 'suppliers', label: '供应商管理', path: '/suppliers' },
  { key: 'products', label: '商品库', path: '/products' },
  { key: 'channels', label: '渠道管理', path: '/channels' },
  { key: 'short_video', label: '短视频矩阵', path: '/short-video' },
  { key: 'settings', label: '系统设置', path: '/settings' },
]
