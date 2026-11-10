/**
 * What a new section or block starts with, plus the names, descriptions and wireframe
 * thumbnails the pickers show. Every default must pass `sectionDraftSchema` /
 * `blockDraftSchema` once its media is a reference (a unit test checks all of them).
 */
import type { BlockType, InlineText, RichText, SectionType } from '../../lib/schema-v3';
import { BLOCK_TYPES, FLEXIBLE_SECTION_TYPES, SECTION_TYPES } from '../../lib/schema-v3';
import type { Work } from '../../lib/schema';
import type { LooseBlock, LooseSection } from '../../components/render/types';

export const SECTION_INFO: Record<SectionType, { label: string; description: string }> = {
  hero: { label: 'Hero', description: 'A big opening with a heading, a line of text and an image.' },
  text: { label: 'Text', description: 'Headings, paragraphs and more, stacked in one column.' },
  image: { label: 'Image / GIF', description: 'One picture or animation, with an optional caption.' },
  gallery: { label: 'Gallery grid', description: 'Your works in a grid, with category filters.' },
  featured: { label: 'Featured works', description: 'A handpicked selection of works.' },
  about: { label: 'About', description: 'A heading, your story and a portrait.' },
  contact: { label: 'Contact', description: 'Your email and social links.' },
  columns: { label: 'Columns', description: '2 to 4 columns that hold text, images and buttons.' },
  spacer: { label: 'Spacer', description: 'Empty space, with an optional line.' },
  cta: { label: 'Call to action', description: 'A short message and a button.' },
  'works-list': { label: 'Works list', description: 'Your works as a list of rows or cards.' },
};

export const BLOCK_INFO: Record<BlockType, { label: string; description: string }> = {
  heading: { label: 'Heading', description: 'A title, level 1 to 4.' },
  paragraph: { label: 'Paragraph', description: 'Text with bold, italic, links and lists.' },
  image: { label: 'Image / GIF', description: 'A picture or animation from the library.' },
  button: { label: 'Button', description: 'A link that looks like a button.' },
  divider: { label: 'Divider', description: 'A thin line.' },
  spacer: { label: 'Spacer', description: 'Empty space.' },
  quote: { label: 'Quote', description: 'A highlighted quote.' },
  video: { label: 'Video', description: 'A video file from the library (MP4 or WebM).' },
};

/** Types that need a library file before they can exist. */
export const NEEDS_MEDIA: { section: SectionType[]; block: BlockType[] } = { section: ['image'], block: ['image', 'video'] };

export const text = (s: string): InlineText => [{ type: 'text', text: s }];
const rich = (s: string): RichText => ({ type: 'doc', content: [{ type: 'paragraph', content: text(s) }] });
const ALL = { desktop: true, tablet: true, mobile: true };
export const newId = (): string => crypto.randomUUID();

export interface NewContext {
  works: Pick<Work, 'id'>[];
  /** Contact email already used on the site. */
  email?: string;
  /** Resolved media for types that need one (`image`). */
  media?: Record<string, unknown>;
}

export function newBlock(type: BlockType, column: number, media?: Record<string, unknown>): LooseBlock {
  const content: Record<BlockType, () => unknown> = {
    heading: () => ({ text: text('New heading'), level: 2 }),
    paragraph: () => ({ text: rich('Write something here. Click the text to edit it.') }),
    image: () => ({ media }),
    button: () => ({ label: 'Button', link: { kind: 'url', url: '/' }, style: 'primary' }),
    divider: () => ({}),
    spacer: () => ({ size: 'md' }),
    quote: () => ({ text: text('A line worth quoting.') }),
    video: () => ({ media, controls: true }),
  };
  return { id: newId(), type, column, settings: {}, content: content[type](), visibility: { ...ALL } };
}

