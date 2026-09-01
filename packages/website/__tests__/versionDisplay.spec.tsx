import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PoweredBy } from '../components/Footer';
import { getLayoutProps } from '../utils/getLayoutProps';

describe('application version display', () => {
  it('passes the API application version through the layout to the footer', () => {
    const layout = getLayoutProps({
      version: 'v1.0.0',
      tags: [],
      totalArticles: 0,
      totalWordCount: 0,
      menus: [],
      meta: {
        categories: [],
        links: [],
        rewards: [],
        socials: [],
        about: { content: '', updatedAt: '' },
        siteInfo: {},
      },
    } as any);

    const html = renderToStaticMarkup(<PoweredBy version={layout.version} />);

    expect(layout.version).toBe('v1.0.0');
    expect(html).toContain('ZweiBlog <span>v1.0.0</span>');
    expect(html).not.toContain('ZweiBlog <span>latest</span>');
  });
});
