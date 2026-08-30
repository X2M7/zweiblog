import { Injectable, Logger } from '@nestjs/common';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import taskLists from 'markdown-it-task-lists';
@Injectable()
export class MarkdownProvider {
  logger = new Logger(MarkdownProvider.name);
  md: MarkdownIt = null;
  constructor() {
    this.md = new MarkdownIt({
      // RSS is consumed by software outside ZweiBlog's frontend sanitizer.
      // Escape author-supplied raw HTML before embedding it in feeds.
      html: false,
      breaks: true,
      linkify: false,
      highlight: (str, lang) => {
        if (lang == 'mermaid') {
          return `<div class="mermaid">${this.md.utils.escapeHtml(str)}</div>`;
        }
        if (lang && hljs.getLanguage(lang)) {
          try {
            return (
              '<pre class="hljs" style="background: #f3f3f3; padding: 8px;><code>' +
              hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
              '</code></pre>'
            );
          } catch (e) {
            console.log(e);
          }
          return (
            '<pre class="hljs" style="background: #f3f3f3;padding: 8px;"><code>' +
            this.md.utils.escapeHtml(str) +
            '</code></pre>'
          );
        }
      },
    }).use(taskLists);
  }
  renderMarkdown(content: string) {
    return this.md.render(content);
  }

  getDescription(content: string) {
    return content.split('<!-- more -->')[0];
  }
}
