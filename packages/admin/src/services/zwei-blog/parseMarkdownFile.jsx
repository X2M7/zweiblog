import { getAllCategories } from '@/services/zwei-blog/api';
import { message, Modal } from 'antd';
import fm from 'front-matter';

const parsePrivateAttribute = (value) => {
  if (value === undefined || value === null || value === false || value === 0) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized || ['false', '0', 'no', 'off', 'null'].includes(normalized)) return false;
    // Common true values and every other non-empty, unrecognized value fail
    // closed. A malformed privacy marker must never make an export public.
    return true;
  }
  return true;
};

export const parseMarkdownFile = async (file, allowNotExistCategory) => {
  const name = file.name.split('.')[0];
  const type = file.name.split('.').pop();
  if (type != 'md') {
    Modal.error({ title: '目前仅支持导入 Markdown 文件！' });
    return;
  }
  const txt = await file.text();

  const { attributes, body } = fm(txt);
  const title = attributes?.title || name;
  const titleEn = typeof attributes?.titleEn === 'string' ? attributes.titleEn : '';
  const summary = typeof attributes?.summary === 'string' ? attributes.summary : '';
  const summaryEn = typeof attributes?.summaryEn === 'string' ? attributes.summaryEn : '';
  const contentEn = typeof attributes?.contentEn === 'string' ? attributes.contentEn : '';
  const categoris = attributes?.categories || [];
  let allCategories = undefined;
  try {
    const { data } = await getAllCategories();
    allCategories = data;
  } catch (err) {
    message.error('获取当前分类信息失败！');
    return;
  }
  let category = undefined;
  if (categoris.length > 0 && allCategories?.length > 0) {
    for (const each of categoris) {
      if (allCategories.includes(each)) {
        category = each;
        break;
      }
    }
  }
  const categoryInFile = attributes?.category;
  if (categoryInFile && allCategories.includes(categoryInFile)) {
    category = categoryInFile;
  }
  if (allowNotExistCategory && !category) {
    category = categoris[0] || attributes?.category;
    if (!category) {
      category = undefined;
    }
  }
  const tags = attributes?.tags || [];
  if (attributes?.tag) {
    tags.push(attributes?.tag);
  }
  const top = attributes?.top || 0;
  let createdAt = new Date().toISOString();
  try {
    if (attributes?.date) {
      createdAt = new Date(attributes?.date).toISOString();
    }
  } catch (err) {}
  let updatedAt = new Date().toISOString();
  try {
    if (attributes?.updated) {
      updatedAt = new Date(attributes?.updated).toISOString();
    }
  } catch (err) {}
  const password =
    typeof attributes?.password === 'string' && attributes.password.trim()
      ? attributes.password
      : undefined;
  const explicitPrivate = parsePrivateAttribute(attributes?.private);
  const privateAttr = explicitPrivate || Boolean(password);
  const hidden = attributes?.hidden || attributes?.hide || false;
  const vals = {
    title,
    titleEn,
    summary,
    summaryEn,
    top,
    tags,
    category,
    password,
    private: privateAttr,
    hidden,
    createdAt,
    content: body,
    contentEn,
    updatedAt,
  };
  return vals;
};

export const parseObjToMarkdown = (obj) => {
  const frontmatter = {};
  for (const key of [
    'title',
    'titleEn',
    'summary',
    'summaryEn',
    'contentEn',
    'category',
    'tags',
    'top',
    'updatedAt',
    'createdAt',
    'hidden',
    'private',
  ]) {
    if (Object.keys(obj).includes(key)) {
      if (['updatedAt', 'createdAt'].includes(key)) {
        let date = obj[key];
        try {
          date = new Date(date).toISOString();
        } catch (err) {}
        frontmatter[key] = date;
      } else if (key == 'tags') {
        if (obj[key] && obj[key].length > 0) {
          frontmatter[key] = obj[key];
        }
      } else {
        if (obj[key]) {
          frontmatter[key] = obj[key];
        }
      }
    }
  }
  let result = '---';
  for (const [k, v] of Object.entries(frontmatter)) {
    if (typeof v === 'string' && v.includes('\n')) {
      const block = v
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      result = result + `\n${k}: |-\n${block}`;
    } else {
      result = result + `\n${k}: ${JSON.stringify(v)}`;
    }
  }
  result = result + '\n---\n\n';
  result = result + obj.content;
  return result;
};

export const needsPrivateImportPassword = (obj) =>
  Boolean(obj?.private && !(typeof obj?.password === 'string' && obj.password.trim()));
