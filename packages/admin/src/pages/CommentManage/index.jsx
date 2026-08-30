import {
  deleteComment,
  getComments,
  purgeComment,
  replyComment,
  updateComment,
} from '@/services/zwei-blog/api';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import {
  Button,
  Descriptions,
  Input,
  message,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useMemo, useRef, useState } from 'react';

const { Paragraph, Text } = Typography;
const COMMENT_MAX_LENGTH = 50_000;

const statusMeta = {
  pending: { text: '待审核', color: 'processing' },
  approved: { text: '已通过', color: 'success' },
  spam: { text: '垃圾评论', color: 'error' },
  deleted: { text: '已删除', color: 'default' },
};

const getCommentId = (record) => record?.id || record?._id;
const getCommentContent = (record) => record?.content || record?.rawContent || '';
const getAuthorName = (record) => record?.nick || record?.nickname || record?.name || '匿名访客';
const formatSourceValue = (value, preferredKeys = []) => {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => formatSourceValue(item))
      .filter(Boolean)
      .join(' ');
  }
  if (typeof value !== 'object') return String(value).trim();

  const keys = preferredKeys.length
    ? preferredKeys
    : ['country', 'region', 'province', 'city', 'district', 'name', 'version'];
  return [...new Set(keys.map((key) => formatSourceValue(value[key])).filter(Boolean))].join(' ');
};
const getLocation = (record) =>
  formatSourceValue(record?.location || record?.ipLocation || record?.geoLocation || record?.geo, [
    'country',
    'region',
    'province',
    'city',
    'district',
  ]);
const getBrowser = (record) =>
  formatSourceValue(record?.browser || record?.device?.browser, ['name', 'version']);
const getOperatingSystem = (record) =>
  formatSourceValue(record?.os || record?.operatingSystem || record?.device?.os, [
    'name',
    'version',
  ]);
const getIpAddress = (record) =>
  formatSourceValue(record?.ip || record?.ipAddress || record?.clientIp || record?.source?.ip);
const getReplyContent = (record) => {
  if (typeof record?.reply === 'string') return record.reply;
  if (Array.isArray(record?.replies)) {
    return record.replies[record.replies.length - 1]?.content || '';
  }
  return record?.reply?.content || record?.adminReply || '';
};

const normalizeCommentPage = (response) => {
  const payload = response?.data ?? response ?? {};
  const comments = payload.comments ?? payload.items ?? payload.data ?? [];
  return {
    comments: Array.isArray(comments) ? comments : [],
    total: Number(payload.total ?? payload.count ?? comments.length) || 0,
  };
};

