import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_TOKENS,
  RESERVED_SLUGS,
  SECTION_VARIANTS,
  blockDraftSchema,
  linkSchema,
  pageDraftSchema,
  richTextSchema,
  sectionDraftSchema,
  snapshotV3Schema,
  themeTokensSchema,
} from '../../src/lib/schema-v3';

const root = process.cwd();
const sql = (name: string) => readFileSync(join(root, 'supabase', 'migrations', name), 'utf8');
const modelSql = sql('20261110000100_v3_content_model.sql');
const fixture = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'snapshot-v3.json'), 'utf8')) as unknown;

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const mediaId = '6f1c2b1e-8a4d-4c1e-9b0a-3c5d7e9f1a2b';

describe('schema-v3 matches the SQL contract', () => {
  it('DEFAULT_THEME_TOKENS equals default_theme_tokens() in the migration', () => {
    const migration = sql('20261110000300_v3_migrate_v2.sql');
    const json = /-- BEGIN DEFAULT_THEME_TOKENS\n'([\s\S]*?)'\n-- END DEFAULT_THEME_TOKENS/.exec(migration)?.[1];
    expect(json).toBeDefined();
    expect(JSON.parse(json!)).toEqual(DEFAULT_THEME_TOKENS);
    expect(themeTokensSchema.parse(DEFAULT_THEME_TOKENS)).toEqual(DEFAULT_THEME_TOKENS);
  });

  it('SECTION_VARIANTS equals the sections_variant_valid check', () => {
    const fromSql = Object.fromEntries(
      [...modelSql.matchAll(/when '([a-z-]+)'\s+then variant in \(([^)]*)\)/g)].map(([, type, list]) => [
        type,
        [...list!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]),
      ]),
    );
    expect(fromSql).toEqual(SECTION_VARIANTS);
  });

  it('RESERVED_SLUGS equals the pages_slug_not_reserved check', () => {
    const list = /slug::text not in \(([\s\S]*?)\)/.exec(modelSql)?.[1] ?? '';
    expect([...list.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...RESERVED_SLUGS]);
  });
});

describe('snapshot v3', () => {
  it('validates the snapshot the seeded database publishes (tests/fixtures/snapshot-v3.json)', () => {
    const snap = snapshotV3Schema.parse(fixture);
    expect(snap.pages).toHaveLength(1);
    expect(snap.pages[0]!.sections.map((s) => s.type)).toEqual(['hero', 'featured', 'gallery', 'cta', 'about', 'contact']);
    expect(snap.theme.tokens).toEqual(DEFAULT_THEME_TOKENS);
  });

  it('rejects a snapshot without exactly one home page', () => {
    const snap = structuredClone(fixture) as { pages: { isHome: boolean }[] };
    snap.pages[0]!.isHome = false;
    expect(snapshotV3Schema.safeParse(snap).success).toBe(false);
  });

  it('rejects an unknown key in a section (strict shapes)', () => {
    const snap = structuredClone(fixture) as { pages: { sections: { settings: Record<string, unknown> }[] }[] };
    snap.pages[0]!.sections[0]!.settings.onclick = 'alert(1)';
    expect(snapshotV3Schema.safeParse(snap).success).toBe(false);
  });
});

describe('rich text', () => {
  it('accepts paragraphs, headings, lists, bold, italic and safe links', () => {
    const value = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Rates')] },
      para(text('Hi '), text('there', [{ type: 'bold' }, { type: 'italic' }]), { type: 'hardBreak' }),
      para(text('mail', [{ type: 'link', attrs: { href: 'mailto:hello@example.com' } }])),
      para(text('page', [{ type: 'link', attrs: { href: '/commissions/' } }])),
      { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('one'))] }] },
    );
    expect(richTextSchema.safeParse(value).success).toBe(true);
  });

  it.each(['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>', '//evil.example', 'vbscript:x', ' https://x.y'])(
    'rejects the link target %j',
    (href) => {
      expect(richTextSchema.safeParse(doc(para(text('x', [{ type: 'link', attrs: { href } }])))).success).toBe(false);
    },
  );

  it('rejects node types outside the subset (no raw HTML)', () => {
    expect(richTextSchema.safeParse(doc({ type: 'html', content: '<b>x</b>' })).success).toBe(false);
    expect(richTextSchema.safeParse(doc(para(text('x', [{ type: 'underline' }])))).success).toBe(false);
    expect(richTextSchema.safeParse(doc({ type: 'heading', attrs: { level: 1 }, content: [text('x')] })).success).toBe(false);
  });

  it('rejects empty text nodes', () => {
    expect(richTextSchema.safeParse(doc(para(text('')))).success).toBe(false);
  });
});

describe('draft rows', () => {
  it('accepts a section with a media reference and rejects a wrong variant', () => {
    const hero = { type: 'hero', variant: 'split', settings: { mediaSide: 'right' }, content: { heading: [text('Hi')], media: { mediaId, alt: 'A fox' } } };
    expect(sectionDraftSchema.safeParse(hero).success).toBe(true);
    expect(sectionDraftSchema.safeParse({ ...hero, variant: 'masonry' }).success).toBe(false);
  });

  it('requires buttons with a valid link in a CTA', () => {
    const cta = { type: 'cta', variant: 'default', settings: {}, content: { heading: [text('Hire me')], buttons: [] as unknown[] } };
    expect(sectionDraftSchema.safeParse(cta).success).toBe(false);
    cta.content.buttons = [{ label: 'Email', link: { kind: 'url', url: 'javascript:alert(1)' } }];
    expect(sectionDraftSchema.safeParse(cta).success).toBe(false);
    cta.content.buttons = [{ label: 'Email', link: { kind: 'url', url: 'mailto:hello@example.com' } }];
    expect(sectionDraftSchema.safeParse(cta).success).toBe(true);
  });

  it('validates block content per type', () => {
    expect(blockDraftSchema.safeParse({ type: 'heading', settings: {}, content: { text: [text('Hi')], level: 2 } }).success).toBe(true);
    expect(blockDraftSchema.safeParse({ type: 'heading', settings: {}, content: { text: [text('Hi')], level: 6 } }).success).toBe(false);
    expect(blockDraftSchema.safeParse({ type: 'video', settings: {}, content: { media: { mediaId }, autoplay: true } }).success).toBe(true);
    expect(blockDraftSchema.safeParse({ type: 'video', settings: {}, content: { url: 'https://youtube.com/x' } }).success).toBe(false);
  });

  it('rejects reserved and malformed page slugs', () => {
    const page = { slug: 'commissions', title: 'Commissions', status: 'draft' };
    expect(pageDraftSchema.safeParse(page).success).toBe(true);
    expect(pageDraftSchema.safeParse({ ...page, slug: 'admin' }).success).toBe(false);
    expect(pageDraftSchema.safeParse({ ...page, slug: '../etc' }).success).toBe(false);
    expect(pageDraftSchema.safeParse({ ...page, slug: 'Commissions' }).success).toBe(false);
  });

  it('only accepts known link kinds', () => {
    expect(linkSchema.safeParse({ kind: 'page', pageId: mediaId, anchor: 'contact' }).success).toBe(true);
    expect(linkSchema.safeParse({ kind: 'script', code: 'x' }).success).toBe(false);
  });
});
