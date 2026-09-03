import { useState } from 'react'
import { Alert, Button, Input, Modal, Radio, Space, Table, Typography, message } from 'antd'
import { UsergroupAddOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import { copyText } from '../utils/copyText'
import { ROLE_OPTIONS } from '../roles'

interface NewUser {
  id: number
  name: string
  username: string
  password: string
  role: string
}

/**
 * 批量开账号（20260825）
 *
 * 一次进四个销售，一个个手建太慢，初始密码还得自己想。
 * 规则和供应商门户那套一致（老板已经习惯）：
 *   用户名 = 名字拼音（重名自动加数字）、密码 = 随机好读密码、首次登录强制改。
 * 明文只在「创建完成」这一屏出现一次，库里存的是加密值。
 */
export default function BatchCreateUsers({ onDone }: { onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  const [names, setNames] = useState('')
  const [role, setRole] = useState('sales')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<NewUser[]>([])

  const start = () => {
    setOpen(true)
    setNames('')
    setRole('sales')
    setResult([])
  }

  const submit = async () => {
    const list = names.split(/[\r\n,，、;；]+/).map((x) => x.trim()).filter(Boolean)
    if (!list.length) {
      message.warning('请填写姓名，一行一个')
      return
    }
    setLoading(true)
    try {
      const r = await api.post('batchCreateUsers', { names, role })
      setResult(r.items || [])
      message.success(`已创建 ${r.count} 个账号`)
      onDone?.()
    } catch (e: any) {
      message.error(e?.message || '创建失败')
    } finally {
      setLoading(false)
    }
  }

  const loginUrl = `${window.location.origin}/login`
  const oneLine = (u: NewUser) =>
    `${u.name}\n登录地址：${loginUrl}\n账号：${u.username}\n密码：${u.password}\n（首次登录会让你改密码）`

  const copyAll = () =>
    copyText(result.map(oneLine).join('\n\n———\n\n'))
      .then(() => message.success(`已复制 ${result.length} 个账号`))
      .catch(() => message.error('复制失败'))

  const downloadCsv = () => {
    const head = ['姓名', '账号', '密码', '角色', '登录地址']
    const lines = [head, ...result.map((u) => [u.name, u.username, u.password, u.role, loginUrl])]
    const csv = '﻿' + lines.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `员工账号_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <Button icon={<UsergroupAddOutlined />} onClick={start} style={{ marginRight: 8 }}>
        批量开账号
      </Button>
      <Modal
        open={open}
        title="批量开账号"
        width={720}
        onCancel={() => setOpen(false)}
        maskClosable={result.length === 0}
        footer={
          result.length === 0 ? (
            <Space>
              <Button onClick={() => setOpen(false)}>取消</Button>
              <Button type="primary" loading={loading} onClick={submit}>创建账号</Button>
            </Space>
          ) : (
            <Button type="primary" onClick={() => setOpen(false)}>我已保存，关闭</Button>
          )
        }
      >
        {result.length === 0 ? (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 14 }}
              message="命名规则"
              description={
                <div style={{ lineHeight: 1.9 }}>
                  账号 = <strong>名字拼音</strong>（曦冉 → <code>xiran</code>，重名自动加数字）
                  <br />
                  密码 = <strong>随机好读密码</strong>，如 <code>muka3721</code>，首次登录强制改
                  <br />
                  <span style={{ color: '#8c8c8c' }}>
                    销售角色只能看到<strong>自己名下的客户</strong>和自己的商机、订单、看板数字。
                    客户归属在「客户管理」里指派。
                  </span>
                </div>
              }
            />
            <div style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary">角色</Typography.Text>
            </div>
            <Radio.Group value={role} onChange={(e) => setRole(e.target.value)} style={{ marginBottom: 14 }}>
              {ROLE_OPTIONS.filter((r) => r.value !== 'admin').map((r) => (
                <Radio.Button key={r.value} value={r.value}>{r.label}</Radio.Button>
              ))}
            </Radio.Group>
            <div style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary">姓名（一行一个）</Typography.Text>
            </div>
            <Input.TextArea
              rows={6}
              value={names}
              onChange={(e) => setNames(e.target.value)}
              placeholder={'曦冉\n周洁\n雨露\n露雨'}
            />
          </>
        ) : (
          <>
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message={`已创建 ${result.length} 个账号`}
              description="密码只在这一屏显示这一次 —— 库里只存加密后的值。先复制或下载，再关闭。"
            />
            <Space style={{ marginBottom: 12 }}>
              <Button icon={<CopyOutlined />} onClick={copyAll}>复制全部（逐个发的文案）</Button>
              <Button icon={<DownloadOutlined />} onClick={downloadCsv}>下载 CSV</Button>
              <Typography.Text type="secondary">登录地址 {loginUrl}</Typography.Text>
            </Space>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={result}
              columns={[
                { title: '姓名', dataIndex: 'name', width: 110 },
                { title: '账号', dataIndex: 'username', render: (v: string) => <code>{v}</code> },
                { title: '密码', dataIndex: 'password', width: 120, render: (v: string) => <code>{v}</code> },
                {
                  title: '', width: 60,
                  render: (_: any, u: NewUser) => (
                    <a onClick={() => copyText(oneLine(u)).then(() => message.success('已复制'))}>复制</a>
                  ),
                },
              ]}
            />
          </>
        )}
      </Modal>
    </>
  )
}
