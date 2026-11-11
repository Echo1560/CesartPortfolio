import { render } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { BlockList, BlockView } from '../../src/components/render/blocks/Blocks';
import { ButtonLink } from '../../src/components/render/ButtonLink';
import { RenderCtx, type RenderContext } from '../../src/components/render/context';
import { Cta } from '../../src/components/render/sections/Cta';
import { Spacer } from '../../src/components/render/sections/Spacer';
import { SectionFrame } from '../../src/components/render/SectionFrame';
import type { LooseBlock } from '../../src/components/render/types';

const ID = '12345678-aaaa-4bbb-8ccc-1234567890ab';
const ctx = {
  base: '/CesartPortfolio/',
  pages: [{ id: 'p1', slug: 'about', isHome: false, status: 'published' }],
  works: [],
  categories: [],
  media: new Map(),
  site: {},
} as unknown as RenderContext;
const html = (node: preact.VNode) => render(<RenderCtx.Provider value={ctx}>{node}</RenderCtx.Provider>);
const on = { desktop: true, tablet: true, mobile: true };
const text = (t: string) => [{ type: 'text', text: t }];
const section = (over: Record<string, unknown>) => ({ id: ID, type: 'spacer', variant: 'default', visibility: on, settings: {}, content: {}, ...over }) as never;
const block = (type: string, content: unknown, over: Record<string, unknown> = {}): LooseBlock =>
  ({ id: 'b1', type, column: 0, settings: {}, visibility: on, content, ...over }) as unknown as LooseBlock;

describe('SectionFrame', () => {
  it('carries the section id, type and variant class', () => {
    const out = html(<SectionFrame section={section({ type: 'text', variant: 'wide' })}>x</SectionFrame>);
    expect(out).toContain(`data-section-id="${ID}"`);
    expect(out).toContain('data-section-type="text"');
    expect(out).toContain('sec--text-wide');
  });
  it('maps settings to classes and the anchor to an id', () => {
    const out = html(
      <SectionFrame section={section({ settings: { anchor: 'hello', align: 'center', width: 'narrow', paddingTop: 'lg', paddingBottom: 'none', colorScheme: 'inverse' } })}>x</SectionFrame>,
    );
    for (const c of ['align-center', 'w-narrow', 'pt-lg', 'pb-none', 'scheme-inverse']) expect(out).toContain(c);
    expect(out).toContain('id="hello"');
  });
  it('omits the scheme class for the default colour scheme', () => {
    expect(html(<SectionFrame section={section({ settings: { colorScheme: 'default' } })}>x</SectionFrame>)).not.toContain('scheme-');
  });
  it('adds hide classes for the devices where the section is off', () => {
    const out = html(<SectionFrame section={section({ visibility: { desktop: true, tablet: false, mobile: false } })}>x</SectionFrame>);
    expect(out).toContain('hide-tablet');
    expect(out).toContain('hide-mobile');
    expect(out).not.toContain('hide-desktop');
  });
  it('does not add the section padding class when padded is false', () => {
    expect(html(<SectionFrame section={section({})} padded={false}>x</SectionFrame>)).not.toMatch(/class="section /);
  });
});

describe('Spacer', () => {
  it('renders a rule only when divider is on', () => {
    expect(html(<Spacer section={section({ settings: { size: 'md', divider: true } })} />)).toContain('spacer__rule');
    expect(html(<Spacer section={section({ settings: { size: 'md', divider: false } })} />)).not.toContain('spacer__rule');
  });
  it('sets the size class', () => {
    expect(html(<Spacer section={section({ settings: { size: 'xl' } })} />)).toContain('sp-xl');
  });
});

describe('ButtonLink', () => {
  it('renders an anchor with the label and resolved href', () => {
    const out = html(<ButtonLink button={{ label: 'About', link: { kind: 'page', pageId: 'p1' } }} />);
    expect(out).toContain('href="/CesartPortfolio/about/"');
    expect(out).toContain('>About</a>');
  });
  it('renders nothing for a link whose target is gone', () => {
    expect(html(<ButtonLink button={{ label: 'X', link: { kind: 'page', pageId: 'gone' } }} />)).toBe('');
  });
  it('opens new-tab links with rel noopener', () => {
    const out = html(<ButtonLink button={{ label: 'X', link: { kind: 'url', url: 'https://a.b', newTab: true } }} />);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
  it('tags contact buttons for tracking only when a source is given', () => {
    const button = { label: 'Mail', link: { kind: 'url' as const, url: 'mailto:a@b.c' } };
    expect(html(<ButtonLink button={button} trackSource="hero" />)).toContain('data-track="contact_click"');
    expect(html(<ButtonLink button={button} />)).not.toContain('data-track');
  });
  it('uses the ghost style for secondary buttons', () => {
    expect(html(<ButtonLink button={{ label: 'X', style: 'secondary', link: { kind: 'anchor', anchor: 'a' } }} />)).toContain('btn--ghost');
  });
});

describe('Cta', () => {
  it('renders the heading, body and its buttons, skipping unresolved ones', () => {
    const out = html(
      <Cta
        section={section({
          type: 'cta',
          content: {
            heading: text('Have a project?'),
            body: { type: 'doc', content: [{ type: 'paragraph', content: text('Say hi') }] },
            buttons: [
              { label: 'Good', link: { kind: 'anchor', anchor: 'contact' } },
              { label: 'Broken', link: { kind: 'page', pageId: 'gone' } },
            ],
          },
        })}
      />,
    );
    expect(out).toContain('Have a project?');
    expect(out).toContain('Say hi');
    expect(out).toContain('>Good</a>');
    expect(out).not.toContain('Broken');
  });
});

describe('BlockView', () => {
  it('renders a heading at its level', () => {
    expect(html(<BlockView block={block('heading', { text: text('Hi'), level: 3 })} />)).toContain('<h3 class="block__heading">Hi</h3>');
  });
  it('renders nothing for an empty heading', () => {
    expect(html(<BlockView block={block('heading', { text: [], level: 2 })} />)).toBe('');
  });
  it('escapes markup in a quote', () => {
    const out = html(<BlockView block={block('quote', { text: text('<b>x</b>'), attribution: '<i>me</i>' })} />);
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('<i>');
    expect(out).toContain('&lt;b>x&lt;/b>');
  });
  it('renders dividers and spacers', () => {
    expect(html(<BlockView block={block('divider', {})} />)).toContain('block__rule');
    expect(html(<BlockView block={block('spacer', { size: 'lg' })} />)).toContain('sp-lg');
  });
  it('applies block settings and device visibility classes', () => {
    const b = block('divider', {}, { settings: { align: 'right', marginTop: 'sm' }, visibility: { desktop: false, tablet: true, mobile: true } });
    const out = html(<BlockView block={b} />);
    expect(out).toContain('align-right');
    expect(out).toContain('mt-sm');
    expect(out).toContain('hide-desktop');
  });
});

describe('BlockList', () => {
  const blocks = [
    block('heading', { text: text('A'), level: 2 }, { id: 'a', column: 0 }),
    block('heading', { text: text('B'), level: 2 }, { id: 'b', column: 1 }),
    block('heading', { text: text('C'), level: 2 }, { id: 'c', column: 0 }),
  ];
  it('shows only the blocks of the requested column, in order', () => {
    const out = html(<BlockList blocks={blocks} column={0} />);
    expect(out.indexOf('>A<')).toBeLessThan(out.indexOf('>C<'));
    expect(out).not.toContain('>B<');
  });
  it('renders nothing when there are no blocks', () => {
    expect(html(<BlockList blocks={undefined} />)).toBe('');
  });
});
