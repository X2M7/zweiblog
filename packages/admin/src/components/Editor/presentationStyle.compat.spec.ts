import { Viewer } from '@bytemd/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sanitizeMarkdownSchema } from './sanitizeSchema';
import { readFileSync } from 'node:fs';

function render(value: string) {
  return renderToStaticMarkup(
    createElement(Viewer, {
      value,
      remarkRehype: { allowDangerousHtml: true },
      sanitize: sanitizeMarkdownSchema,
    }),
  );
}

describe('safe article HTML presentation styles', () => {
  it('keeps editor and website policy sources identical across separate Docker builds', () => {
    const editor = readFileSync(new URL('./presentationStyle.ts', import.meta.url), 'utf8');
    const website = readFileSync(
      new URL('../../../../website/components/Markdown/presentationStyle.ts', import.meta.url),
      'utf8',
    );
    expect(editor).toBe(website);
  });

  it.each([
    'color:navy; background-color:aliceblue',
    'color:rebeccapurple; background:transparent',
    'color:currentColor; border-color:lightgray',
    'color:#1234; background-color:#aabbccdd',
    'color:rgb(12, 34, 56); background:rgba(0, 0, 0, .15)',
    'color:rgb(100%, 0%, 25%); background:rgb(10 20 30 / 50%)',
    'color:hsl(210, 50%, 40%); background-color:hsla(120deg, 50%, 50%, 0.2)',
    'color:hsl(210deg 50% 40% / 75%)',
    'font-size:1.25rem; font-weight:700; font-style:italic; line-height:1.6',
    'font-family:system-ui, sans-serif; font-variant:small-caps',
    'letter-spacing:.05em; word-spacing:2px; text-indent:2em',
    'text-decoration:underline dotted navy; text-transform:uppercase',
    'text-decoration-line:underline line-through; text-decoration-color:#369; text-decoration-thickness:2px',
    'overflow-wrap:anywhere; word-break:break-word; hyphens:auto; text-overflow:ellipsis',
    'border:1px solid #ddd; border-top:2px dashed rgb(12, 34, 56)',
    'border-width:1px 2px; border-style:solid dashed; border-color:red blue',
    'border-top-left-radius:8px; border-radius:8px 12px / 4px 6px',
    'list-style-type:lower-roman; list-style-position:inside',
    'table-layout:fixed; border-collapse:collapse; border-spacing:0; caption-side:bottom',
    'display:inline-flex; flex:1 1 240px; flex-basis:40%; flex-grow:2; flex-shrink:1',
    'justify-content:flex-start; align-items:flex-end; align-self:center; align-content:space-between',
    'row-gap:8px; column-gap:1rem; flex-flow:row wrap',
    'display:inline-grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:1rem',
    'grid-template-columns:120px 1fr 2fr; grid-template-rows:auto auto; grid-auto-flow:row dense',
    'grid-column:1 / span 2; grid-row:span 2; justify-items:center; justify-self:stretch',
    'inline-size:100%; max-inline-size:80ch; margin-inline:auto; padding-block:1rem 2rem',
    'vertical-align:super; object-position:50% 25%; transform:rotate(90deg)',
  ])('preserves supported declarations: %s', (style) => {
    expect(render(`<div style="${style}">content</div>`)).toContain(`style="${style}"`);
  });

  it.each([
    'a',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'small',
    'mark',
    'sub',
    'sup',
    'kbd',
    'abbr',
    'q',
  ])('allows presentation on the semantic <%s> element', (tag) => {
    const html = render(`<${tag} style="color:teal; font-weight:bold">content</${tag}>`);
    expect(html).toContain(`<${tag} style="color:teal; font-weight:bold">content</${tag}>`);
  });

  it.each([
    'background:url(https://attacker.example/track)',
    'background-image:linear-gradient(red, blue)',
    'color:rgb(from red r g b)',
    'color:rgb(var(--x), 0, 0)',
    'color:rgb(0, 0, url(https://attacker.example/x))',
    'color:expression(alert(1))',
    'color:var(--x); font-size:1rem',
    'color:red !important',
    'color:r/**/ed',
    'c\\6flor:red',
    'color:red; position:fixed; inset:0',
    'font-size:20px; z-index:1000',
    'font-size:20px; behavior:url(x.htc)',
    'font-family:serif; -moz-binding:url(x)',
    'width:calc(100vw + 100px)',
    'transform:translate(100vw,100vh)',
    'transform:scale(100)',
    'animation:blink 1s infinite',
    'filter:drop-shadow(0 0 100px red)',
    'box-shadow:0 0 0 100vmax red',
    'content:attr(data-secret)',
    'cursor:url(https://attacker.example/x), auto',
    'grid-template-columns:repeat(1000000, 1fr)',
    'grid-template-columns:repeat(2, repeat(2, 1fr))',
    'grid-template-columns:minmax(1fr, 100px)',
    'color:#fffff',
    'color:redxxx',
    'color:red; @import "https://attacker.example/x"',
    '--secret:red; color:red',
  ])('drops the entire attribute for unsupported CSS: %s', (style) => {
    expect(render(`<div style='${style}'>content</div>`)).not.toContain('style=');
  });

  it('rejects dangerous declarations after HTML entity decoding', () => {
    const html = render(
      '<div style="color:red; background:u&#114;l(https://attacker.example/x)">content</div>',
    );
    expect(html).not.toContain('style=');
  });

  it('bounds style length and declaration count before processing', () => {
    expect(render(`<div style="${'color:red;'.repeat(500)}">long</div>`)).not.toContain('style=');
    expect(render(`<div style="${'color:red;'.repeat(65)}">many</div>`)).not.toContain('style=');
  });

  it('rejects a late invalid declaration without backtracking across valid declarations', () => {
    const style = 'line-height:0;'.repeat(60) + 'position:fixed';
    expect(render(`<div style="${style}">content</div>`)).not.toContain('style=');
  });

  it('does not expand iframe styles', () => {
    const html = render('<iframe src="/c/demo" style="color:teal; font-weight:bold"></iframe>');
    expect(html).toContain('<iframe');
    expect(html).not.toContain('style=');
    expect(html).toContain('sandbox=');
  });
});
