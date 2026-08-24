import { useState } from 'react'
import {
  Alert, Button, Input, Modal, Radio, Space, Steps, Table, Tag, Typography, message,
} from 'antd'
import { KeyOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import { copyText } from '../utils/copyText'

interface AccRow {
  supplier_id: number
  code: string
  name: string
  contact: string
  phone: string
  username: string
  password: string
  had_account?: number
  old_username?: string
}

/**
 * 批量生成供应商门户账号
 *
 * 两步：先预览（可逐个改用户名），确认后才落库。
 * 明文密码只在「生成完成」这一屏出现一次，关掉就没了——库里只存 hash。
 */
export default function SupplierAccountBatch({ onDone }: { onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [scope, setScope] = useState<'missing' | 'all'>('missing')
  const [rows, setRows] = useState<AccRow[]>([])
  const [result, setResult] = useState<AccRow[]>([])
  const [loading, setLoading] = useState(false)

  const start = () => {
    setOpen(true)
    setStep(0)
    setRows([])
    setResult([])
  }

  const preview = async () => {
    setLoading(true)
    try {
      const r = await api.post('previewSupplierAccounts', { scope })
      const items: AccRow[] = r.items || []
      if (!items.length) {
        message.info(scope === 'missing' ? '所有在用供应商都已经有门户账号了' : '没有在用的供应商')
        return
      }
      setRows(items)
      setStep(1)
    } catch (e: any) {
      message.error(e?.message || '生成预览失败')
    } finally {
      setLoading(false)
    }
  }

  const commit = async () => {
    const bad = rows.find((r) => !/^[a-z0-9_.-]{3,32}$/.test(r.username))
    if (bad) {
      message.error(`用户名「${bad.username}」不合法：只能用小写字母 / 数字 / . _ -，3~32 位`)
      return
    }
    setLoading(true)
    try {
      const r = await api.post('generateSupplierAccounts', {
        items: rows.map((x) => ({ supplier_id: x.supplier_id, username: x.username, password: x.password })),
      })
      setResult(r.items || [])
      setStep(2)
      onDone?.()
    } catch (e: any) {
      message.error(e?.message || '生成失败')
    } finally {
      setLoading(false)
    }
  }

  const updName = (id: number, v: string) =>
    setRows((p) => p.map((r) => (r.supplier_id === id ? { ...r, username: v.toLowerCase().trim() } : r)))

  const portalUrl = `${window.location.origin}/vendor`

  const oneLine = (r: AccRow) =>
    `${r.name}\n登录地址：${portalUrl}\n账号：${r.username}\n密码：${r.password}\n（首次登录会让你改密码）`

  const copyAll = () => {
    const txt = result.map(oneLine).join('\n\n———\n\n')
    copyText(txt).then(() => message.success(`已复制 ${result.length} 家的账号信息`))
      .catch(() => message.error('复制失败'))
  }

  const downloadCsv = () => {
    const head = ['编号', '供应商', '联系人', '电话', '账号', '密码', '登录地址']
    const lines = [head, ...result.map((r) => [r.code, r.name, r.contact, r.phone, r.username, r.password, portalUrl])]
    const csv = '﻿' + lines.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `供应商门户账号_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const resetCount = rows.filter((r) => r.had_account).length

  return (
    <>
      <Button icon={<KeyOutlined />} onClick={start}>批量生成门户账号</Button>
      <Modal
        open={open}
        title="批量生成供应商门户账号"
        width={900}
        onCancel={() => setOpen(false)}
        maskClosable={step !== 2}
        footer={
          step === 0 ? (
            <Space>
              <Button onClick={() => setOpen(false)}>取消</Button>
              <Button type="primary" loading={loading} onClick={preview}>生成预览</Button>
            </Space>
          ) : step === 1 ? (
            <Space>
              <Button onClick={() => setStep(0)}>上一步</Button>
              <Button type="primary" loading={loading} onClick={commit}>
                确认生成 {rows.length} 个账号
              </Button>
            </Space>
          ) : (
            <Button type="primary" onClick={() => setOpen(false)}>我已保存，关闭</Button>
          )
        }
      >
        <Steps
          size="small"
          current={step}
          style={{ marginBottom: 18 }}
          items={[{ title: '选范围' }, { title: '核对用户名' }, { title: '发给供应商' }]}
        />

        {step === 0 && (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="命名规则"
              description={
                <div style={{ lineHeight: 1.9 }}>
                  <div>账号 = <strong>名字拼音 + 供应商编号</strong>，如 神州电缆(1001) → <code>shenzhou1001</code></div>
                  <div>密码 = <strong>随机好读密码</strong>，如 <code>muka3721</code>（不含 0、1、O、l 这些电话里念不清的字符）</div>
                  <div style={{ color: '#8c8c8c' }}>
                    密码不用「固定规则 + 编号」，是因为那样任何知道编号规律的人都能登进别家账号，
                    看到甚至改掉别家的底价。供应商<strong>首次登录会被强制改密</strong>。
                  </div>
                </div>
              }
            />
            <Radio.Group value={scope} onChange={(e) => setScope(e.target.value)}>
              <Space direction="vertical">
                <Radio value="missing">只给还没账号的供应商生成（推荐）</Radio>
                <Radio value="all">
                  全部重新生成
                  <Typography.Text type="danger" style={{ marginLeft: 8 }}>
                    已经在用的供应商会被顶掉，旧密码立即失效
                  </Typography.Text>
                </Radio>
              </Space>
            </Radio.Group>
          </div>
        )}

        {step === 1 && (
          <div>
            {resetCount > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message={`其中 ${resetCount} 家已经有账号了，确认后旧密码立即失效，需要重新通知他们`}
              />
            )}
            <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 8 }}>
              用户名可以直接改。多音字会转错（重庆 → zhongqing），在这里改掉就行。
            </div>
            <Table
              rowKey="supplier_id"
              size="small"
              pagination={false}
              scroll={{ y: 380 }}
              dataSource={rows}
              columns={[
                { title: '编号', dataIndex: 'code', width: 70 },
                {
                  title: '供应商',
                  render: (_: any, r: AccRow) => (
                    <div>
                      <div>{r.name}</div>
                      {r.had_account ? (
                        <Tag color="orange">原账号 {r.old_username}</Tag>
                      ) : null}
                    </div>
                  ),
                },
                { title: '联系人', dataIndex: 'contact', width: 90 },
                {
                  title: '账号',
                  width: 220,
                  render: (_: any, r: AccRow) => (
                    <Input size="small" value={r.username} onChange={(e) => updName(r.supplier_id, e.target.value)} />
                  ),
                },
                {
                  title: '密码',
                  dataIndex: 'password',
                  width: 110,
                  render: (v: string) => <code>{v}</code>,
                },
              ]}
            />
          </div>
        )}

        {step === 2 && (
          <div>
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message={`已生成 ${result.length} 个账号`}
              description="密码只在这一屏显示这一次——库里只存加密后的值，关掉这个窗口就看不到了。先复制或下载，再关闭。"
            />
            <Space style={{ marginBottom: 12 }}>
              <Button icon={<CopyOutlined />} onClick={copyAll}>复制全部（逐家发的文案）</Button>
              <Button icon={<DownloadOutlined />} onClick={downloadCsv}>下载 CSV</Button>
              <Typography.Text type="secondary">登录地址 {portalUrl}</Typography.Text>
            </Space>
            <Table
              rowKey="supplier_id"
              size="small"
              pagination={false}
              scroll={{ y: 340 }}
              dataSource={result}
              columns={[
                { title: '编号', dataIndex: 'code', width: 70 },
                { title: '供应商', dataIndex: 'name' },
                { title: '联系人', dataIndex: 'contact', width: 90 },
                { title: '电话', dataIndex: 'phone', width: 130 },
                { title: '账号', dataIndex: 'username', width: 180, render: (v: string) => <code>{v}</code> },
                { title: '密码', dataIndex: 'password', width: 110, render: (v: string) => <code>{v}</code> },
                {
                  title: '',
                  width: 60,
                  render: (_: any, r: AccRow) => (
                    <a onClick={() => copyText(oneLine(r)).then(() => message.success('已复制'))}>复制</a>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Modal>
    </>
  )
}
