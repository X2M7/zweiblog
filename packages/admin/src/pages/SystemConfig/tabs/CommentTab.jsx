import {
  getCommentSetting,
  migrateWalineComments,
  updateCommentSetting,
} from '@/services/zwei-blog/api';
import { ProForm, ProFormDigit, ProFormSelect } from '@ant-design/pro-components';
import { Alert, Button, Card, Descriptions, List, message, Modal, Space, Typography } from 'antd';
import { useState } from 'react';
import { getMigrationErrorMessage, normalizeMigrationResult } from './commentMigration';

const COMMENT_MAX_LENGTH = 50_000;

function MigrationResult({ result }) {
  const details = [
    ...result.errors.map((text) => ({ type: '错误', color: '#cf1322', text })),
    ...result.skippedDetails.map((text) => ({ type: '跳过', color: '#d48806', text })),
  ];
  return (
    <>
      <Descriptions bordered size="small" column={2} style={{ marginTop: 12 }}>
        <Descriptions.Item label="来源">
          {result.sourceDatabase}.{result.sourceCollection}
        </Descriptions.Item>
        <Descriptions.Item label="扫描">{result.scanned}</Descriptions.Item>
        <Descriptions.Item label="新增">{result.created}</Descriptions.Item>
        <Descriptions.Item label="已存在">{result.existing}</Descriptions.Item>
        <Descriptions.Item label="跳过">{result.skipped}</Descriptions.Item>
        <Descriptions.Item label="错误">{result.errorCount}</Descriptions.Item>
      </Descriptions>
      {details.length > 0 ? (
        <List
          size="small"
          header="逐条明细（最多显示服务端返回的记录）"
          dataSource={details}
          style={{ marginTop: 12, maxHeight: 240, overflow: 'auto' }}
          renderItem={(item) => (
            <List.Item>
              <Typography.Text style={{ color: item.color }}>[{item.type}]</Typography.Text>
              <Typography.Text style={{ marginLeft: 8, overflowWrap: 'anywhere' }}>
                {item.text}
              </Typography.Text>
            </List.Item>
          )}
        />
      ) : result.skipped > 0 || result.errorCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="旧版本服务端未返回逐条明细，请查看服务端日志定位被跳过或失败的记录。"
          style={{ marginTop: 12 }}
        />
      ) : null}
    </>
  );
}

export default function CommentTab() {
  const [lastMigration, setLastMigration] = useState();

  const migrate = () => {
    Modal.confirm({
      title: '导入旧 Waline 评论',
      content:
        '请在开放原生评论前执行首次导入。系统将从同一 MongoDB 实例的旧 Waline 数据库读取评论，并幂等写入本地评论表；已有迁移记录不会重复导入，但不会与已经产生的原生评论混合。',
      okText: '开始导入',
      onOk: async () => {
        try {
          const response = await migrateWalineComments();
          const result = normalizeMigrationResult(response);
          setLastMigration(result);
          const hasProblems = result.skipped > 0 || result.errorCount > 0;
          Modal[hasProblems ? 'warning' : 'success']({
            title: hasProblems ? '迁移完成，但有记录未导入' : 'Waline 评论迁移完成',
            width: 720,
            content: <MigrationResult result={result} />,
          });
        } catch (error) {
          Modal.error({
            title: 'Waline 评论迁移失败',
            content: getMigrationErrorMessage(error),
          });
        }
      },
    });
  };

  return (
    <Card title="本地评论设置" extra={<Button onClick={migrate}>导入旧 Waline 数据</Button>}>
      <Alert
        showIcon
        type="success"
        message="评论系统已完全本地化"
        description="评论、回复、审核状态和点赞只保存在本站 MongoDB；前台编辑与预览均支持 Markdown 和 TeX，不加载第三方评论脚本或头像服务。"
        style={{ marginBottom: 20 }}
      />
      {lastMigration ? (
        <Card size="small" title="最近一次迁移结果" style={{ marginBottom: 20 }}>
          <MigrationResult result={lastMigration} />
        </Card>
      ) : null}
      <ProForm
        layout="horizontal"
        labelCol={{ span: 6 }}
        request={async () => {
          const response = await getCommentSetting();
          return {
            moderation: 'suspicious',
            pageSize: 10,
            ...(response?.data || {}),
            maxLength: COMMENT_MAX_LENGTH,
          };
        }}
        onFinish={async (values) => {
          await updateCommentSetting({ ...values, maxLength: COMMENT_MAX_LENGTH });
          message.success('评论设置已保存');
          return true;
        }}
      >
        <ProFormSelect
          name="moderation"
          label="审核策略"
          options={[
            { label: '仅可疑评论需要审核（推荐）', value: 'suspicious' },
            { label: '所有评论都需要审核', value: 'all' },
            { label: '直接公开所有评论', value: 'off' },
          ]}
          rules={[{ required: true }]}
        />
        <ProFormDigit
          name="pageSize"
          label="每页根评论数"
          min={5}
          max={10}
          fieldProps={{ precision: 0 }}
          rules={[{ required: true }]}
        />
        <ProFormDigit
          name="maxLength"
          label="评论字数上限"
          min={COMMENT_MAX_LENGTH}
          max={COMMENT_MAX_LENGTH}
          tooltip="普通评论和管理员回复统一由服务端限制为 50000 个字符"
          fieldProps={{ precision: 0, disabled: true }}
          rules={[{ required: true }]}
        />
        <Space style={{ marginLeft: '25%', marginBottom: 12 }}>
          <Typography.Text type="secondary">
            普通评论和管理员回复的上限固定为 50000 个字符。违禁词可通过
            ZWEI_BLOG_COMMENT_FORBIDDEN_WORDS 环境变量配置，使用英文逗号分隔。
          </Typography.Text>
        </Space>
      </ProForm>
    </Card>
  );
}
