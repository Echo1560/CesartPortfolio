import { render } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { Inline, RichTextView, inlineToPlain } from '../../src/components/render/RichText';
import { RenderCtx, type RenderContext } from '../../src/components/render/context';
import type { InlineText, RichText } from '../../src/lib/schema-v3';

const ctx = { base: '/CesartPortfolio/', pages: [], works: [], categories: [], media: new Map(), site: {} } as unknown as RenderContext;
const html = (node: preact.VNode) => render(<RenderCtx.Provider value={ctx}>{node}</RenderCtx.Provider>);
// The schema also rejects these hrefs; the renderer re-checks them, so feed it unvalidated data.
const doc = (content: InlineText): RichText => ({ type: 'doc', content: [{ type: 'paragraph', content }] }) as RichText;

describe('RichTextView', () => {
  it('escapes script text instead of emitting a tag', () => {
    const out = html(<RichTextView doc={doc([{ type: 'text', text: '<script>alert(1)</script>' }])} />);
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script>alert(1)&lt;/script>');
  });

  it('escapes markup inside a bold mark', () => {
    const out = html(<RichTextView doc={doc([{ type: 'text', text: '<img src=x onerror=alert(1)>', marks: [{ type: 'bold' }] }])} />);
    expect(out).toContain('<strong>&lt;img src=x onerror=alert(1)></strong>');
    expect(out).not.toContain('<img');
  });

  it('drops a javascript: href but keeps the text', () => {
    const out = html(<RichTextView doc={doc([{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }])} />);
    expect(out).not.toContain('<a');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click');
  });

  it('drops a data: href', () => {
    const out = html(<RichTextView doc={doc([{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'data:text/html,<b>' } }] }])} />);
    expect(out).not.toContain('<a');
  });

  it('renders an https link with rel noopener', () => {
    const out = html(<RichTextView doc={doc([{ type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://example.com/a' } }] }])} />);
    expect(out).toContain('<a href="https://example.com/a" rel="noopener noreferrer">site</a>');
  });

  it('prefixes a site-relative link with the base', () => {
    const out = html(<RichTextView doc={doc([{ type: 'text', text: 'go', marks: [{ type: 'link', attrs: { href: '/journal/' } }] }])} />);
    expect(out).toContain('href="/CesartPortfolio/journal/"');
  });

  it('renders nothing for an empty or missing doc', () => {
    expect(html(<RichTextView doc={undefined} />)).toBe('');
    expect(html(<RichTextView doc={{ type: 'doc', content: [] }} />)).toBe('');
  });
});

describe('Inline', () => {
  it('renders a hard break as <br>', () => {
    expect(html(<Inline text={[{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }]} />)).toBe('a<br/>b');
  });

  it('inlineToPlain drops marks and tags', () => {
    expect(inlineToPlain([{ type: 'text', text: '<b>', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: 'x' }])).toBe('<b> x');
  });
});
