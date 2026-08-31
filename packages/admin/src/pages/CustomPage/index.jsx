import CustomPageModal from '@/components/CustomPageModal';
import { deleteCustomPageByPath, getCustomPages } from '@/services/zwei-blog/api';
import { downloadCustomPageArchive } from '@/services/zwei-blog/customPageExport';
import { DownloadOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import { Button, Card, message, Modal, Space } from 'antd';
import { useRef, useState } from 'react';
import { Link } from 'umi';

function ExportCustomPageAction({ record }) {
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

  return (
    <Button
      icon={<DownloadOutlined />}
      loading={loading}
      onClick={async () => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true);
        try {
          const fileName = await downloadCustomPageArchive(record.path, record.name);
          message.success(`项目已导出：${fileName}`);
        } catch (error) {
          message.error(error?.data?.message || error?.message || '项目导出失败，请稍后重试。');
        } finally {
          loadingRef.current = false;
          setLoading(false);
        }
      }}
      size="small"
      style={{ padding: 0 }}
      type="link"
    >
      导出项目
    </Button>
  );
}

const columns = [
  {
    title: '序号',
    render: (_, record, index) => {
      return index;
    },
  },
  { dataIndex: 'name', title: '名称' },
  {
    dataIndex: 'type',
    title: '类型',
    valueType: 'select',
    valueEnum: {
      file: {
        text: '单文件页面',
        status: 'Default',
      },
      folder: {
        text: '多文件页面',
        status: 'Success',
      },
    },
  },
  { dataIndex: 'path', title: '路径' },
  {
    title: '操作',
    render: (text, record, _, action) => {
      return (
        <Space>
          <Link
            to={
              record.type == 'file'
                ? `/code?type=file&lang=html&path=${record.path}`
                : `/code?type=folder&path=${record.path}`
            }
          >
            {record.type == 'file' ? '编辑内容' : '文件管理'}
          </Link>
          <ExportCustomPageAction record={record} />
        </Space>
      );
    },
  },
  {
    title: '路径',
    render: (text, record, _, action) => {
      return (
        <Space>
          <a key="view" target="_blank" rel="noreferrer" href={`/c${record.path}`}>
            查看
          </a>

          <CustomPageModal
            key={'editInfo'}
            trigger={<a>修改信息</a>}
            initialValues={record}
            onFinish={() => {
              action?.reload();
            }}
          ></CustomPageModal>
          <a
            key="delete"
            onClick={() => {
              Modal.confirm({
                title: '删除确认',
                content: '是否确认删除该自定义页面？',
                onOk: async () => {
                  await deleteCustomPageByPath(record.path);
                  action?.reload();
                  message.success('删除成功！');
                },
              });
            }}
          >
            删除
          </a>
        </Space>
      );
    },
  },
];
export default function () {
  // const [loading, setLoading] = useState(true);
  const actionRef = useRef();

  const handleHelp = () => {
    Modal.info({
      title: '帮助',
      content: (
        <div>
          <p>自定义页面可以添加页面到 /c 路径下。</p>
          <p>自定义页面分为两种：单文件页面、多文件页面。</p>
          <p>
            前者可直接通过后台内置编辑器编辑其 HTML
            内容，比较省事、后者需要上传相关的文件，适合复杂页面。
          </p>
          <p>多文件页面后续会演进成“文件管理”功能～</p>
          <a
            target="_blank"
            href="https://github.com/X2M7/zweiblog/blob/main/docs/advanced/custom-page.md"
            rel="noreferrer"
          >
            帮助文档
          </a>
        </div>
      ),
    });
  };

  return (
    <>
      <Card
        className="card-body-full"
        title="自定义页面"
        extra={
          <Space>
            <CustomPageModal
              trigger={<Button type="primary">新建</Button>}
              onFinish={() => {
                actionRef.current?.reload();
                message.success('新建成功！');
              }}
            />
            <Button type="link" key="help" onClick={handleHelp}>
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
            let { data } = await getCustomPages();
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
