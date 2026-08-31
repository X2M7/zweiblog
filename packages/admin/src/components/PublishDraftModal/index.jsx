import { publishDraft } from '@/services/zwei-blog/api';
import { buildBilingualSavePayload, SUMMARY_MAX_LENGTH } from '@/pages/Editor/bilingualContent';
import { ModalForm, ProFormSelect, ProFormText } from '@ant-design/pro-components';
import { message } from 'antd';
export default function (props) {
  const { title, id, trigger, action, localizedDocument } = props;
  return (
    <>
      <ModalForm
        title={`发布草稿: ${title}`}
        key="publishModal"
        trigger={trigger}
        width={450}
        autoFocusFirstInput
        submitTimeout={3000}
        onFinish={async (values) => {
          if (
            localizedDocument &&
            (localizedDocument.summary?.length > SUMMARY_MAX_LENGTH ||
              localizedDocument.summaryEn?.length > SUMMARY_MAX_LENGTH)
          ) {
            message.error(`中英文摘要均不能超过 ${SUMMARY_MAX_LENGTH} 字符`);
            return false;
          }
          if (localizedDocument && !localizedDocument.title?.trim()) {
            message.error('中文标题不能为空');
            return false;
          }
          if (localizedDocument && !localizedDocument.content?.includes('<!-- more -->')) {
            message.error('中文正文必须包含 <!-- more --> 标记后才能发布');
            return false;
          }
          const { pc, Ctop, ...options } = values;
          await publishDraft(id, {
            ...options,
            ...(localizedDocument ? buildBilingualSavePayload(localizedDocument) : {}),
            password: pc,
            top: Ctop,
          });
          message.success('发布成功！');
          if (action && action.reload) {
            action.reload();
          }
          if (props.onFinish) {
            props.onFinish();
          }
          return true;
        }}
        layout="horizontal"
        labelCol={{ span: 6 }}
      >
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
        <ProFormText
          label="置顶优先级"
          width="md"
          id="top"
          name="Ctop"
          placeholder="留空或0表示不置顶，其余数字越大表示优先级越高"
          autocomplete="new-password"
          fieldProps={{
            autocomplete: 'new-password',
          }}
        />
        <ProFormText
          width="md"
          id="pathname"
          name="pathname"
          label="自定义路径名"
          tooltip="文章发布后的路径将为 /post/[自定义路径名]，如果未设置则使用文章 id 作为路径名"
          placeholder="留空或为空则使用 id 作为路径名"
        />
        <ProFormText.Password
          label="密码"
          width="md"
          autocomplete="new-password"
          id="password"
          name="pc"
          placeholder="请输入密码"
          dependencies={['private']}
          fieldProps={{
            autocomplete: 'new-password',
          }}
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
      </ModalForm>
    </>
  );
}
