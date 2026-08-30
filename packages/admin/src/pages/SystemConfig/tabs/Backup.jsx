import { exportAll } from '@/services/zwei-blog/api';
import { Alert, Button, Card, Descriptions, message, Modal, Space, Spin, Upload } from 'antd';
import moment from 'moment';
import { useState } from 'react';

const formatError = (value) => {
  if (Array.isArray(value)) return value.join('；');
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const headline = formatError(value.message);
    const details = Array.isArray(value.errors)
      ? value.errors
          .slice(0, 20)
          .map((item) => {
            if (typeof item === 'string') return item;
            const id = item?.id || item?.legacyId || item?.index;
            return `${id !== undefined ? `[${id}] ` : ''}${
              item?.reason || item?.message || '未知错误'
            }`;
          })
          .join('；')
      : '';
    return details ? `${headline}：${details}` : headline;
  }
  return '服务端未返回具体错误，请查看服务端日志。';
};

const showImportResult = (fileName, response) => {
  if (!response || (response.statusCode && response.statusCode !== 200)) {
    Modal.error({
      title: `${fileName} 导入失败`,
      content: formatError(response?.message || response?.data?.message),
    });
    return;
  }
  const result = response.data;
  if (!result || typeof result !== 'object') {
    Modal.info({
      title: `${fileName} 已由服务端处理`,
      content: typeof result === 'string' ? result : '当前服务端未提供逐项导入统计。',
    });
    return;
  }
  const processed = result.processed || {};
  const comments = result.comments || {};
  const skipped = Number(comments.skipped) || 0;
  const quarantined = Number(comments.quarantined) || 0;
  const needsAttention = skipped > 0 || quarantined > 0;
  Modal[needsAttention ? 'warning' : 'success']({
    title: needsAttention ? '备份导入完成，但有评论需要留意' : '备份导入完成',
    width: 680,
    content: (
      <Descriptions bordered size="small" column={2} style={{ marginTop: 12 }}>
        <Descriptions.Item label="文章">{Number(processed.articles) || 0}</Descriptions.Item>
        <Descriptions.Item label="分类">{Number(processed.categories) || 0}</Descriptions.Item>
        <Descriptions.Item label="草稿">{Number(processed.drafts) || 0}</Descriptions.Item>
        <Descriptions.Item label="图片记录">{Number(processed.staticItems) || 0}</Descriptions.Item>
        <Descriptions.Item label="评论（提供）">
          {Number(comments.supplied ?? processed.comments) || 0}
        </Descriptions.Item>
        <Descriptions.Item label="评论（写入 / 更新）">
          {Number(comments.written) || 0}
        </Descriptions.Item>
        <Descriptions.Item label="评论（跳过）">{skipped}</Descriptions.Item>
        <Descriptions.Item label="评论（隔离）">{quarantined}</Descriptions.Item>
        <Descriptions.Item label="访问统计">
          {(Number(processed.visits) || 0) + (Number(processed.viewers) || 0)}
        </Descriptions.Item>
      </Descriptions>
    ),
  });
};

export default function (props) {
  const [loading, setLoading] = useState(false);
  const handleOutPut = async () => {
    setLoading(true);
    let url;
    try {
      const data = await exportAll();
      url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `备份-${moment().format('YYYY-MM-DD')}.json`;
      link.click();
    } catch (error) {
      message.error(`导出失败：${formatError(error?.message)}`);
    } finally {
      if (url) URL.revokeObjectURL(url);
      setLoading(false);
    }
  };
  return (
    <Card title="备份与恢复">
      <Alert
        type="warning"
        message="恢复请在维护窗口进行，并先为目标数据库做快照；恢复期间请勿发布文章、评论或修改设置。JSON 备份不包含本地图床图片本身，需要在图床设置中另行导出。"
        style={{ marginBottom: 20 }}
      />
      <Spin spinning={loading}>
        <Space size="large">
          <Upload
            showUploadList={false}
            name="file"
            accept=".json"
            action="/api/admin/backup/import"
            headers={{
              token: (() => {
                return window.localStorage.getItem('token') || 'null';
              })(),
            }}
            onChange={(info) => {
              setLoading(true);
              if (info.file.status === 'done') {
                setLoading(false);
                showImportResult(info.file.name, info.file.response);
              } else if (info.file.status === 'error') {
                setLoading(false);
                Modal.error({
                  title: `${info.file.name} 导入失败`,
                  content: formatError(
                    info.file.response?.message ||
                      info.file.response?.data?.message ||
                      info.file.error?.message,
                  ),
                });
              }
            }}
          >
            <Button>导入全部数据</Button>
          </Upload>
          <Button type="primary" onClick={handleOutPut}>
            导出全部数据
          </Button>
        </Space>
      </Spin>
    </Card>
  );
}
