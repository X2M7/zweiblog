import { createDraft, getAllCategories, getTags } from '@/services/zwei-blog/api';
import { SUMMARY_MAX_LENGTH } from '@/pages/Editor/bilingualContent';
import {
  ModalForm,
  ProFormDateTimePicker,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { Button } from 'antd';
import moment from 'moment';
import AuthorField from '../AuthorField';
export default function (props) {
  const { onFinish } = props;
  return (
    <ModalForm
      title="新建草稿"
      trigger={
        <Button key="button" type="primary">
          新建草稿
        </Button>
      }
      width={640}
      autoFocusFirstInput
      submitTimeout={3000}
      onFinish={async (values) => {
        const washedValues = {};
        for (const [k, v] of Object.entries(values)) {
          washedValues[k.replace('C', '')] = v;
        }

        const { data } = await createDraft(washedValues);
        if (onFinish) {
          onFinish(data);
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
        id="titleC"
        name="titleC"
        label="文章标题"
        placeholder="请输入标题"
        rules={[{ required: true, message: '这是必填项' }]}
      />
      <ProFormText
        width="md"
        id="titleEnC"
        name="titleEnC"
        label="英文标题"
        placeholder="可选，稍后也可在双语编辑器中填写"
      />
      <ProFormTextArea
        width="md"
        id="summaryC"
        name="summaryC"
        label="中文摘要"
        placeholder="可选；留空则从中文正文自动截取"
        fieldProps={{
          autoSize: { minRows: 2, maxRows: 4 },
          maxLength: SUMMARY_MAX_LENGTH,
          showCount: true,
        }}
      />
      <ProFormTextArea
        width="md"
        id="summaryEnC"
        name="summaryEnC"
        label="英文摘要"
        placeholder="可选；留空则从英文正文自动截取"
        fieldProps={{
          autoSize: { minRows: 2, maxRows: 4 },
          maxLength: SUMMARY_MAX_LENGTH,
          showCount: true,
        }}
      />
      <AuthorField />
      <ProFormSelect
        mode="tags"
        tokenSeparators={[',']}
        width="md"
        name="tagsC"
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
        id="categoryC"
        name="categoryC"
        label="分类"
        tooltip="首次使用请先在站点管理-数据管理-分类管理中添加分类"
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
        name="createdAtC"
        id="createdAtC"
        label="创建时间"
        placeholder="不填默认为此刻"
        showTime={{
          defaultValue: moment('00:00:00', 'HH:mm:ss'),
        }}
      />
    </ModalForm>
  );
}
