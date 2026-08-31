import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStandalonePageConfig,
  getStandalonePageEditorPath,
  standalonePageEditorActions,
} from './standalonePageConfig';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock('umi', () => ({ request: requestMock }));

import { getLinkPage, updateLinkPage } from '../../services/zwei-blog/api';

describe('friend-link page editor configuration', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ data: {} });
  });

  it('places the friend-link editor immediately before the about editor', () => {
    expect(standalonePageEditorActions.map((item) => item.buttonLabel)).toEqual([
      '编辑友链',
      '编辑关于',
    ]);
    expect(getStandalonePageEditorPath('link')).toBe('/editor?type=link&id=0');
  });

  it('provides the friend-link title and localized preview route', () => {
    expect(getStandalonePageConfig('link')).toMatchObject({
      title: '友链',
      exportLabel: '导出友链',
      previewPath: '/link',
    });
    expect(getStandalonePageConfig('article')).toBeUndefined();
  });

  it('uses the dedicated bilingual friend-link page API', async () => {
    await getLinkPage();
    expect(requestMock).toHaveBeenLastCalledWith('/api/admin/meta/link/page', {
      method: 'GET',
    });

    const body = { content: '中文友链正文', contentEn: 'English friends body' };
    await updateLinkPage(body);
    expect(requestMock).toHaveBeenLastCalledWith('/api/admin/meta/link/page', {
      method: 'PUT',
      data: body,
    });
  });
});
