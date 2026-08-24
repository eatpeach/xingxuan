import { useState } from 'react'
import { Alert, Button, Descriptions, Modal, Popconfirm, Space, Tag, Typography, message } from 'antd'
import { EyeOutlined, CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import { copyText } from '../utils/copyText'

interface Cred {
  supplier_id: number
  code: string
  name: string
  contact: string
  phone: string
  username: string
  password: string
  has_account: number
  portal_enabled: number
  self_changed: number
  must_change_pwd: number
  last_login_at: string
  locked: number
  fail_count: number
}

/**
 * 查看/重置供应商门户账号密码
 *
 * 能给的只有【系统下发的那个密码】。供应商自己改过之后，库里存的是 bcrypt，
 * 不可逆——这不是权限问题，是算不出来。那种情况唯一正确的帮法是重置下发新密码。
 */
export default function SupplierCredential({
  record,
  onOk,
}: {
  record: { id: number; name: string; username?: string }
  onOk?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Cred | null>(null)
  const [loading, setLoading] = useState(false)
  const [justReset, setJustReset] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('getSupplierCredential', { supplier_id: record.id })
      setData(r)
    } catch (e: any) {
      message.error(e?.message || '读取失败')
    } finally {
      setLoading(false)
    }
  }

  const openModal = () => {
    setOpen(true)
    setJustReset(false)
    setData(null)
    load()
  }

  const reset = async () => {
    setLoading(true)
    try {
      const r = await api.post('resetSupplierPassword', { supplier_id: record.id })
      setData((d) => (d ? { ...d, password: r.password, self_changed: 0, must_change_pwd: 1 } : d))
      setJustReset(true)
      message.success('已重置，把下面的新密码发给供应商')
      onOk?.()
    } catch (e: any) {
      message.error(e?.message || '重置失败')
    } finally {
      setLoading(false)
    }
  }

  const unlock = async () => {
    setLoading(true)
    try {
      await api.post('unlockSupplierLogin', { supplier_id: record.id })
      message.success('已解除锁定，可以让他立刻再登一次')
      await load()
    } catch (e: any) {
      message.error(e?.message || '解锁失败')
    } finally {
      setLoading(false)
    }
  }

  const portalUrl = `${window.location.origin}/vendor`
  const msgText = data
    ? `${data.name}\n登录地址：${portalUrl}\n账号：${data.username}\n密码：${data.password}\n（首次登录会让你改密码）`
    : ''

  return (
    <>
      <a onClick={openModal}>账号密码</a>
      <Modal
        open={open}
        title={`门户账号密码 · ${record.name}`}
        onCancel={() => setOpen(false)}
        footer={<Button type="primary" onClick={() => setOpen(false)}>关闭</Button>}
        width={600}
        zIndex={9999}
      >
        {!data ? (
          <div style={{ color: '#8c8c8c' }}>{loading ? '读取中…' : '—'}</div>
        ) : !data.has_account ? (
          <Alert
            type="info"
            showIcon
            message="这家还没有门户账号"
            description="用列表上方的「批量生成门户账号」，或在「门户账号」里手动开通。"
          />
        ) : (
          <>
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 14 }}>
              <Descriptions.Item label="登录地址">
                <Typography.Text copyable>{portalUrl}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="账号">
                <Typography.Text copyable strong style={{ fontSize: 15 }}>{data.username}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="密码">
                {data.password ? (
                  <Space>
                    <Typography.Text
                      copyable
                      strong
                      style={{ fontSize: 17, letterSpacing: 1, color: '#1d57e0' }}
                    >
                      {data.password}
                    </Typography.Text>
                    {justReset && <Tag color="green">刚重置</Tag>}
                    {!justReset && Number(data.must_change_pwd) === 1 && (
                      <Tag color="orange">供应商还没登录改过</Tag>
                    )}
                  </Space>
                ) : (
                  <Tag color="default">供应商已自行改密，看不到</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="上次登录">
                {data.last_login_at || <span style={{ color: '#bfbfbf' }}>还没登录过</span>}
              </Descriptions.Item>
            </Descriptions>

            {Number(data.locked) === 1 && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 14 }}
                message="这个账号正被锁定中（连续输错太多次）"
                description={
                  <Space>
                    <span>密码没问题的话，直接解锁就能登。</span>
                    <Button size="small" danger loading={loading} onClick={unlock}>解除锁定</Button>
                  </Space>
                }
              />
            )}

            {Number(data.self_changed) === 1 && !justReset && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 14 }}
                message="这家供应商已经自己改过密码了"
                description={
                  <span>
                    改密后系统只保留加密值，<strong>算不回原文</strong>——这不是权限问题。
                    他忘了就点下面「重置密码」，会现场生成一个新密码给你，
                    他用新密码登录后再自己改掉。
                  </span>
                }
              />
            )}

            <Space wrap>
              <Button
                icon={<CopyOutlined />}
                disabled={!data.password}
                onClick={() =>
                  copyText(msgText).then(() => message.success('已复制，可以直接粘给供应商'))
                }
              >
                复制发送文案
              </Button>
              <Popconfirm
                title="重置这家的门户密码？"
                description="旧密码立即失效，需要把新密码告诉供应商。"
                onConfirm={reset}
              >
                <Button danger icon={<ReloadOutlined />} loading={loading}>重置密码</Button>
              </Popconfirm>
              <Button icon={<EyeOutlined />} onClick={load} loading={loading}>刷新</Button>
            </Space>
          </>
        )}
      </Modal>
    </>
  )
}
