import { useEffect, useState } from 'react'
import { ProCard } from '@ant-design/pro-components'
import { Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api } from '../../api'

/**
 * 建材术语表（20261113）：中文 → 印尼语 / 英文的行业叫法。
 * 开印尼语 / 英文发票时，品名先查这里，查不到才让 AI 翻；人工确认过的译名会自动加进来。
 */
const SOURCE: Record<string, { color: string; text: string }> = {
  system: { color: 'default', text: '内置' },
  manual: { color: 'blue', text: '手动' },
  confirmed: { color: 'green', text: '开票时确认' },
}

export default function GlossaryPane() {
  const [rows, setRows] = useState<any[]>([])
  const [kw, setKw] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form] = Form.useForm()
  const isAdmin = localStorage.getItem('role') === 'admin'

  const load = (k = kw) => {
    setLoading(true)
    api
      .get('listGlossary', { keyword: k })
      .then((r) => setRows(r.items || []))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    load('')
  }, [])

  const save = async () => {
    const v = await form.validateFields()
    await api.post('saveGlossaryTerm', { ...v, id: editing?.id })
    message.success('已保存')
    setEditing(null)
    load()
  }

  return (
    <ProCard
      title="建材术语表（印尼语 / 英文）"
      bordered
      headerBordered
      extra={
        <Space>
          <Input.Search allowClear placeholder="搜中文 / 印尼语 / 英文" onSearch={(v) => { setKw(v); load(v) }} style={{ width: 240 }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setEditing({}) }}>
            添加术语
          </Button>
        </Space>
      }
    >
      <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        开印尼语 / 英文发票和报价单时，品名先按这张表翻（用印尼建材店的实际叫法，不是直译），查不到才交给 AI，AI 翻的必须人工确认。
        开票时确认过的译名会自动加进来。
      </div>
      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 30, showSizeChanger: false }}
        columns={[
          { title: '中文', dataIndex: 'zh', width: 160 },
          { title: '印尼语', dataIndex: 'id_text' },
          { title: 'English', dataIndex: 'en_text' },
          { title: '备注', dataIndex: 'note', width: 180, ellipsis: true },
          { title: '来源', dataIndex: 'source', width: 100, render: (v: string) => <Tag color={SOURCE[v]?.color}>{SOURCE[v]?.text || v}</Tag> },
          {
            title: '',
            width: 110,
            render: (_: any, r: any) => (
              <Space>
                <a onClick={() => { form.setFieldsValue(r); setEditing(r) }}>编辑</a>
                {isAdmin && (
                  <Popconfirm title={`删除「${r.zh}」？`} onConfirm={async () => { await api.post('deleteGlossaryTerm', { id: r.id }); load() }}>
                    <a style={{ color: '#e64545' }}>删除</a>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal title={editing?.id ? '编辑术语' : '添加术语'} open={!!editing} onCancel={() => setEditing(null)} onOk={save} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="zh" label="中文" rules={[{ required: true, message: '请填写中文' }]}>
            <Input placeholder="如：天地骨" />
          </Form.Item>
          <Form.Item name="id_text" label="印尼语（当地建材行业叫法）">
            <Input placeholder="如：Metal Track" />
          </Form.Item>
          <Form.Item name="en_text" label="English">
            <Input placeholder="如：Metal Track (Runner)" />
          </Form.Item>
          <Form.Item name="note" label="备注（选填）">
            <Input placeholder="如：隔墙天地龙骨" />
          </Form.Item>
        </Form>
      </Modal>
    </ProCard>
  )
}
