import { Viewer } from '@bytemd/react';
import React from 'react';
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
const plugins = [
  gfm(),
  highlight(),
  math(),
  mermaid(),
  customContainer(),
  customCodeBlock(),
  LinkTarget(),
  Heading(),
  Img(),
];
export default function ({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <Viewer
        value={content}
        plugins={plugins}
        remarkRehype={{ allowDangerousHtml: true }}
        sanitize={sanitizeMarkdownSchema}
      />
    </div>
  );
}
