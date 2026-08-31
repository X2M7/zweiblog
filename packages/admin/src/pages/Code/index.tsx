import CodeEditor from '@/components/CodeEditor';
import UploadBtn from '@/components/UploadBtn';
import {
  deleteCustomPageFolder,
  deleteCustomPageFile,
  getCustomPageByPath,
  getCustomPageFileDataByPath,
  getCustomPageFolderTreeByPath,
  renameCustomPageFile,
  updateCustomPage,
  updateCustomPageFileInFolder,
  getPipelineById,
  updatePipelineById,
  getPipelineConfig,
} from '@/services/zwei-blog/api';
import { downloadCustomPageArchive } from '@/services/zwei-blog/customPageExport';
import {
  DeleteOutlined,
  DownloadOutlined,
  DownOutlined,
  EditOutlined,
  ProjectOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-layout';
import {
  Button,
  Dropdown,
  Input,
  Menu,
  message,
  Modal,
  Space,
  Spin,
  Tag,
  Tooltip,
  Tree,
} from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { history } from 'umi';
import PipelineModal from '../Pipeline/components/PipelineModal';
import RunCodeModal from '../Pipeline/components/RunCodeModal';
import {
  countCustomPageDirectoryContents,
  getCustomPageDirectoryKeys,
  getCustomPageFileParent,
  getRenamedCustomPageFileKey,
  isCustomPageKeyWithinDirectory,
  normalizeCustomPageFileKey,
  removeCustomPageTreeNode,
  splitCustomPageFileName,
  validateCustomPageFileBaseName,
} from './customPageFile';
import './index.less';
const { DirectoryTree } = Tree;
const FILE_TREE_WIDTH = 260;

export default function () {
  const [value, setValue] = useState('');
  const [currObj, setCurrObj] = useState<any>({});
  const [node, setNode] = useState<any>();
  const [selectedKeys, setSelectedKeys] = useState<any[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<any[]>([]);
  const [pipelineConfig, setPipelineConfig] = useState<any[]>([]);
  const [pathPrefix, setPathPrefix] = useState('');
  const [treeData, setTreeData] = useState([{ title: 'door', key: '123' }]);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [treeLoading, setTreeLoading] = useState(true);
  const [editorWidth, setEditorWidth] = useState(400);
  const [editorHeight, setEditorHeight] = useState('calc(100vh - 82px)');
  const [renameNode, setRenameNode] = useState<any>();
  const [renameBaseName, setRenameBaseName] = useState('');
  const [fileActionLoading, setFileActionLoading] = useState(false);
  const [projectExportLoading, setProjectExportLoading] = useState(false);
  const projectExportLock = useRef(false);
  const type = history.location.query?.type;
  const path = history.location.query?.path;
  const id = history.location.query?.id;
  const isFolder = type == 'folder';
  const typeMap = {
    file: '单文件页面',
    folder: '多文件页面',
    pipeline: '流水线',
  };

  useEffect(() => {
    getPipelineConfig().then(({ data }) => {
      setPipelineConfig(data);
    });
  }, []);
  const language = useMemo(() => {
    if (type == 'pipeline') {
      return 'javascript';
    }
    if (!node) {
      return 'html';
    }
    const name = node.title;
    if (!name) {
      return 'html';
    }
    const cssArr = ['css', 'less', 'scss'];
    const tsArr = ['ts', 'tsx'];
    const htmlArr = ['html', 'htm'];
    const jsArr = ['js', 'jsx'];
    const m = {
      javascript: jsArr,
      typescript: tsArr,
      html: htmlArr,
      css: cssArr,
    };
    for (const [k, v] of Object.entries(m)) {
      if (v.some((t) => name.includes('.' + t))) {
        return k;
      }
    }
    return 'html';
  }, [node]);

  const onResize = () => {
    updateEditorSize();
  };

  const onClickMenuChangeBtn = () => {
    setTimeout(() => {
      updateEditorSize();
    }, 500);
  };

  useEffect(() => {
    window.addEventListener('resize', onResize);
    const menuBtnEl = document.querySelector('.ant-pro-sider-collapsed-button');
    if (menuBtnEl) {
      menuBtnEl.addEventListener('click', onClickMenuChangeBtn);
    }
    return () => {
      window.removeEventListener('resize', onResize);
      const menuBtnEl = document.querySelector('.ant-pro-sider-collapsed-button');
      if (menuBtnEl) {
        menuBtnEl.removeEventListener('click', onClickMenuChangeBtn);
      }
    };
  }, []);

  const updateEditorSize = () => {
    const el = document.querySelector('.ant-page-header');
    const fullWidthString = window.getComputedStyle(el).width;
    const fullWidth = parseInt(fullWidthString.replace('px', ''));

    const width = isFolder ? fullWidth - 1 - FILE_TREE_WIDTH : fullWidth;

    setEditorWidth(width);

    const HeaderHeightString = window.getComputedStyle(el).height;
    const HeaderHeight = parseInt(HeaderHeightString.replace('px', ''));
    setEditorHeight(`calc(100vh - ${HeaderHeight + 12}px)`);
  };

  const onKeyDown = (ev) => {
    let save = false;
    if (ev.metaKey == true && ev.key.toLocaleLowerCase() == 's') {
      save = true;
    }
    if (ev.ctrlKey == true && ev.key.toLocaleLowerCase() == 's') {
      save = true;
    }
    if (save) {
      event?.preventDefault();
      ev?.preventDefault();
      handleSave();
    }
    return false;
  };

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [currObj, value, type, node, path]);

  useEffect(() => {
    setTimeout(() => {
      updateEditorSize();
    }, 300);
  }, []);

  const fetchFileData = async (node: any) => {
    setEditorLoading(true);
    try {
      const { data } = await getCustomPageFileDataByPath(path, node.key);
      setValue(data);
    } finally {
      setEditorLoading(false);
    }
  };
  const fetchData = useCallback(async () => {
    if (!path && !id) {
      message.error('无有效信息，无法获取数据！');
      return;
    } else {
      if (isFolder) {
        setTreeLoading(true);
        try {
          setCurrObj({ name: path });
          const { data } = await getCustomPageFolderTreeByPath(path);
          if (data) {
            setTreeData(data);
            setExpandedKeys(getCustomPageDirectoryKeys(data));
          }
        } finally {
          setTreeLoading(false);
        }
      } else if (type == 'pipeline') {
        if (!id) {
          message.error('无有效信息，无法获取数据！');
          return;
        }
        setEditorLoading(true);
        const { data } = await getPipelineById(id);
        if (data) {
          setCurrObj(data);
          setValue(data?.script || '');
        }
        setEditorLoading(false);
      } else {
        setEditorLoading(true);
        const { data } = await getCustomPageByPath(path);
        if (data) {
          setCurrObj(data);
          setValue(data?.html || '');
        }
        setEditorLoading(false);
      }
    }
  }, [id, isFolder, path, type]);
  const handleSave = async () => {
    if (type == 'file') {
      setEditorLoading(true);
      await updateCustomPage({ ...currObj, html: value });
      setEditorLoading(false);
      message.success('当前编辑器内文件保存成功！');
    } else if (type == 'pipeline') {
      setEditorLoading(true);
      await updatePipelineById(currObj.id, { script: value });
      setEditorLoading(false);
      message.success('当前编辑器内脚本保存成功！');
    } else {
      if (!node || node.type !== 'file') {
        message.warning('请先在左侧文件树中选择要保存的文件。');
        return;
      }
      setEditorLoading(true);
      try {
        await updateCustomPageFileInFolder(path, node.key, value);
        message.success('当前编辑器内文件保存成功！');
      } finally {
        setEditorLoading(false);
      }
      return;
    }
  };

  const fileActionsDisabled =
    editorLoading ||
    (isFolder && treeLoading) ||
    uploadLoading ||
    fileActionLoading ||
    projectExportLoading;

  const handleExportProject = async () => {
    if (!path || projectExportLock.current) return;
    projectExportLock.current = true;
    setProjectExportLoading(true);
    try {
      const fileName = await downloadCustomPageArchive(path, currObj?.name || path);
      message.success(`项目已导出：${fileName}`);
    } catch (error: any) {
      message.error(error?.data?.message || error?.message || '项目导出失败，请稍后重试。');
    } finally {
      projectExportLock.current = false;
      setProjectExportLoading(false);
    }
  };

  const openRenameModal = (fileNode: any) => {
    if (!fileNode || fileNode.type !== 'file' || fileActionsDisabled) return;
    const { baseName } = splitCustomPageFileName(String(fileNode.title || ''));
    setRenameBaseName(baseName);
    setRenameNode(fileNode);
  };

  const handleRenameFile = async () => {
    if (!renameNode) return;

    const { extension } = splitCustomPageFileName(String(renameNode.title || ''));
    const nextBaseName = renameBaseName;
    const validationError = validateCustomPageFileBaseName(nextBaseName, extension);
    if (validationError) {
      message.error(validationError);
      return;
    }

    setFileActionLoading(true);
    try {
      const { data } = await renameCustomPageFile(path, renameNode.key, nextBaseName);
      const nextName = `${nextBaseName}${extension}`;
      const renamedKey = normalizeCustomPageFileKey(
        data?.filePath || getRenamedCustomPageFileKey(renameNode.key, nextName),
      );
      const currentKey = normalizeCustomPageFileKey(node?.key || '');
      const targetKey = normalizeCustomPageFileKey(renameNode.key);

      if (currentKey === targetKey) {
        const nextNode = {
          ...renameNode,
          key: renamedKey,
          title: nextName,
          parent: getCustomPageFileParent(renamedKey),
        };
        setNode(nextNode);
        setSelectedKeys([renamedKey]);
        setPathPrefix(getCustomPageFileParent(renamedKey));
      }

      setRenameNode(undefined);
      await fetchData();
      message.success(`文件已重命名为 ${nextName}`);
    } catch (error: any) {
      message.error(error?.data?.message || error?.message || '文件重命名失败，请稍后重试。');
    } finally {
      setFileActionLoading(false);
    }
  };

  const handleDeleteFile = (fileNode: any) => {
    if (!fileNode || fileNode.type !== 'file' || fileActionsDisabled) return;
    const targetKey = normalizeCustomPageFileKey(fileNode.key);

    Modal.confirm({
      title: `确定删除文件“${fileNode.title}”吗？`,
      content: (
        <div>
          <div>相对路径：{targetKey}</div>
          <div>删除后不可恢复，当前尚未保存的修改也会丢失。</div>
        </div>
      ),
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setFileActionLoading(true);
        try {
          await deleteCustomPageFile(path, fileNode.key);
          if (normalizeCustomPageFileKey(node?.key || '') === targetKey) {
            setNode(undefined);
            setSelectedKeys([]);
            setValue('');
            setPathPrefix(getCustomPageFileParent(targetKey));
          }
          await fetchData();
          message.success(`文件 ${fileNode.title} 已删除`);
        } catch (error: any) {
          message.error(error?.data?.message || error?.message || '文件删除失败，请稍后重试。');
          throw error;
        } finally {
          setFileActionLoading(false);
        }
      },
    });
  };

  const handleDeleteFolder = (directoryNode: any) => {
    if (!directoryNode || directoryNode.type !== 'directory' || fileActionsDisabled) return;
    const targetKey = normalizeCustomPageFileKey(directoryNode.key);
    const parentKey = getCustomPageFileParent(targetKey);
    const { files, directories } = countCustomPageDirectoryContents(directoryNode);

    Modal.confirm({
      title: `确定删除文件夹“${directoryNode.title}”吗？`,
      content: (
        <div>
          <div>相对路径：{targetKey}</div>
          <div>
            将递归删除其中 {files} 个文件和 {directories} 个子文件夹，删除后不可恢复。
          </div>
        </div>
      ),
      okText: '删除文件夹',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setFileActionLoading(true);
        try {
          await deleteCustomPageFolder(path, directoryNode.key);
          setTreeData((currentTree: any[]) => removeCustomPageTreeNode(currentTree, targetKey));
          setExpandedKeys((keys) =>
            keys.filter((key) => !isCustomPageKeyWithinDirectory(String(key), targetKey)),
          );

          const currentFileKey = normalizeCustomPageFileKey(node?.key || '');
          if (currentFileKey && isCustomPageKeyWithinDirectory(currentFileKey, targetKey)) {
            setNode(undefined);
            setValue('');
          }
          setSelectedKeys((keys) =>
            keys.some((key) => isCustomPageKeyWithinDirectory(String(key), targetKey)) ? [] : keys,
          );
          setPathPrefix((currentPrefix) =>
            isCustomPageKeyWithinDirectory(currentPrefix, targetKey) ? parentKey : currentPrefix,
          );
          message.success(`文件夹 ${directoryNode.title} 已删除`);
        } catch (error: any) {
          message.error(error?.data?.message || error?.message || '文件夹删除失败，请稍后重试。');
          throw error;
        } finally {
          setFileActionLoading(false);
        }
      },
    });
  };

  const renderTreeTitle = (treeNode: any) => (
    <span className="file-tree-node-title">
      <span className="file-tree-node-name" title={String(treeNode.title || '')}>
        {treeNode.title}
      </span>
      {(treeNode.type === 'file' || treeNode.type === 'directory') && (
        <span className="file-tree-node-actions">
          {treeNode.type === 'file' && (
            <Tooltip title="重命名文件">
              <Button
                aria-label={`重命名 ${treeNode.title}`}
                className="file-tree-node-action"
                disabled={fileActionsDisabled}
                icon={<EditOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  openRenameModal(treeNode);
                }}
                size="small"
                type="text"
              />
            </Tooltip>
          )}
          <Tooltip title={treeNode.type === 'directory' ? '递归删除文件夹' : '删除文件'}>
            <Button
              aria-label={`${treeNode.type === 'directory' ? '删除文件夹' : '删除'} ${
                treeNode.title
              }`}
              className="file-tree-node-action file-tree-node-action-danger"
              disabled={fileActionsDisabled}
              icon={<DeleteOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                if (treeNode.type === 'directory') handleDeleteFolder(treeNode);
                else handleDeleteFile(treeNode);
              }}
              size="small"
              type="text"
            />
          </Tooltip>
        </span>
      )}
    </span>
  );

  const actionMenu = (
    <Menu
      items={[
        {
          key: 'saveBtn',
          label: '保存',
          onClick: handleSave,
          disabled: isFolder && (!node || node.type !== 'file' || fileActionsDisabled),
        },
        ...(type == 'pipeline'
          ? [
              {
                key: 'runPipeline',
                label: <RunCodeModal pipeline={currObj} trigger={<a>调试脚本</a>} />,
              },
              {
                key: 'editPipelineInfo',
                label: (
                  <PipelineModal
                    mode="edit"
                    trigger={<a>编辑信息</a>}
                    onFinish={(vals) => {
                      console.log(vals);
                    }}
                    initialValues={currObj}
                  />
                ),
              },
            ]
          : []),
        ...(isFolder
          ? [
              {
                key: 'renameFile',
                label: '重命名当前文件',
                disabled: !node || node.type !== 'file' || fileActionsDisabled,
                onClick: () => openRenameModal(node),
              },
              {
                key: 'deleteFile',
                label: '删除当前文件',
                danger: true,
                disabled: !node || node.type !== 'file' || fileActionsDisabled,
                onClick: () => handleDeleteFile(node),
              },
              {
                key: 'uploadFile',
                label: (
                  <UploadBtn
                    setLoading={setUploadLoading}
                    folder={true}
                    muti={true}
                    customUpload={true}
                    text="上传文件夹"
                    onFinish={(info) => {
                      fetchData();
                    }}
                    url={`/api/admin/customPage/upload?path=${path}`}
                    accept="*"
                    loading={uploadLoading}
                    plainText={true}
                  />
                ),
              },
              {
                key: 'uploadFolder',
                label: (
                  <UploadBtn
                    basePath={pathPrefix}
                    customUpload={true}
                    plainText={true}
                    setLoading={setUploadLoading}
                    folder={false}
                    muti={false}
                    text="上传文件"
                    onFinish={(info) => {
                      fetchData();
                    }}
                    url={`/api/admin/customPage/upload?path=${path}`}
                    accept="*"
                    loading={uploadLoading}
                  />
                ),
              },
            ]
          : []),
        ...(type == 'file'
          ? [
              {
                key: 'view',
                label: '查看',
                onClick: () => {
                  window.open(`/c${path}`);
                },
              },
            ]
          : []),
      ]}
    ></Menu>
  );
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  return (
    <PageContainer
      className="editor-full"
      header={{
        title: (
          <Space>
            <span title={currObj?.name}>{currObj?.name}</span>
            <>
              <Tag color="green">{typeMap[type] || '未知类型'}</Tag>
              {type == 'pipeline' && (
                <>
                  <Tag color="blue">
                    {
                      pipelineConfig?.find((p) => p.eventName == currObj.eventName)
                        ?.eventNameChinese
                    }
                  </Tag>
                  {pipelineConfig?.find((p) => p.eventName == currObj.eventName)?.passive ? (
                    <Tag color="yellow">非阻塞</Tag>
                  ) : (
                    <Tag color="red">阻塞</Tag>
                  )}
                </>
              )}
            </>
          </Space>
        ),
        extra: [
          ...(['file', 'folder'].includes(String(type))
            ? [
                <Button
                  disabled={
                    editorLoading || (isFolder && treeLoading) || uploadLoading || fileActionLoading
                  }
                  icon={<DownloadOutlined />}
                  key="exportProjectBtn"
                  loading={projectExportLoading}
                  onClick={handleExportProject}
                >
                  导出项目
                </Button>,
              ]
            : []),
          <Dropdown key="moreAction" overlay={actionMenu} trigger={['click']}>
            <Button size="middle" type="primary">
              操作
              <DownOutlined />
            </Button>
          </Dropdown>,
          <Button
            key="backBtn"
            onClick={() => {
              history.go(-1);
            }}
          >
            返回
          </Button>,
          <Button
            key="docBtn"
            onClick={() => {
              if (type == 'pipeline') {
                window.open(
                  'https://github.com/X2M7/zweiblog/blob/main/docs/features/pipeline.md',
                  '_blank',
                );
              } else {
                window.open(
                  'https://github.com/X2M7/zweiblog/blob/main/docs/advanced/custom-page.md',
                  '_blank',
                );
              }
            }}
          >
            文档
          </Button>,
        ],
        breadcrumb: {},
      }}
      footer={null}
    >
      <div style={{ height: '100%', display: 'flex' }} className="code-editor-content">
        {isFolder && (
          <>
            <Spin spinning={treeLoading}>
              <div
                className="file-tree-container"
                onClick={(ev) => {
                  const container = document.querySelector('.file-tree-container')!;
                  const tree = document.querySelector('.ant-tree-list')!;
                  if (ev.target == container || ev.target == tree) {
                    setSelectedKeys([]);
                    setPathPrefix('');
                    setNode(undefined);
                    setValue('');
                  }
                }}
                style={{
                  width: `${FILE_TREE_WIDTH}px`,
                  height: editorHeight,
                  background: 'white',
                }}
              >
                <div className="file-tree-heading">
                  <ProjectOutlined />
                  <span>项目树</span>
                </div>
                {/* <div className="toolbar">
                  <div className="left"> {path}</div>
                  <div className="right">
                    <div
                      className="action-icon"
                      onClick={async () => {
                        setTreeLoading(true);
                        await createCustomFile(path, pathPrefix);
                        setTreeLoading(false);
                        fetchData();
                      }}
                    >
                      <Tooltip title="新建文件">
                        <FileAddOutlined />
                      </Tooltip>
                    </div>
                    <div
                      className="action-icon"
                      onClick={async () => {
                        setTreeLoading(true);
                        await createCustomFolder(path, pathPrefix);
                        setTreeLoading(false);
                        fetchData();
                      }}
                    >
                      <Tooltip title="新建文件夹">
                        <FolderAddOutlined />
                      </Tooltip>
                    </div>
                  </div>
                </div> */}
                <DirectoryTree
                  className="file-tree"
                  blockNode
                  expandedKeys={expandedKeys}
                  onExpand={(keys) => setExpandedKeys(keys)}
                  selectedKeys={selectedKeys}
                  titleRender={renderTreeTitle}
                  // onRightClick={({ event, node }) => {
                  //   console.log(event);
                  // }}
                  onSelect={(keys, info) => {
                    if (editorLoading) {
                      message.warning('加载中请勿选择!');
                      return;
                    }
                    const selectedNode = info.node as any;

                    if (selectedNode.type == 'file') {
                      const normalizedKey = normalizeCustomPageFileKey(selectedNode.key);
                      const normalizedNode = { ...selectedNode, key: normalizedKey };
                      setSelectedKeys([normalizedKey]);
                      fetchFileData(normalizedNode);
                      setNode(normalizedNode);
                      setPathPrefix(getCustomPageFileParent(normalizedKey));
                    } else {
                      setSelectedKeys(keys);
                      setNode(undefined);
                      setValue('');
                      setPathPrefix(normalizeCustomPageFileKey(selectedNode.key));
                    }
                  }}
                  treeData={treeData}
                />
              </div>
            </Spin>
            <div className="divider-v"></div>
          </>
        )}
        <Spin spinning={editorLoading}>
          <CodeEditor
            value={value}
            onChange={setValue}
            language={language}
            width={editorWidth}
            height={editorHeight}
          />
        </Spin>
      </div>
      <Modal
        cancelButtonProps={{ disabled: fileActionLoading }}
        cancelText="取消"
        confirmLoading={fileActionLoading}
        destroyOnClose
        okText="重命名"
        onCancel={() => {
          if (!fileActionLoading) setRenameNode(undefined);
        }}
        onOk={handleRenameFile}
        title={`重命名文件“${renameNode?.title || ''}”`}
        visible={Boolean(renameNode)}
      >
        <Input
          addonAfter={
            splitCustomPageFileName(String(renameNode?.title || '')).extension || undefined
          }
          autoFocus
          disabled={fileActionLoading}
          maxLength={255}
          onChange={(event) => setRenameBaseName(event.target.value)}
          onPressEnter={() => {
            if (!fileActionLoading) handleRenameFile();
          }}
          placeholder="请输入新的文件名"
          value={renameBaseName}
        />
        <div className="rename-file-help">扩展名和所在目录保持不变。</div>
      </Modal>
    </PageContainer>
  );
}
