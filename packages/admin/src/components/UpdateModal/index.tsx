import {
  getAllCategories,
  getArticleById,
  getTags,
  updateArticle,
  updateDraft,
} from '@/services/zwei-blog/api';
import {
  needsLocalizedMetadataHydration,
  SUMMARY_MAX_LENGTH,
} from '@/pages/Editor/bilingualContent';
import {
  ModalForm,
  ProFormDateTimePicker,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-form';
import { Form, message } from 'antd';
import moment from 'moment';
import { useEffect, useState } from 'react';
import AuthorField from '../AuthorField';
export default function (props: {
  currObj: any;
  setLoading: any;
  onFinish: any;
  type: 'article' | 'draft' | 'about';
}) {
  const { currObj, setLoading, type, onFinish } = props;
  const [form] = Form.useForm();
  const requiresFullArticle = type == 'article' && needsLocalizedMetadataHydration(currObj);
  const [localizedMetadataReady, setLocalizedMetadataReady] = useState(!requiresFullArticle);
  useEffect(() => {
    if (form && form.setFieldsValue) {
      form.resetFields();
      form.setFieldsValue({ ...(currObj || {}), password: undefined });
    }
    setLocalizedMetadataReady(!requiresFullArticle);
  }, [currObj, form, requiresFullArticle]);

  const hydrateLocalizedMetadata = async (visible: boolean) => {
    if (!visible || !requiresFullArticle || !currObj?.id) return;
    setLocalizedMetadataReady(false);
    try {
      const { data } = await getArticleById(currObj.id);
      if (!data) throw new Error('Article detail is unavailable');
      form.setFieldsValue({ ...data, password: undefined });
      setLocalizedMetadataReady(true);
    } catch (err) {
      message.error('加载完整中英文摘要失败，已阻止提交以避免覆盖原数据');
    }
  };
  return (
    <ModalForm
      form={form}
      title="修改信息"
      trigger={
        <a key="button" type="link">
          修改信息
        </a>
      }
      width={640}
      autoFocusFirstInput
      submitTimeout={3000}
      initialValues={{ ...(currObj || {}), password: undefined }}
      onVisibleChange={hydrateLocalizedMetadata}
      submitter={{
        submitButtonProps: {
          loading: requiresFullArticle && !localizedMetadataReady,
        },
      }}
      onFinish={async (values) => {
        if (!currObj || !currObj.id) {
          return false;
        }
        if (requiresFullArticle && !localizedMetadataReady) {
          message.error('完整中英文摘要尚未加载，请稍后再提交');
          return false;
        }
        const submission = { ...values };
        if (type == 'article' && submission.private && !currObj.private && !submission.password) {
          message.error('启用文章加密时必须设置访问密码');
          return false;
        }
        if (!submission.password) {
          delete submission.password;
        }
        setLoading(true);
        if (type == 'article') {
          await updateArticle(currObj?.id, submission);
          onFinish(submission);
          message.success('修改文章成功！');
          setLoading(false);
        } else if (type == 'draft') {
          await updateDraft(currObj?.id, submission);
          onFinish(submission);
          message.success('修改草稿成功！');
          setLoading(false);
        } else {
          return false;
        }

        return true;
      }}
      layout="horizontal"
      labelCol={{ span: 6 }}
      key="editForm"
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
      <ProFormText
        width="md"
        id="titleEn"
        name="titleEn"
        label="英文标题"
        placeholder="可选；填写英文正文时建议同时填写"
      />
      <ProFormTextArea
        width="md"
        id="summary"
        name="summary"
        label="中文摘要"
        placeholder="可选；留空时前台从中文正文自动截取"
        fieldProps={{
          autoSize: { minRows: 2, maxRows: 5 },
          maxLength: SUMMARY_MAX_LENGTH,
          showCount: true,
        }}
      />
      <ProFormTextArea
        width="md"
        id="summaryEn"
        name="summaryEn"
        label="英文摘要"
        placeholder="可选；留空时前台从英文正文自动截取"
        fieldProps={{
          autoSize: { minRows: 2, maxRows: 5 },
          maxLength: SUMMARY_MAX_LENGTH,
          showCount: true,
        }}
      />
      <AuthorField />
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
        tooltip="首次使用请先在站点管理-数据管理-分类管理中添加分类"
        name="category"
        label="分类"
        placeholder="请选择分类"
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
        width="md"
        name="createdAt"
        id="createdAt"
        label="创建时间"
        placeholder="不填默认为此刻"
        showTime={{
          defaultValue: moment('00:00:00', 'HH:mm:ss'),
        }}
      />
      {type == 'article' && (
        <>
          <ProFormText
            width="md"
            id="top"
            name="top"
            label="置顶优先级"
            placeholder="留空或0表示不置顶，其余数字越大表示优先级越高"
          />
          <ProFormText
            width="md"
            id="pathname"
            name="pathname"
            label="自定义路径名"
            tooltip="文章发布后的路径将为 /post/[自定义路径名]，如果未设置则使用文章 id 作为路径名"
            placeholder="留空或为空则使用 id 作为路径名"
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
            placeholder="留空表示保留当前密码"
            dependencies={['private']}
            fieldProps={{ autoComplete: 'new-password' }}
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
          <ProFormText
            width="md"
            id="copyright"
            name="copyright"
            label="版权声明"
            tooltip="设置后会替换掉文章页底部默认的版权声明文字，留空则根据系统设置中的相关选项进行展示"
            placeholder="设置后会替换掉文章底部默认的版权"
          />
          <ProFormText
            width="md"
            id="copyrightEn"
            name="copyrightEn"
            label="英文版权声明"
            tooltip="英文站的自定义版权声明；留空时使用系统生成的英文默认声明"
            placeholder="可选，仅替换英文文章页底部的版权声明"
          />
        </>
      )}
    </ModalForm>
  );
}
