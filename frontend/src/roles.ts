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

export const MODULES = [
  { key: 'dashboard', label: '工作台', path: '/dashboard' },
  { key: 'customers', label: '客户管理', path: '/customers' },
  { key: 'suppliers', label: '供应商管理', path: '/suppliers' },
  { key: 'inquiries', label: '询价管理', path: '/inquiries' },
  { key: 'quotes', label: '客户报价', path: '/quotes' },
  { key: 'orders', label: '订单履约', path: '/orders' },
  { key: 'short_video', label: '短视频矩阵', path: '/short-video' },
  { key: 'settings', label: '系统设置', path: '/settings' },
]
