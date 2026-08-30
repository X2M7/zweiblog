import gfm from '@bytemd/plugin-gfm';
import highlight from '@bytemd/plugin-highlight-ssr';
import math from '@bytemd/plugin-math-ssr';
import { Viewer } from '@bytemd/react';
import React from 'react';
import 'katex/dist/katex.min.css';
import { sanitizeMarkdownSchema } from '../Markdown/sanitizeSchema';

// Comments intentionally use a smaller plugin surface than articles. In
// particular, untrusted comments cannot invoke Mermaid's diagram runtime.
const plugins = [gfm(), highlight(), math()];
const BLOCKED_MEDIA_TAGS = new Set(['audio', 'picture', 'source', 'video']);

export function sanitizeCommentMarkdownSchema(schema: any) {
  const safe = sanitizeMarkdownSchema(schema);
  return {
    ...safe,
    attributes: {
      ...(safe.attributes || {}),
      // Markdown images need only these attributes. Keeping this list small
      // prevents an untrusted comment from turning an image into an overlay.
      img: ['src', 'alt', 'title'],
    },
    protocols: {
      ...(safe.protocols || {}),
      // Relative URLs remain available for locally uploaded images; absolute
      // sources are limited to ordinary web URLs (never data/javascript).
      src: ['http', 'https'],
    },
    tagNames: Array.from(
      new Set(
        (safe.tagNames || [])
          .filter((name: string) => !BLOCKED_MEDIA_TAGS.has(name.toLowerCase()))
          .concat('img'),
      ),
    ),
    strip: Array.from(new Set(
      (safe.strip || [])
        .filter((name: string) => name.toLowerCase() !== 'img')
        .concat(Array.from(BLOCKED_MEDIA_TAGS)),
    )),
  };
}

export default function CommentMarkdown({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <Viewer
        value={content}
        plugins={plugins}
        // Raw HTML is not part of the comment format. Disabling it here keeps
        // user-supplied class names from creating overlays while plugin output
        // (including KaTeX's required classes) remains available to sanitizing.
        remarkRehype={{ allowDangerousHtml: false }}
        sanitize={sanitizeCommentMarkdownSchema}
      />
    </div>
  );
}
