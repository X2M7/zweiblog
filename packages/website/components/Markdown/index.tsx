import { Viewer } from '@bytemd/react';
import React, { useMemo } from 'react';
import gfm from '@bytemd/plugin-gfm';
import highlight from '@bytemd/plugin-highlight-ssr';
import math from '@bytemd/plugin-math-ssr';
import mermaid from '@bytemd/plugin-mermaid';
import { customContainer } from './customContainer';
import 'katex/dist/katex.min.css';
import { customCodeBlock } from './codeBlock';
import { LinkTarget } from './linkTarget';
import { Heading } from './heading';
import { Img } from './img';
import { sanitizeMarkdownSchema } from './sanitizeSchema';
import { useSiteLanguage } from '../../utils/siteLanguage';
import { useSiteConfig } from '../../utils/siteConfig';
import { safeCustomPageIframe } from './safeIframe';
export default function ({ content }: { content: string }) {
  const { language } = useSiteLanguage();
  const { baseUrl } = useSiteConfig();
  const plugins = useMemo(() => [
    gfm(),
    highlight(),
    math(),
    mermaid(),
    customContainer(language),
    customCodeBlock(language),
    LinkTarget(language),
    Heading(),
    Img(),
    safeCustomPageIframe(baseUrl),
  ], [baseUrl, language]);
  return (
    <div className="markdown-body">
      <Viewer
        value={content}
        plugins={plugins}
        remarkRehype={{ allowDangerousHtml: true }}
        sanitize={(schema) => sanitizeMarkdownSchema(schema, baseUrl)}
      />
    </div>
  );
}
