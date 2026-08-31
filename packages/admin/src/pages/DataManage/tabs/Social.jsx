import { deleteSocial, getSocial, getSocialTypes, updateSocial } from '@/services/zwei-blog/api';
import { EditableProTable } from '@ant-design/pro-components';
import { Modal, Spin } from 'antd';
import { useRef, useState } from 'react';
import {
  filterSocialTypeOption,
  getSocialTypeLabel,
  getSocialValueGuidance,
  normalizeSocialTypeOptions,
  SOCIAL_VALUE_MAX_LENGTH,
} from './socialField';

export default function () {
  const [loading, setLoading] = useState(true);
  const [editableKeys, setEditableRowKeys] = useState([]);
  const [socialTypeOptions, setSocialTypeOptions] = useState([]);
  const actionRef = useRef();
  const socialTypeOptionsRef = useRef([]);

  const fetchSocialTypes = async () => {
    const { data } = await getSocialTypes();
    const options = normalizeSocialTypeOptions(data);
    socialTypeOptionsRef.current = options;
    setSocialTypeOptions(options);
    return options;
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [{ data }] = await Promise.all([getSocial(), fetchSocialTypes()]);
      return (data || []).map((item) => ({ key: item.type, ...item }));
    } finally {
      setLoading(false);
    }
  };
  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      valueType: 'select',
      width: 240,
      formItemProps: () => {
        return {
          rules: [{ required: true, message: '此项为必填项' }],
        };
      },
      fieldProps: {
        showSearch: true,
        optionFilterProp: 'label',
        filterOption: filterSocialTypeOption,
        placeholder: '请选择或搜索联系方式类型',
      },
      request: async () => {
        if (socialTypeOptionsRef.current.length) return socialTypeOptionsRef.current;
        return fetchSocialTypes();
      },
      render: (_, record) => getSocialTypeLabel(socialTypeOptions, record.type),
    },
    {
      title: '值',
      dataIndex: 'value',
      width: 520,
      formItemProps: (form, { rowKey }) => {
        const type = form?.getFieldValue?.(rowKey)?.type;
        const guidance = getSocialValueGuidance(type);
        return {
          extra: guidance.help,
          rules: [
            { required: true, message: '此项为必填项' },
            {
              max: SOCIAL_VALUE_MAX_LENGTH,
              message: `最多可填写 ${SOCIAL_VALUE_MAX_LENGTH} 个字符`,
            },
          ],
        };
      },
      fieldProps: (form, { rowKey }) => {
        const type = form?.getFieldValue?.(rowKey)?.type;
        const guidance = getSocialValueGuidance(type);
        return {
          maxLength: SOCIAL_VALUE_MAX_LENGTH,
          showCount: true,
          placeholder: guidance.placeholder,
        };
      },
    },
    {
      title: '最后设置时间',
      valueType: 'date',
      editable: false,
      dataIndex: 'updatedAt',
      formItemProps: (form, { rowIndex }) => {
        return {
          rules: [{ required: true, message: '此项为必填项' }],
        };
      },
    },
    {
      title: '操作',
      valueType: 'option',
      key: 'option',
      width: 200,
      render: (text, record, _, action) => [
        <a
          key="editable"
          onClick={() => {
            action?.startEditable?.(record.type);
          }}
        >
          编辑
        </a>,
        <a
          key="delete"
          onClick={async () => {
            Modal.confirm({
              onOk: async () => {
                await deleteSocial(record.type);
                action?.reload();
              },
              title: `确认删除"${getSocialTypeLabel(socialTypeOptions, record.type)}"吗?`,
            });
          }}
        >
          删除
        </a>,
      ],
    },
  ];
  return (
    <>
      <Spin spinning={loading}>
        <EditableProTable
          actionRef={actionRef}
          rowKey="key"
          headerTitle="联系方式"
          scroll={{
            x: 960,
          }}
          recordCreatorProps={{
            position: 'bottom',
            record: () => ({ key: Date.now() }),
          }}
          loading={false}
          columns={columns}
          request={async () => {
            let data = await fetchData();

            return {
              data,
              success: true,
            };
          }}
          editable={{
            type: 'multiple',
            editableKeys,
            onSave: async (rowKey, data, row) => {
              const toSaveObj = {
                type: data.type,
                value: data.value,
              };
              await updateSocial(toSaveObj);
              actionRef?.current?.reload();
            },
            onChange: setEditableRowKeys,
          }}
        />
      </Spin>
    </>
  );
}
