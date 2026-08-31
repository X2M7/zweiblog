import { createApiToken, getAllApiTokens, deleteApiToken } from '@/services/zwei-blog/api';
import { ModalForm, ProFormText, ProTable } from '@ant-design/pro-components';
import type { ActionType } from '@ant-design/pro-table';
import { Button, Card, message, Modal, Space, Typography } from 'antd';

import { useRef } from 'react';
const columns = [
  { dataIndex: 'name', title: '名称' },
  {
    dataIndex: 'createdAt',
    title: '创建时间',
    valueType: 'dateTime',
  },
  {
    title: '操作',
    render: (text, record, _, action) => [
      <a
        key="delete"
        style={{ marginLeft: 8 }}
        onClick={() => {
          Modal.confirm({
            title: '删除确认',
            content: '是否确认删除该 Token？',
            onOk: async () => {
              await deleteApiToken(record._id);
              action?.reload();
              message.success('删除成功！');
            },
          });
        }}
      >
        删除
      </a>,
    ],
  },
];
export default function () {
  const actionRef = useRef<ActionType>();
  return (
    <>
      <Card
        title="Token 管理"
        style={{ marginTop: 8 }}
        className="card-body-full"
        extra={
          <Space>
            <ModalForm
              title="新建 API Token"
              trigger={<Button type="primary"> 新建</Button>}
              onFinish={async (vals) => {
                const { data } = await createApiToken(vals);
                actionRef.current?.reload();
                Modal.success({
                  title: 'API Token 仅显示一次，请立即复制',
                  width: 680,
                  content: (
                    <div>
                      <p>关闭此窗口后将无法再次查看该 Token。</p>
                      <Typography.Text
                        code
                        copyable
                        style={{ maxWidth: '100%', wordBreak: 'break-all' }}
                      >
                        {data?.token}
                      </Typography.Text>
                    </div>
                  ),
                });
                return true;
              }}
            >
              <ProFormText
                label="名称"
                name="name"
                fieldProps={{ maxLength: 64 }}
                rules={[
                  { required: true, whitespace: true, message: '请输入 Token 名称' },
                  { max: 64, message: '名称不能超过 64 个字符' },
                ]}
              />
            </ModalForm>
            <Button
              onClick={() => {
                window.open('/swagger', '_blank');
              }}
            >
              API 文档
            </Button>
            <Button
              onClick={() => {
                Modal.info({
                  title: 'Token 管理功能介绍',
                  content: (
                    <div>
                      <p>创建的 Api Token 可以用来调用 ZweiBlog 的 API</p>
                      <p>结合 API 文档，您可以做到很多有意思的事情。</p>
                      <p>API 文档现在比较水，会慢慢完善的，未来会有 API Playgroud，敬请期待。</p>
                      <p>
                        PS：暂时没必要通过 API
                        开发自己的前台，后面会出主题功能（完善的文档和开发指南，不限制技术栈），届时再开发会更好。
                      </p>
                      <p>
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href="https://github.com/X2M7/zweiblog/blob/main/docs/advanced/token.md"
                        >
                          相关文档
                        </a>
                      </p>
                    </div>
                  ),
                });
              }}
            >
              帮助
            </Button>
          </Space>
        }
      >
        <ProTable
          rowKey="_id"
          columns={columns}
          dateFormatter="string"
          actionRef={actionRef}
          search={false}
          options={false}
          pagination={{
            hideOnSinglePage: true,
            simple: true,
          }}
          request={async (params = {}) => {
            let { data } = await getAllApiTokens();
            return {
              data,
              // success 请返回 true，
              // 不然 table 会停止解析数据，即使有数据
              success: true,
              // 不传会使用 data 的长度，如果是分页一定要传
              total: data.length,
            };
          }}
        />
      </Card>
    </>
  );
}