export function newSection(type: SectionType, ctx: NewContext): LooseSection {
  const featured = ctx.works.slice(0, 3).map((w) => w.id);
  const base: Record<SectionType, () => { settings: unknown; content: unknown; blocks?: LooseBlock[] }> = {
    hero: () => ({ settings: {}, content: { heading: text('A new headline'), subheading: text('A line that says what this is about.') } }),
    text: () => ({ settings: {}, content: {}, blocks: [newBlock('heading', 0), newBlock('paragraph', 0)] }),
    image: () => ({ settings: {}, content: { media: ctx.media } }),
    gallery: () => ({ settings: { source: { kind: 'all' }, sort: 'default', columns: { sm: 1, md: 2, lg: 3 }, showFilters: true }, content: { heading: text('Work') } }),
    featured: () => ({ settings: { workIds: featured }, content: { heading: text('Featured') } }),
    about: () => ({ settings: {}, content: { heading: text('About'), body: rich('Tell your story here.') } }),
    contact: () => ({ settings: { showEmail: true, showSocials: true }, content: { heading: text('Contact'), email: ctx.email || 'hello@example.com', ctaLabel: 'Write me' } }),
    columns: () => ({ settings: { columns: 2 }, content: {}, blocks: [newBlock('paragraph', 0), newBlock('paragraph', 1)] }),
    spacer: () => ({ settings: { size: 'lg' }, content: {} }),
    cta: () => ({ settings: {}, content: { heading: text('Have a project in mind?'), buttons: [{ label: 'Get in touch', link: { kind: 'url', url: '/' }, style: 'primary' }] } }),
    'works-list': () => ({ settings: { source: { kind: 'all' }, sort: 'default', showYear: true, showCategory: true, showThumbnail: true }, content: { heading: text('All works') } }),
  };
  const made = base[type]();
  return { id: newId(), type, variant: 'default', settings: made.settings, content: made.content, visibility: { ...ALL }, ...(made.blocks ? { blocks: made.blocks } : {}) } as LooseSection;
}

export const ALL_SECTION_TYPES = SECTION_TYPES;
export const ALL_BLOCK_TYPES = BLOCK_TYPES;
export const isFlexible = (type: string): boolean => (FLEXIBLE_SECTION_TYPES as readonly string[]).includes(type);

/** A deep copy with fresh ids, for duplicating. Anchors are dropped: they must stay unique on a page. */
export function copySection(s: LooseSection): LooseSection {
  const c = structuredClone(s);
  c.id = newId();
  const settings = c.settings as Record<string, unknown>;
  delete settings['anchor'];
  if (c.blocks) c.blocks = c.blocks.map((b) => ({ ...b, id: newId() }));
  return c;
}

export const copyBlock = (b: LooseBlock): LooseBlock => ({ ...structuredClone(b), id: newId() });

// ---- wireframe thumbnails ---------------------------------------------------
type Shape = [x: number, y: number, w: number, h: number, kind?: 'media' | 'line' | 'btn'];
const WIRE: Record<SectionType, Shape[]> = {
  hero: [[8, 10, 44, 6], [8, 20, 30, 3], [8, 28, 14, 5, 'btn'], [58, 8, 34, 34, 'media']],
  text: [[10, 10, 40, 5], [10, 22, 80, 3], [10, 29, 80, 3], [10, 36, 60, 3]],
  image: [[12, 6, 76, 34, 'media'], [30, 44, 40, 3]],
  gallery: [[8, 8, 26, 18, 'media'], [37, 8, 26, 18, 'media'], [66, 8, 26, 18, 'media'], [8, 29, 26, 18, 'media'], [37, 29, 26, 18, 'media'], [66, 29, 26, 18, 'media']],
  featured: [[8, 8, 40, 30, 'media'], [52, 8, 40, 14, 'media'], [52, 24, 40, 14, 'media'], [8, 42, 30, 3]],
  about: [[8, 10, 36, 5], [8, 20, 50, 3], [8, 27, 50, 3], [8, 34, 40, 3], [66, 8, 26, 34, 'media']],
  contact: [[10, 10, 34, 5], [10, 22, 50, 3], [10, 32, 22, 6, 'btn'], [70, 12, 4, 4, 'media'], [78, 12, 4, 4, 'media']],
  columns: [[8, 8, 26, 36, 'media'], [37, 8, 26, 36, 'media'], [66, 8, 26, 36, 'media']],
  spacer: [[8, 26, 84, 1, 'line']],
  cta: [[20, 12, 60, 6], [30, 24, 40, 3], [38, 33, 24, 7, 'btn']],
  'works-list': [[8, 8, 84, 8], [8, 20, 84, 8], [8, 32, 84, 8]],
};

/** A small SVG wireframe of a section type. */
export function sectionThumb(type: SectionType): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 52');
  svg.setAttribute('class', 'wire');
  svg.setAttribute('aria-hidden', 'true');
  for (const [x, y, w, hh, kind] of WIRE[type]) {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(hh));
    r.setAttribute('rx', kind === 'btn' ? '2' : '1');
    r.setAttribute('class', `wire__${kind ?? 'text'}`);
    svg.appendChild(r);
  }
  return svg;
}