export default function CommentManage() {
  const actionRef = useRef();
  const [viewingComment, setViewingComment] = useState();
  const [replyingComment, setReplyingComment] = useState();
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reload = () => actionRef.current?.reload();

  const changeStatus = async (record, status) => {
    const id = getCommentId(record);
    if (!id) {
      message.error('评论 ID 无效，无法更新');
      return;
    }
    await updateComment(id, { status });
    message.success(`评论已标记为${statusMeta[status]?.text || status}`);
    reload();
  };

  const removeComment = async (record) => {
    const id = getCommentId(record);
    if (!id) {
      message.error('评论 ID 无效，无法删除');
      return;
    }
    await deleteComment(id);
    message.success('评论正文和访客信息已清除；可再选择永久清除匿名占位');
    reload();
  };

  const permanentlyClearComment = (record) => {
    const id = getCommentId(record);
    if (!id) {
      message.error('评论 ID 无效，无法永久清除');
      return;
    }
    Modal.confirm({
      title: '永久清除这条已删除评论？',
      content:
        '此操作不可撤销。若评论没有回复，它会从数据库物理删除；若仍有回复，则会清空正文和访客信息，只保留匿名结构占位。',
      okText: '永久清除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const response = await purgeComment(id);
        const result = response?.data || {};
        if (result.placeholder) {
          message.success(
            `访客信息和正文已永久清除；因仍有 ${
              result.descendantsPreserved || 0
            } 条回复，已保留匿名占位`,
          );
        } else {
          message.success('评论已从数据库永久移除');
        }
        reload();
      },
    });
  };

  const openReply = (record) => {
    setReplyingComment(record);
    setReply('');
  };

  const submitReply = async () => {
    const id = getCommentId(replyingComment);
    const content = reply.trim();
    if (!id || !content) {
      message.warning('回复内容不能为空');
      return;
    }
    if (content.length > COMMENT_MAX_LENGTH) {
      message.warning(`回复不能超过 ${COMMENT_MAX_LENGTH.toLocaleString()} 个字符`);
      return;
    }
    setSubmitting(true);
    try {
      await replyComment(id, content);
      message.success('回复已保存');
      setReplyingComment(undefined);
      setReply('');
      reload();
    } finally {
      setSubmitting(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        title: '状态',
        dataIndex: 'status',
        width: 100,
        valueEnum: {
          pending: { text: '待审核', status: 'Processing' },
          approved: { text: '已通过', status: 'Success' },
          spam: { text: '垃圾评论', status: 'Error' },
          deleted: { text: '已删除', status: 'Default' },
        },
        render: (_, record) => {
          const meta = statusMeta[record.status] || {
            text: record.status || '未知',
            color: 'default',
          };
          return <Tag color={meta.color}>{meta.text}</Tag>;
        },
      },
      {
        title: '关键词',
        dataIndex: 'keyword',
        hideInTable: true,
        fieldProps: {
          placeholder: '正文、昵称、邮箱或文章',
          maxLength: 100,
        },
      },
      {
        title: '评论内容',
        dataIndex: 'content',
        search: false,
        ellipsis: true,
        render: (_, record) => (
          <div style={{ minWidth: 240 }}>
            <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 4, whiteSpace: 'pre-wrap' }}>
              {getCommentContent(record) || '（空评论）'}
            </Paragraph>
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => setViewingComment(record)}
            >
              查看 Markdown 原文
            </Button>
            {getReplyContent(record) ? (
              <Paragraph type="secondary" ellipsis={{ rows: 1 }} style={{ margin: '4px 0 0' }}>
                管理员回复：{getReplyContent(record)}
              </Paragraph>
            ) : null}
          </div>
        ),
      },
      {
        title: '访客',
        search: false,
        width: 180,
        render: (_, record) => (
          <Space direction="vertical" size={0}>
            <Text>{getAuthorName(record)}</Text>
            {record.mail || record.email ? (
              <Text type="secondary">{record.mail || record.email}</Text>
            ) : null}
          </Space>
        ),
      },
      {
        title: '文章 / 页面',
        search: false,
        width: 200,
        render: (_, record) =>
          record.articleTitle || record.title || record.path || record.link || record.url || '-',
      },
      {
        title: '来源',
        search: false,
        width: 260,
        render: (_, record) => {
          const location = getLocation(record);
          const browser = getBrowser(record);
          const operatingSystem = getOperatingSystem(record);
          const ip = getIpAddress(record);
          return (
            <Space direction="vertical" size={0} style={{ maxWidth: 240 }}>
              <Text ellipsis={{ tooltip: location || '未知位置' }}>{location || '未知位置'}</Text>
              <Text
                type="secondary"
                ellipsis={{ tooltip: [browser, operatingSystem].filter(Boolean).join(' · ') }}
              >
                {[browser || '未知浏览器', operatingSystem || '未知系统'].join(' · ')}
              </Text>
              {ip ? (
                <Text
                  type="secondary"
                  code
                  copyable={{ text: ip, tooltips: ['复制 IP', '已复制'] }}
                  style={{ maxWidth: '100%', overflowWrap: 'anywhere' }}
                >
                  {ip}
                </Text>
              ) : (
                <Text type="secondary">IP 未记录</Text>
              )}
            </Space>
          );
        },
      },
      {
        title: '时间',
        dataIndex: 'createdAt',
        search: false,
        width: 175,
        render: (value) => (value ? new Date(value).toLocaleString() : '-'),
      },
      {
        title: '操作',
        valueType: 'option',
        width: 280,
        fixed: 'right',
        render: (_, record) => (
          <Space size={[8, 4]} wrap>
            {record.status !== 'deleted' && record.status !== 'approved' ? (
              <a onClick={() => changeStatus(record, 'approved')}>通过</a>
            ) : null}
            {record.status !== 'deleted' && record.status !== 'pending' ? (
              <a onClick={() => changeStatus(record, 'pending')}>待审</a>
            ) : null}
            {record.status !== 'deleted' && record.status !== 'spam' ? (
              <a onClick={() => changeStatus(record, 'spam')}>垃圾</a>
            ) : null}
            {record.status !== 'deleted' ? <a onClick={() => openReply(record)}>回复</a> : null}
            {record.status !== 'deleted' ? (
              <Popconfirm
                title="删除这条评论？正文和访客信息会立即清除，并暂存匿名结构占位。"
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                onConfirm={() => removeComment(record)}
              >
                <a style={{ color: '#ff4d4f' }}>删除</a>
              </Popconfirm>
            ) : null}
            {record.status === 'deleted' ? (
              <a style={{ color: '#cf1322' }} onClick={() => permanentlyClearComment(record)}>
                永久清除
              </a>
            ) : null}
          </Space>
        ),
      },
    ],
    [],
  );

  return (
    <PageContainer
      title="评论管理"
      subTitle="审核、搜索与回复本地评论"
      extra={<Button onClick={reload}>刷新</Button>}
    >
      <ProTable
        actionRef={actionRef}
        rowKey={(record) => getCommentId(record)}
        columns={columns}
        cardBordered
        scroll={{ x: 1480 }}
        options={{ reload: true, density: true, fullScreen: true }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
        request={async ({ current, pageSize, status, keyword }) => {
          const response = await getComments({
            page: current,
            pageSize,
            status,
            keyword: keyword?.trim(),
          });
          const { comments, total } = normalizeCommentPage(response);
          return { data: comments, total, success: true };
        }}
      />

      <Modal
        title="评论详情与 Markdown 原文"
        visible={Boolean(viewingComment)}
        footer={null}
        width={720}
        onCancel={() => setViewingComment(undefined)}
      >
        {viewingComment ? (
          <>
            <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="访客">{getAuthorName(viewingComment)}</Descriptions.Item>
              <Descriptions.Item label="邮箱">
                {viewingComment.mail || viewingComment.email || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="页面">
                {viewingComment.articleTitle ||
                  viewingComment.title ||
                  viewingComment.path ||
                  viewingComment.link ||
                  viewingComment.url ||
                  '-'}
              </Descriptions.Item>
              <Descriptions.Item label="地理位置">
                {getLocation(viewingComment) || '未知位置'}
              </Descriptions.Item>
              <Descriptions.Item label="浏览器">
                {getBrowser(viewingComment) || '未知浏览器'}
              </Descriptions.Item>
              <Descriptions.Item label="操作系统">
                {getOperatingSystem(viewingComment) || '未知系统'}
              </Descriptions.Item>
              <Descriptions.Item label="原始 IP">
                {getIpAddress(viewingComment) ? (
                  <Text
                    code
                    copyable={{
                      text: getIpAddress(viewingComment),
                      tooltips: ['复制 IP', '已复制'],
                    }}
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    {getIpAddress(viewingComment)}
                  </Text>
                ) : (
                  '未记录'
                )}
              </Descriptions.Item>
            </Descriptions>
            <pre
              style={{
                maxHeight: '55vh',
                margin: 0,
                padding: 16,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                background: '#f5f5f5',
              }}
            >
              {getCommentContent(viewingComment) || '（空评论）'}
            </pre>
          </>
        ) : null}
      </Modal>

      <Modal
        title="管理员回复"
        visible={Boolean(replyingComment)}
        confirmLoading={submitting}
        okText="保存回复"
        cancelText="取消"
        onOk={submitReply}
        onCancel={() => {
          if (!submitting) {
            setReplyingComment(undefined);
            setReply('');
          }
        }}
      >
        <Input.TextArea
          value={reply}
          rows={6}
          maxLength={COMMENT_MAX_LENGTH}
          showCount
          placeholder="输入管理员回复"
          onChange={(event) => setReply(event.target.value)}
        />
      </Modal>
    </PageContainer>
  );
}
