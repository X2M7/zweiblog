import { deleteTag, getTags, updateTag } from '@/services/zwei-blog/api';
import { ModalForm, ProFormText, ProTable } from '@ant-design/pro-components';
import { message, Modal } from 'antd';
import { useRef } from 'react';
const columns = [
  {
    dataIndex: 'name',
    title: '标签名',
    search: true,
    fieldProps: { showSearch: true, placeholder: '请搜索或选择' },
    request: async () => {
      const { data: tags } = await getTags();
      const data = tags.map((each) => ({
        label: each,
        value: each,
      }));
      return data;
    },
    // render: (text) => {
    //   return <span style={{ marginLeft: 8 }}>{text}</span>;
    // },
  },
  {
    dataIndex: 'nameEn',
    title: '英文标签名',
    search: false,
    render: (_, record) => record.nameEn || '-',
  },
  {
    title: '操作',
    valueType: 'option',
    width: 200,
    render: (text, record, _, action) => [
      <a
        key="viewTag"
        onClick={() => {
          window.open(`/tag/${record.name.replace(/#/g, '%23')}`, '_blank');
        }}
      >
        查看
      </a>,
      <ModalForm
        key={`editCateoryC%{${record.name}}`}
        title={`编辑标签 "${record.name}"`}
        trigger={<a key={'editC' + record.name}>编辑</a>}
        autoFocusFirstInput
        submitTimeout={3000}
        initialValues={{ newName: record.name, nameEn: record.nameEn || '' }}
        onFinish={async (values) => {
          Modal.confirm({
            content:
              values.newName === record.name
                ? `确定更新标签 "${record.name}" 的英文名称吗？`
                : `确定修改标签 "${record.name}" 为 "${values.newName}" 吗？所有文章的该标签都将被更新为新名称!`,
            onOk: async () => {
              await updateTag(record.name, {
                name: values.newName,
                nameEn: values.nameEn || '',
              });
              message.success('标签中英文信息更新成功！');
              action?.reload();
              return true;
            },
          });

          return true;
        }}
      >
        <ProFormText
          width="lg"
          name="newName"
          label="新标签"
          placeholder="请输入新的标签名称"
          tooltip="所有文章的该标签都将被更新为新名称"
          required
          rules={[{ required: true, message: '这是必填项' }]}
        />
        <ProFormText
          width="lg"
          name="nameEn"
          label="英文标签名"
          placeholder="可选；留空时沿用中文标签名"
          fieldProps={{ maxLength: 200 }}
        />
      </ModalForm>,
      <a
        key="delTag"
        onClick={() => {
          Modal.confirm({
            title: '确认删除',
            content: `确认删除该标签吗？所有文章的该标签都将被删除，其他标签不变。`,
            onOk: async () => {
              await deleteTag(record.name);
              message.success('删除成功！所有文章的该标签都将被删除，其他标签不变。');
              action?.reload();
              return true;
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
  const fetchData = async () => {
    const { data: res } = await getTags(true);
    return res.map((item) => ({
      key: item.name,
      ...item,
    }));
  };
  const actionRef = useRef();
  return (
    <>
      <ProTable
        rowKey="name"
        columns={columns}
        dateFormatter="string"
        actionRef={actionRef}
        search={{
          collapseRender: () => {
            return null;
          },
          collapsed: false,
        }}
        options={false}
        request={async (params = {}) => {
          let data = await fetchData();
          if (params?.name) {
            data = data.filter((item) => item.name === params.name);
          }
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
    </>
  );
}
