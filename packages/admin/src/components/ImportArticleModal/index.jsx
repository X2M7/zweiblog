import { createArticle, getAllCategories, getTags } from '@/services/zwei-blog/api';
import { SUMMARY_MAX_LENGTH } from '@/pages/Editor/bilingualContent';
import {
  needsPrivateImportPassword,
  parseMarkdownFile,
} from '@/services/zwei-blog/parseMarkdownFile';
import {
  ModalForm,
  ProFormDateTimePicker,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { Button, Form, message, Upload } from 'antd';
import moment from 'moment';
import { useRef, useState } from 'react';
export default function (props) {
  const { onFinish } = props;
  const [visible, setVisible] = useState(false);
  const [form] = Form.useForm();
  const batchImport = useRef({ key: '', completed: 0, failed: false });
  const handleUpload = async (file) => {
    const vals = await parseMarkdownFile(file);
    if (!vals) return false;
    if (needsPrivateImportPassword(vals)) {
      message.error(`私密文章 ${file.name} 未携带新密码，请单独导入并设置访问密码`);
      return false;
    }
    await createArticle(vals);
    return true;
  };
  const beforeUpload = async (file, files) => {
    if (files.length > 1) {
      const batchKey = files
        .map((item) => `${item.name}:${item.size || 0}:${item.lastModified || 0}`)
        .join('|');
      if (batchImport.current.key !== batchKey) {
        batchImport.current = { key: batchKey, completed: 0, failed: false };
      }
      let succeeded = false;
      try {
        succeeded = await handleUpload(file);
      } catch (err) {
        message.error(`${file.name} 导入失败`);
      }
      if (batchImport.current.key === batchKey) {
        batchImport.current.completed += 1;
        batchImport.current.failed = batchImport.current.failed || !succeeded;
        if (batchImport.current.completed >= files.length) {
          const failed = batchImport.current.failed;
          batchImport.current = { key: '', completed: 0, failed: false };
          if (failed) {
            message.warning('批量导入未全部完成；私密文章需要单独导入并设置新密码');
          } else if (onFinish) {
            onFinish();
          }
        }
      }
    } else {
      const vals = await parseMarkdownFile(file);
      if (vals) {
        form.resetFields();
        form.setFieldsValue(vals);
        setVisible(true);
      }
    }
    return false;
  };
  return (
    <>
      <Upload showUploadList={false} multiple={true} accept={'.md'} beforeUpload={beforeUpload}>
        <Button key="button" type="primary" title="从 markdown 文件导入，可多选">
          导入
        </Button>
      </Upload>
      <ModalForm
        form={form}
        title="导入文章"
        visible={visible}
        onVisibleChange={(v) => {
          setVisible(v);
        }}
        width={720}
        autoFocusFirstInput
        submitTimeout={3000}
        onFinish={async (values) => {
          const washedValues = {};
          for (const [k, v] of Object.entries(values)) {
            washedValues[k.replace('C', '')] = v;
          }

          if (needsPrivateImportPassword(washedValues)) {
            message.error('导入私密文章时必须设置一个新的访问密码');
            return false;
          }

          await createArticle(washedValues);
          if (onFinish) {
            onFinish();
          }

          return true;
        }}
        layout="horizontal"
        labelCol={{ span: 6 }}
        // wrapperCol: { span: 14 },
      >
        <ProFormText
          width="md"
          required
          id="title"
          name="title"
          label="文章标题"
          placeholder="请输入标题"
          rules={[{ required: true, message: '这是必填项' }]}
        />
        <ProFormText width="md" id="titleEn" name="titleEn" label="英文标题" placeholder="可选" />
        <ProFormTextArea
          name="summary"
          label="中文摘要"
          id="summary"
          fieldProps={{
            autoSize: { minRows: 2, maxRows: 4 },
            maxLength: SUMMARY_MAX_LENGTH,
            showCount: true,
          }}
        />
        <ProFormTextArea
          name="summaryEn"
          label="英文摘要"
          id="summaryEn"
          fieldProps={{
            autoSize: { minRows: 2, maxRows: 4 },
            maxLength: SUMMARY_MAX_LENGTH,
            showCount: true,
          }}
        />
        <ProFormText
          width="md"
          id="top"
          name="top"
          label="置顶优先级"
          placeholder="留空或0表示不置顶，其余数字越大表示优先级越高"
        />
        <ProFormSelect
          mode="tags"
          tokenSeparators={[',']}
          width="md"
          name="tags"
          label="标签"
          placeholder="请选择或输入标签"
          request={async () => {
            const msg = await getTags();
            return msg?.data?.map((item) => ({ label: item, value: item })) || [];
          }}
        />
        <ProFormSelect
          width="md"
          required
          id="category"
          name="category"
          label="分类"
          placeholder="请选择分类"
          tooltip="首次使用请先在站点管理-数据管理-分类管理中添加分类"
          rules={[{ required: true, message: '这是必填项' }]}
          request={async () => {
            const { data: categories } = await getAllCategories();
            return categories?.map((e) => {
              return {
                label: e,
                value: e,
              };
            });
          }}
        />
        <ProFormDateTimePicker
          showTime={{
            defaultValue: moment('00:00:00', 'HH:mm:ss'),
          }}
          width="md"
          name="createdAt"
          id="createdAt"
          label="创建时间"
        />
        <ProFormSelect
          width="md"
          name="private"
          id="private"
          label="是否加密"
          placeholder="是否加密"
          request={async () => {
            return [
              {
                label: '否',
                value: false,
              },
              {
                label: '是',
                value: true,
              },
            ];
          }}
        />
        <ProFormText.Password
          label="密码"
          width="md"
          id="password"
          name="password"
          autocomplete="new-password"
          placeholder="请输入密码"
          dependencies={['private']}
          rules={[
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                getFieldValue('private') && !String(value || '').trim()
                  ? Promise.reject(new Error('导入私密文章时必须设置新密码'))
                  : Promise.resolve(),
            }),
          ]}
        />
        <ProFormSelect
          width="md"
          name="hidden"
          id="hidden"
          label="是否隐藏"
          placeholder="是否隐藏"
          request={async () => {
            return [
              {
                label: '否',
                value: false,
              },
              {
                label: '是',
                value: true,
              },
            ];
          }}
        />
        <ProFormTextArea
          name="content"
          label="中文正文"
          id="content"
          fieldProps={{ autoSize: { minRows: 3, maxRows: 5 } }}
        />
        <ProFormTextArea
          name="contentEn"
          label="英文正文"
          id="contentEn"
          fieldProps={{ autoSize: { minRows: 3, maxRows: 5 } }}
        />
      </ModalForm>
    </>
  );
}
