import Editor from '@/components/Editor';
import EditorProfileModal from '@/components/EditorProfileModal';
import PublishDraftModal from '@/components/PublishDraftModal';
import Tags from '@/components/Tags';
import UpdateModal from '@/components/UpdateModal';
import { SaveTip } from '@/components/SaveTip';
import {
  deleteArticle,
  deleteDraft,
  getAbout,
  getArticleById,
  getDraftById,
  getLinkPage,
  updateAbout,
  updateArticle,
  updateDraft,
  updateLinkPage,
} from '@/services/zwei-blog/api';
import { getPathname } from '@/services/zwei-blog/getPathname';
import { parseMarkdownFile, parseObjToMarkdown } from '@/services/zwei-blog/parseMarkdownFile';
import { useCacheState } from '@/services/zwei-blog/useCacheState';
import { DownOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-layout';
import { Button, Dropdown, Input, Menu, message, Modal, Segmented, Space, Tag, Upload } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { history } from 'umi';
import {
  buildBilingualSavePayload,
  createEditorCache,
  getContentLanguageStatus,
  getLanguageFields,
  getLanguageStatus,
  getLocalizedPreviewUrl,
  mergeBilingualMetadata,
  mergeEditorCache,
  normalizeBilingualDocument,
  SUMMARY_MAX_LENGTH,
  selectImportedContent,
  shouldRestoreEditorCache,
} from './bilingualContent';
import { getStandalonePageConfig } from './standalonePageConfig';
import './index.less';

export default function () {
  const [localizedDocument, setLocalizedDocument] = useState(() => normalizeBilingualDocument({}));
  const [activeLanguage, setActiveLanguage] = useState('zh');
  const [currObj, setCurrObj] = useState({});
  const [loading, setLoading] = useState(true);
  const [editorConfig, setEditorConfig] = useCacheState(
    { afterSave: 'stay', useLocalCache: 'close' },
    'editorConfig',
  );
  const editorConfigRef = useRef(editorConfig);
  editorConfigRef.current = editorConfig;
  const type = history.location.query?.type || 'article';
  const standalonePage = getStandalonePageConfig(type);
  const isStandalonePage = Boolean(standalonePage);
  const getCacheKey = () => `${type}-${history.location.query?.id || '0'}`;

  const persistLocalCache = useCallback(
    (document) => {
      if (editorConfig?.useLocalCache == 'open') {
        window.localStorage.setItem(getCacheKey(), JSON.stringify(createEditorCache(document)));
      }
    },
    [editorConfig?.useLocalCache, type],
  );

  const updateLocalizedField = useCallback(
    (field, fieldValue) => {
      setLocalizedDocument((current) => {
        const next = { ...current, [field]: fieldValue };
        persistLocalCache(next);
        return next;
      });
    },
    [persistLocalCache],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [currObj, localizedDocument, type]);
  const onKeyDown = (ev) => {
    let save = false;
    if (ev.metaKey == true && ev.key.toLocaleLowerCase() == 's') {
      save = true;
    }
    if (ev.ctrlKey == true && ev.key.toLocaleLowerCase() == 's') {
      save = true;
    }
    if (save) {
      ev?.preventDefault();
      handleSave();
    }
    return false;
  };

  const typeMap = {
    article: '文章',
    draft: '草稿',
    about: '关于',
    link: '友链',
  };
  const fetchData = useCallback(
    async (noMessage) => {
      setLoading(true);

      const type = history.location.query?.type || 'article';
      const id = history.location.query?.id;
      const cacheString = window.localStorage.getItem(getCacheKey());
      let cacheObj = {};
      try {
        cacheObj = JSON.parse(cacheString || '{}');
      } catch (err) {
        window.localStorage.removeItem(getCacheKey());
      }
      const checkCache = (data) => {
        const clear = () => {
          window.localStorage.removeItem(getCacheKey());
        };
        if (editorConfigRef.current?.useLocalCache == 'close') {
          clear();
          return null;
        }
        if (!shouldRestoreEditorCache(cacheObj, data, data?.updatedAt)) {
          clear();
          return null;
        }
        console.log('[缓存检查] 本地缓存时间晚于服务器更新时间，使用缓存');
        return mergeEditorCache(cacheObj, data);
      };

      if (type == 'about' || type == 'link') {
        const { data } = type == 'link' ? await getLinkPage() : await getAbout();
        const cache = checkCache(data);
        if (cache) {
          if (!noMessage) {
            message.success('从缓存中恢复状态！');
          }
          setLocalizedDocument(cache);
        } else {
          setLocalizedDocument(normalizeBilingualDocument(data));
        }
        document.title = `${getStandalonePageConfig(type)?.title || ''} - ZweiBlog 编辑器`;
        setCurrObj(data);
      }
      if (type == 'article' && id) {
        const { data } = await getArticleById(id);
        const cache = checkCache(data);
        if (cache) {
          setLocalizedDocument(cache);
          if (!noMessage) {
            message.success('从缓存中恢复状态！');
          }
        } else {
          setLocalizedDocument(normalizeBilingualDocument(data));
        }
        document.title = `${data?.title || ''} - ZweiBlog 编辑器`;
        setCurrObj(data);
      }
      if (type == 'draft' && id) {
        const { data } = await getDraftById(id);
        const cache = checkCache(data);
        if (cache) {
          if (!noMessage) {
            message.success('从缓存中恢复状态！');
          }
          setLocalizedDocument(cache);
        } else {
          setLocalizedDocument(normalizeBilingualDocument(data));
        }
        setCurrObj(data);
        document.title = `${data?.title || ''} - ZweiBlog 编辑器`;
      }
      setLoading(false);
    },
    [history, type],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    // 进入默认收起侧边栏
    const el = document.querySelector('.ant-pro-sider-collapsed-button');
    if (el && el.style.paddingLeft != '') {
      el.click();
    }
  }, []);

  const saveFn = async () => {
    const payload = buildBilingualSavePayload(localizedDocument);
    setLoading(true);
    try {
      if (type == 'article') {
        await updateArticle(currObj?.id, payload);
        await fetchData();
        message.success('中英文内容保存成功！');
      } else if (type == 'draft') {
        await updateDraft(currObj?.id, payload);
        await fetchData();
        message.success('中英文草稿保存成功！');
      } else if (type == 'about') {
        await updateAbout({ content: payload.content, contentEn: payload.contentEn });
        await fetchData();
        message.success('中英文关于内容保存成功！');
      } else if (type == 'link') {
        await updateLinkPage({ content: payload.content, contentEn: payload.contentEn });
        await fetchData();
        message.success('中英文友链内容保存成功！');
      }
      if (editorConfig.afterSave && editorConfig.afterSave == 'goBack') {
        history.go(-1);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!isStandalonePage && !localizedDocument.title.trim()) {
      message.error('中文标题不能为空');
      return;
    }
    if (
      localizedDocument.summary.length > SUMMARY_MAX_LENGTH ||
      localizedDocument.summaryEn.length > SUMMARY_MAX_LENGTH
    ) {
      message.error(`中英文摘要均不能超过 ${SUMMARY_MAX_LENGTH} 字符`);
      return;
    }

    const englishStatus =
      isStandalonePage
        ? getContentLanguageStatus(localizedDocument, 'en')
        : getLanguageStatus(localizedDocument, 'en');
    const missingMoreLanguages = [];
    if (['article', 'draft'].includes(type)) {
      if (localizedDocument.content && !localizedDocument.content.includes('<!-- more -->')) {
        missingMoreLanguages.push('中文');
      }
      if (localizedDocument.contentEn && !localizedDocument.contentEn.includes('<!-- more -->')) {
        missingMoreLanguages.push('English');
      }
    }
    let hasTags = ['article', 'draft'].includes(type) && currObj?.tags && currObj.tags.length > 0;
    if (isStandalonePage) {
      hasTags = true;
    }
    const warnings = [];
    if (!hasTags) warnings.push('此文章还没有设置标签。');
    if (missingMoreLanguages.length) {
      warnings.push(
        `${missingMoreLanguages.join(
          '、',
        )}正文没有 <!-- more --> 标记；摘要留空时，列表摘要会自动截取正文。`,
      );
    }
    if (englishStatus == 'partial') {
      warnings.push('英文内容尚不完整；前台应继续回退到中文，直到英文标题和正文都填写完成。');
    }
    Modal.confirm({
      title: '确定保存中英文内容吗？',
      content: warnings.length ? (
        <div style={{ marginTop: 8 }}>
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : undefined,
      onOk: saveFn,
    });
  };
  const handleExport = async () => {
    const exportTitle = isStandalonePage
      ? standalonePage?.title
      : localizedDocument.title || localizedDocument.titleEn || '未命名';
    const md = parseObjToMarkdown({
      ...currObj,
      ...localizedDocument,
      title: exportTitle,
    });
    const data = new Blob([md]);
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exportTitle || '未命名'}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const handleImport = async (file) => {
    setLoading(true);
    try {
      const importedDocument = await parseMarkdownFile(file);
      const content = selectImportedContent(importedDocument, activeLanguage);
      Modal.confirm({
        title: '确认内容',
        content: <Input.TextArea value={content} autoSize={{ maxRows: 10, minRows: 5 }} />,
        onOk: () => {
          const fields = getLanguageFields(activeLanguage);
          updateLocalizedField(fields.content, content);
          message.success(`已导入${activeLanguage == 'en' ? '英文' : '中文'}正文！`);
        },
      });
    } catch (err) {
      message.error('导入失败！请检查文件格式！');
    }
    setLoading(false);
  };
  const actionMenu = (
    <Menu
      items={[
        {
          key: 'resetBtn',
          label: '重置当前语言',
          onClick: () => {
            const fields = getLanguageFields(activeLanguage);
            const serverDocument = normalizeBilingualDocument(currObj);
            setLocalizedDocument((current) => {
              const next = {
                ...current,
                [fields.title]: serverDocument[fields.title],
                [fields.summary]: serverDocument[fields.summary],
                [fields.content]: serverDocument[fields.content],
              };
              persistLocalCache(next);
              return next;
            });
            message.success(`已重置${activeLanguage == 'en' ? '英文' : '中文'}内容！`);
          },
        },
        !isStandalonePage
          ? {
              key: 'updateModalBtn',
              label: (
                <UpdateModal
                  onFinish={(submission) => {
                    setCurrObj((current) => ({
                      ...current,
                      ...submission,
                      updatedAt: new Date().toISOString(),
                    }));
                    setLocalizedDocument((current) => {
                      const next = mergeBilingualMetadata(current, submission);
                      persistLocalCache(next);
                      return next;
                    });
                  }}
                  type={type}
                  currObj={{ ...currObj, ...localizedDocument }}
                  setLoading={setLoading}
                />
              ),
            }
          : null,
        type == 'draft'
          ? {
              key: 'publishBtn',
              label: (
                <PublishDraftModal
                  title={localizedDocument.title || currObj?.title}
                  key="publishModal1"
                  id={currObj?.id}
                  localizedDocument={localizedDocument}
                  trigger={<a key={'publishBtn' + currObj?.id}>发布草稿</a>}
                  onFinish={() => {
                    history.push(`/article`);
                  }}
                />
              ),
            }
          : null,
        {
          key: 'importBtn',
          label: `导入${activeLanguage == 'en' ? '英文' : '中文'}正文`,
          onClick: () => {
            const el = document.querySelector('#importBtn');
            if (el) {
              el.click();
            }
          },
        },
        {
          key: 'exportBtn',
          label: isStandalonePage ? standalonePage?.exportLabel : `导出双语${typeMap[type]}`,
          onClick: handleExport,
        },
        type != 'draft'
          ? {
              key: 'viewFE',
              label: `查看前台`,
              onClick: () => {
                let url = '';
                if (type == 'article') {
                  if (currObj.hidden) {
                    Modal.confirm({
                      title: '此文章为隐藏文章！',
                      content: (
                        <div>
                          <p>
                            隐藏文章在未开启通过 URL 访问的情况下（默认关闭），会出现 404 页面！
                          </p>
                          <p>
                            您可以在{' '}
                            <a
                              onClick={() => {
                                history.push('/site/setting?subTab=layout');
                              }}
                            >
                              布局配置
                            </a>{' '}
                            中修改此项。
                          </p>
                        </div>
                      ),
                      onOk: () => {
                        window.open(
                          getLocalizedPreviewUrl(`/post/${getPathname(currObj)}`, activeLanguage),
                          '_blank',
                        );
                        return true;
                      },
                      okText: '仍然访问',
                      cancelText: '返回',
                    });
                    return;
                  }
                  url = getLocalizedPreviewUrl(`/post/${getPathname(currObj)}`, activeLanguage);
                } else if (standalonePage) {
                  url = getLocalizedPreviewUrl(standalonePage.previewPath, activeLanguage);
                }
                window.open(url, '_blank');
              },
            }
          : undefined,
        !isStandalonePage
          ? {
              key: 'deleteBtn',
              label: `删除${typeMap[type]}`,
              onClick: () => {
                Modal.confirm({
                  title: `确定删除 “${localizedDocument.title || currObj.title}” 吗？`,
                  onOk: async () => {
                    if (type == 'article') {
                      await deleteArticle(currObj.id);
                      message.success('删除文章成功！返回列表页！');
                      history.push('/article');
                    } else if (type == 'draft') {
                      await deleteDraft(currObj.id);
                      message.success('删除草稿成功！返回列表页！');
                      history.push('/draft');
                    }
                  },
                });
              },
            }
          : undefined,
        {
          key: 'settingBtn',
          label: (
            <EditorProfileModal
              value={editorConfig}
              setValue={setEditorConfig}
              trigger={<a key={'editerConfigBtn'}>偏好设置</a>}
            />
          ),
        },
        {
          key: 'clearCacheBtn',
          label: '清理缓存',
          onClick: () => {
            Modal.confirm({
              title: '清理实时保存缓存',
              content:
                '确定清理当前内容的实时保存缓存吗？清理后未保存的内容将会丢失，编辑器内容将重置为服务端返回的最新数据。',
              okText: '确认清理',
              cancelText: '返回',
              onOk: () => {
                window.localStorage.removeItem(getCacheKey());
                setLocalizedDocument(normalizeBilingualDocument(currObj));
                message.success('清除实时保存缓存成功！已重置为服务端返回数据');
              },
            });
          },
        },
        {
          key: 'helpBtn',
          label: '帮助文档',
          onClick: () => {
            window.open(
              'https://github.com/X2M7/zweiblog/blob/main/docs/features/editor.md',
              '_blank',
            );
          },
        },
      ]}
    ></Menu>
  );
  const activeFields = getLanguageFields(activeLanguage);
  const englishStatus =
    isStandalonePage
      ? getContentLanguageStatus(localizedDocument, 'en')
      : getLanguageStatus(localizedDocument, 'en');
  const languageStatus = {
    empty: { color: 'default', text: '未填写' },
    partial: { color: 'orange', text: '未完成' },
    complete: { color: 'green', text: '已完成' },
  }[englishStatus];
  const activeTitle =
    isStandalonePage
      ? standalonePage?.title
      : localizedDocument[activeFields.title] || localizedDocument.title || currObj?.title;
  return (
    <PageContainer
      className="editor-full"
      style={{ overflow: 'hidden' }}
      header={{
        title: (
          <Space>
            <span title={activeTitle}>{activeTitle}</span>
            {!isStandalonePage && (
              <>
                <Tag color="green">{typeMap[type] || '-'}</Tag>
                <Tag color="blue">{currObj?.category || '-'}</Tag>
                <Tags tags={currObj?.tags} />
              </>
            )}
          </Space>
        ),
        extra: [
          <Button key="extraSaveBtn" type="primary" onClick={handleSave}>
            {<SaveTip />}
          </Button>,
          <Button
            key="backBtn"
            onClick={() => {
              history.go(-1);
            }}
          >
            返回
          </Button>,
          <Dropdown key="moreAction" overlay={actionMenu} trigger={['click']}>
            <Button size="middle">
              操作
              <DownOutlined />
            </Button>
          </Dropdown>,
        ],
        breadcrumb: {},
      }}
      footer={null}
    >
      <div className="bilingual-editor-shell">
        <div style={{ height: '0' }}>
          <Upload
            showUploadList={false}
            multiple={false}
            accept={'.md'}
            beforeUpload={handleImport}
            style={{ display: 'none', height: 0 }}
          >
            <a key="importBtn" type="link" style={{ display: 'none' }} id="importBtn">
              导入当前语言正文
            </a>
          </Upload>
        </div>
        <section className="bilingual-editor-meta" aria-label="中英文内容信息">
          <div className="bilingual-editor-toolbar">
            <Segmented
              aria-label="选择编辑语言"
              value={activeLanguage}
              onChange={(language) => setActiveLanguage(language)}
              options={[
                { label: '中文内容', value: 'zh' },
                { label: 'English', value: 'en' },
              ]}
            />
            <div className="bilingual-editor-status">
              <Tag color={languageStatus.color}>英文：{languageStatus.text}</Tag>
              <span>
                {isStandalonePage
                  ? standalonePage?.emptyEnglishHint
                  : '英文标题和正文完整后，前台才会提供英文切换；否则自动显示中文。'}
              </span>
            </div>
          </div>
          {!isStandalonePage && (
            <div className="bilingual-editor-fields">
              <label>
                <span className="bilingual-editor-field-label">
                  {activeLanguage == 'en' ? 'English title' : '中文标题'}
                </span>
                <Input
                  value={localizedDocument[activeFields.title]}
                  onChange={(event) => updateLocalizedField(activeFields.title, event.target.value)}
                  placeholder={
                    activeLanguage == 'en' ? 'Write the English title' : '请输入中文标题'
                  }
                />
              </label>
              <label>
                <span className="bilingual-editor-field-label">
                  {activeLanguage == 'en' ? 'English summary' : '中文摘要'}（可选）
                </span>
                <Input.TextArea
                  value={localizedDocument[activeFields.summary]}
                  onChange={(event) =>
                    updateLocalizedField(activeFields.summary, event.target.value)
                  }
                  placeholder={
                    activeLanguage == 'en'
                      ? 'Write a separate English summary; leave blank to extract it from the body'
                      : '单独编写中文摘要；留空则从正文自动截取'
                  }
                  autoSize={{ minRows: 1, maxRows: 3 }}
                  maxLength={SUMMARY_MAX_LENGTH}
                  showCount
                />
              </label>
            </div>
          )}
        </section>
        <div className="bilingual-editor-body">
          <Editor
            key={`editor-${type}-${activeLanguage}`}
            loading={loading}
            setLoading={setLoading}
            value={localizedDocument[activeFields.content]}
            onChange={(val) => updateLocalizedField(activeFields.content, val)}
          />
        </div>
      </div>
    </PageContainer>
  );
}
