import { deleteLink, getLink, updateLink, updateLinkOrder } from '@/services/zwei-blog/api';
import { EditableProTable } from '@ant-design/pro-components';
import { Button, message, Modal, Spin } from 'antd';
import { useRef, useState } from 'react';
import { canMoveLinkName, isLinkOrderingLocked, moveLinkName } from './linkOrder';

export default function () {
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState(false);
  const [links, setLinks] = useState([]);
  const [editableKeys, setEditableRowKeys] = useState([]);
  const actionRef = useRef();
  const orderingRef = useRef(false);
  const fetchData = async () => {
    setLoading(true);
    const { data } = await getLink();
    const nextLinks = data.map((item) => ({ key: item.name, ...item }));
    setLinks(nextLinks);
    setLoading(false);
    return nextLinks;
  };
  const moveLink = async (name, direction, action) => {
    const names = links.map((link) => link.name);
    if (
      isLinkOrderingLocked(editableKeys, orderingRef.current) ||
      !canMoveLinkName(names, name, direction)
    ) {
      return;
    }
    orderingRef.current = true;
    setOrdering(true);
    try {
      await updateLinkOrder(moveLinkName(names, name, direction));
      message.success('友链顺序已更新');
    } finally {
      try {
        await action?.reload?.();
      } finally {
        orderingRef.current = false;
        setOrdering(false);
      }
    }
  };
  const columns = [
    {
      title: '伙伴名',
      dataIndex: 'name',
      formItemProps: (form, { rowIndex }) => {
        return {
          rules: [{ required: true, message: '此项为必填项' }],
        };
      },
    },
    {
      title: '伙伴名（英文）',
      dataIndex: 'nameEn',
      fieldProps: { maxLength: 200 },
    },
    {
      title: '地址',
      dataIndex: 'url',
      formItemProps: (form, { rowIndex }) => {
        return {
          rules: [{ required: true, message: '此项为必填项' }],
        };
      },
    },
    {
      title: '简介',
      dataIndex: 'desc',
      formItemProps: (form, { rowIndex }) => {
        return {
          rules: [{ required: true, message: '此项为必填项' }],
        };
      },
    },
    {
      title: '简介（英文）',
      dataIndex: 'descEn',
      fieldProps: { maxLength: 2000 },
    },
    {
      title: 'Logo',
      dataIndex: 'logo',
      formItemProps: (form, { rowIndex }) => {
        return {
          rules: [{ required: true, message: '此项为必填项' }],
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
      width: 280,
      render: (text, record, _, action) => {
        const names = links.map((link) => link.name);
        const orderingLocked = isLinkOrderingLocked(editableKeys, ordering);
        return [
          <Button
            disabled={orderingLocked || !canMoveLinkName(names, record.name, 'up')}
            key="move-up"
            onClick={() => moveLink(record.name, 'up', action)}
            size="small"
            type="link"
          >
            上移
          </Button>,
          <Button
            disabled={orderingLocked || !canMoveLinkName(names, record.name, 'down')}
            key="move-down"
            onClick={() => moveLink(record.name, 'down', action)}
            size="small"
            type="link"
          >
            下移
          </Button>,
          <a
            key="editable"
            onClick={() => {
              action?.startEditable?.(record.name);
            }}
          >
            编辑
          </a>,
          <a
            key="delete"
            onClick={async () => {
              Modal.confirm({
                onOk: async () => {
                  await deleteLink(record.name);
                  action?.reload();
                },
                title: `确认删除"${record.name}"吗?`,
              });
            }}
          >
            删除
          </a>,
        ];
      },
    },
  ];
  return (
    <>
      <Spin spinning={loading}>
        <EditableProTable
          rowKey="key"
          headerTitle="友情链接"
          actionRef={actionRef}
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
                name: data.name,
                nameEn: data.nameEn || '',
                url: data.url,
                logo: data.logo,
                desc: data.desc,
                descEn: data.descEn || '',
              };
              await updateLink(toSaveObj);
              // await waitTime(500);
              actionRef?.current?.reload();
            },
            onChange: setEditableRowKeys,
          }}
        />
      </Spin>
    </>
  );
}
