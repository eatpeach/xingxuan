import { useEffect, useState } from 'react'
import { Button, Modal, Select, Space, Tag, Typography, message } from 'antd'
import { UserSwitchOutlined } from '@ant-design/icons'
import { api } from '../api'

interface U { id: number; name: string; username: string; role: string; is_active: number }

/**
 * 客户归属指派（20260825）
 *
 * 销售只能看自己名下的客户，所以「这个客户归谁」必须能改，
 * 否则新招的销售登录进去是一片空白，老客户也没法转手。
 * 只有管理员能改归属，销售不能把别人的客户划到自己名下（后端也拦了）。
 */
export function useStaffOptions() {
  const [users, setUsers] = useState<U[]>([])
  useEffect(() => {
    api.get('listUsers').then((r) => setUsers(r.items || [])).catch(() => {})
  }, [])
  return users
}

/** 批量把选中的客户划给某个销售 */
export default function AssignOwnerButton({
  selectedIds,
  onDone,
}: {
  selectedIds: number[]
  onDone: () => void
}) {
  const users = useStaffOptions()
  const [open, setOpen] = useState(false)
  const [ownerId, setOwnerId] = useState<number | undefined>()
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (ownerId === undefined) {
      message.warning('请选择归属人')
      return
    }
    setSaving(true)
    try {
      // 没有批量接口，逐个更新即可 —— 一次划几十个客户不算频繁操作
      for (const id of selectedIds) {
        await api.post('updateCustomerOwner', { id, owner_id: ownerId })
      }
      message.success(`已把 ${selectedIds.length} 个客户划给指定销售`)
      setOpen(false)
      onDone()
    } catch (e: any) {
      message.error(e?.message || '指派失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        icon={<UserSwitchOutlined />}
        disabled={selectedIds.length === 0}
        onClick={() => setOpen(true)}
      >
        指派归属 {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
      </Button>
      <Modal
        open={open}
        title={`把 ${selectedIds.length} 个客户划给`}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okText="确认指派"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          销售登录后只看得到自己名下的客户，以及这些客户的商机、订单和看板数字。
        </Typography.Paragraph>
        <Select
          style={{ width: '100%' }}
          placeholder="选择归属人"
          value={ownerId}
          onChange={setOwnerId}
          options={[
            { value: 0, label: '不指派（只有管理员可见）' },
            ...users
              .filter((u) => Number(u.is_active) === 1)
              .map((u) => ({ value: u.id, label: `${u.name || u.username}（${u.username}）` })),
          ]}
        />
      </Modal>
    </>
  )
}

/** 列表里显示归属人 */
export function OwnerTag({ ownerId, users }: { ownerId: number; users: U[] }) {
  if (!ownerId) return <Tag color="default">未指派</Tag>
  const u = users.find((x) => x.id === Number(ownerId))
  return <Tag color="blue">{u ? u.name || u.username : `#${ownerId}`}</Tag>
}
