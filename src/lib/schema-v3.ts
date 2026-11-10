/**
 * v3 content schema: pages made of sections and blocks, a site theme, and the
 * site navigation/footer. The single source of truth for:
 *
 * - the draft rows the editor writes (`pages`, `sections`, `blocks`, `theme`,
 *   `site.nav`, `site.footer`): validate with the `*Draft` schemas before writing;
 * - the publish snapshot v3 that `get_published_content()` returns and the
 *   build renders: validate with `snapshotV3Schema`.
 *
 * The database enforces ids, ordering, references and type/variant pairs; the
 * deep JSON shapes below are enforced here. Contract: docs/V3-CONTRACTS.md.
 *
 * v2 shapes (`Site`, `Work`, `Media`) stay in `schema.ts` and are reused.
 */
import { z } from 'zod';
import { kebabId, siteSchema, workSchema } from './schema';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const uuid = z.uuid();

/** Spacing step from the theme spacing scale. */
export const SPACE_STEPS = ['none', 'xs', 'sm', 'md', 'lg', 'xl'] as const;
export const space = z.enum(SPACE_STEPS);

export const align = z.enum(['left', 'center', 'right']);

/** Palette role pairs a section can use for its background and text. */
export const COLOR_SCHEMES = ['default', 'surface', 'inverse', 'accent'] as const;
export const colorScheme = z.enum(COLOR_SCHEMES);

/** Page slugs that would clash with site routes. Same list as `pages_slug_not_reserved` in SQL. */
export const RESERVED_SLUGS = [
  'admin', 'work', 'works', 'api', 'assets', 'media', 'preview', 'sitemap', 'robots', 'rss', 'feed', '404', 'index', 'home-preview',
] as const;

export const pageSlug = kebabId
  .max(100)
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), { message: 'is reserved for a site route' });

/**
 * Hrefs allowed in rich text and URL links: http(s), mailto, tel, site-relative path or #anchor.
 * A path may not start with `//` or `/\` and holds no backslash (browsers read both as another host).
 * `public.is_safe_href()` (SQL) must match.
 */
export const SAFE_HREF = /^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:\+?[0-9 ()-]+|\/(?![\/\\])[^\s\\]*|#[A-Za-z0-9_-]+)$/;
export const safeHref = z
  .string()
  .max(500)
  .regex(SAFE_HREF, 'must be an http(s), mailto: or tel: URL, a /path or a #anchor');

// ---------------------------------------------------------------------------
// Rich text: a ProseMirror/Tiptap-compatible JSON subset. Never HTML.
// Renderers must build elements from these nodes and escape every `text`.
// ---------------------------------------------------------------------------

export const markSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }).strict(),
  z.object({ type: z.literal('italic') }).strict(),
  z.object({ type: z.literal('link'), attrs: z.object({ href: safeHref }).strict() }).strict(),
]);

export const textNodeSchema = z
  .object({
    type: z.literal('text'),
    text: z.string().min(1).max(5000),
    marks: z.array(markSchema).max(3).optional(),
  })
  .strict();

export const hardBreakSchema = z.object({ type: z.literal('hardBreak') }).strict();

export const inlineNodeSchema = z.discriminatedUnion('type', [textNodeSchema, hardBreakSchema]);

/** One line of formatted text: headings, labels, captions. `[]` is empty. */
export const inlineTextSchema = z.array(inlineNodeSchema).max(200);

const paragraphNode = z
  .object({ type: z.literal('paragraph'), content: inlineTextSchema.optional() })
  .strict();

const headingNode = z
  .object({
    type: z.literal('heading'),
    attrs: z.object({ level: z.union([z.literal(2), z.literal(3), z.literal(4)]) }).strict(),
    content: inlineTextSchema.optional(),
  })
  .strict();

const listItemNode = z
  .object({ type: z.literal('listItem'), content: z.array(paragraphNode).min(1).max(10) })
  .strict();

const bulletListNode = z.object({ type: z.literal('bulletList'), content: z.array(listItemNode).min(1).max(100) }).strict();
const orderedListNode = z.object({ type: z.literal('orderedList'), content: z.array(listItemNode).min(1).max(100) }).strict();

export const richBlockSchema = z.discriminatedUnion('type', [paragraphNode, headingNode, bulletListNode, orderedListNode]);

/** Multi-paragraph formatted text: paragraphs, h2-h4, bullet and ordered lists. */
export const richTextSchema = z
  .object({ type: z.literal('doc'), content: z.array(richBlockSchema).max(200) })
  .strict();

// ---------------------------------------------------------------------------
// Links, buttons, media references
// ---------------------------------------------------------------------------

export const linkSchema = z.discriminatedUnion('kind', [
  /** Another editor page (by id, so renames keep working), optionally an anchor on it. */
  z.object({ kind: z.literal('page'), pageId: uuid, anchor: kebabId.optional() }).strict(),
  /** A work detail page. */
  z.object({ kind: z.literal('work'), workId: kebabId }).strict(),
  /** An anchor on the current page. */
  z.object({ kind: z.literal('anchor'), anchor: kebabId }).strict(),
  /** External URL, mailto: or tel:. */
  z.object({ kind: z.literal('url'), url: safeHref, newTab: z.boolean().optional() }).strict(),
]);

export const buttonSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    link: linkSchema,
    style: z.enum(['primary', 'secondary']).default('primary'),
  })
  .strict();

const focalSchema = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict();

/**
 * A library file used by a section or block, as stored in DRAFT JSON.
 * `alt` falls back to `media.default_alt`; width/height override the library values.
 */
export const mediaRefSchema = z
  .object({
    mediaId: uuid,
    /** Still image for a video (required for video files at publish). */
    posterId: uuid.optional(),
    alt: z.string().max(1000).optional(),
    loop: z.boolean().optional(),
    /** Focal point in percent, used for cropping (object-position). */
    focal: focalSchema.optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

/**
 * A resolved media reference in the SNAPSHOT: the v2 `Media` fields (file
 * types only, no embeds) plus the library ids and the focal point.
 */
export const snapshotMediaSchema = z
  .object({
    mediaId: uuid,
    posterId: uuid.optional(),
    type: z.enum(['image', 'animated', 'video']),
    src: z.string().min(1),
    alt: z.string().trim().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    poster: z.string().min(1).optional(),
    loop: z.boolean().optional(),
    focal: focalSchema.optional(),
  })
  .strict()
  .refine((m) => m.type !== 'video' || m.poster, { message: 'video needs a poster image', path: ['poster'] });

// ---------------------------------------------------------------------------
// Sections. Every type: `settings` (side panel) + `content` (inline editing).
// `media(...)` is the media slot: a MediaRef in drafts, a resolved Media in snapshots.
// ---------------------------------------------------------------------------

/** Same lists as `sections_variant_valid` in SQL. The first variant is the default. */
export const SECTION_VARIANTS = {
  hero: ['default', 'overlay', 'split', 'text-only'],
  text: ['default', 'lead', 'boxed'],
  image: ['default', 'full-bleed', 'caption-side'],
  gallery: ['default', 'grid'],
  featured: ['default', 'large-first', 'strip'],
  about: ['default', 'portrait-right', 'stacked'],
  contact: ['default', 'centered', 'split'],
  columns: ['default', 'wide-left', 'wide-right'],
  spacer: ['default'],
  cta: ['default', 'centered', 'banner'],
  'works-list': ['default', 'compact', 'cards'],
} as const;

export type SectionType = keyof typeof SECTION_VARIANTS;
export const SECTION_TYPES = Object.keys(SECTION_VARIANTS) as SectionType[];

/** Section types that hold blocks. */
export const FLEXIBLE_SECTION_TYPES = ['text', 'columns'] as const satisfies readonly SectionType[];

export const BLOCK_TYPES = ['heading', 'paragraph', 'image', 'button', 'divider', 'spacer', 'quote', 'video'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

const columnsBySize = z
  .object({ sm: z.number().int().min(1).max(6), md: z.number().int().min(1).max(6), lg: z.number().int().min(1).max(6) })
  .strict();

/** Which works a gallery or works list shows. */
export const workSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('category'), categoryIds: z.array(kebabId).min(1).max(20) }).strict(),
  z.object({ kind: z.literal('tags'), tags: z.array(z.string().min(1).max(60)).min(1).max(20) }).strict(),
  z.object({ kind: z.literal('manual'), workIds: z.array(kebabId).min(1).max(200) }).strict(),
]);

/** `default` = the v2 order (work `order`, then newest year, then title). */
export const workSort = z.enum(['default', 'newest', 'oldest', 'title']);

function sectionSchemas<M extends z.ZodType>(media: M) {
  const backgroundImage = z.object({ image: media, overlay: z.number().int().min(0).max(90).default(0) }).strict();

  /** Settings every section type accepts. */
  const base = {
    anchor: kebabId.max(60).optional(),
    align: align.optional(),
    width: z.enum(['narrow', 'normal', 'wide', 'full']).optional(),
    paddingTop: space.optional(),
    paddingBottom: space.optional(),
    colorScheme: colorScheme.optional(),
    backgroundImage: backgroundImage.optional(),
  };

  const s = <T extends z.ZodRawShape>(shape: T) => z.object({ ...base, ...shape }).strict();
  const c = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

  return {
    hero: {
      settings: s({ height: z.enum(['auto', 'medium', 'tall', 'screen']).optional(), mediaSide: z.enum(['left', 'right']).optional() }),
      content: c({ heading: inlineTextSchema, subheading: inlineTextSchema.optional(), media: media.optional(), buttons: z.array(buttonSchema).max(2).optional() }),
    },
    text: { settings: s({}), content: c({}) },
    image: {
      settings: s({ aspect: z.enum(['original', 'square', 'landscape', 'portrait']).optional(), lightbox: z.boolean().optional() }),
      content: c({ media, caption: inlineTextSchema.optional(), link: linkSchema.optional() }),
    },
    gallery: {
      settings: s({
        source: workSourceSchema,
        sort: workSort,
        limit: z.number().int().min(1).max(200).optional(),
        columns: columnsBySize,
        showFilters: z.boolean(),
        showCaptions: z.boolean().optional(),
      }),
      content: c({ heading: inlineTextSchema.optional(), emptyText: inlineTextSchema.optional() }),
    },
    featured: {
      settings: s({ workIds: z.array(kebabId).max(24), limit: z.number().int().min(1).max(24).optional() }),
      content: c({ heading: inlineTextSchema.optional() }),
    },
    about: {
      settings: s({}),
      content: c({ heading: inlineTextSchema, body: richTextSchema, portrait: media.optional() }),
    },
    contact: {
      settings: s({ showEmail: z.boolean(), showSocials: z.boolean() }),
      content: c({ heading: inlineTextSchema, body: richTextSchema.optional(), email: z.email(), ctaLabel: z.string().trim().min(1).max(60) }),
    },
    columns: {
      settings: s({
        columns: z.number().int().min(2).max(4).default(2),
        gap: space.optional(),
        stackBelow: z.enum(['tablet', 'mobile']).optional(),
        verticalAlign: z.enum(['top', 'center', 'bottom']).optional(),
      }),
      content: c({}),
    },
    spacer: { settings: s({ size: space, divider: z.boolean().optional() }), content: c({}) },
    cta: {
      settings: s({}),
      content: c({ heading: inlineTextSchema, body: richTextSchema.optional(), buttons: z.array(buttonSchema).min(1).max(2) }),
    },
    'works-list': {
      settings: s({
        source: workSourceSchema,
        sort: workSort,
        limit: z.number().int().min(1).max(200).optional(),
        showYear: z.boolean().optional(),
        showCategory: z.boolean().optional(),
        showThumbnail: z.boolean().optional(),
      }),
      content: c({ heading: inlineTextSchema.optional() }),
    },
  } satisfies Record<SectionType, { settings: z.ZodType; content: z.ZodType }>;
}

function blockSchemas<M extends z.ZodType>(media: M) {
  const c = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
  return {
    heading: c({ text: inlineTextSchema, level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }),
    paragraph: c({ text: richTextSchema }),
    image: c({ media, caption: inlineTextSchema.optional(), link: linkSchema.optional() }),
    button: buttonSchema,
    divider: c({}),
    spacer: c({ size: space }),
    quote: c({ text: inlineTextSchema, attribution: z.string().max(200).optional() }),
    /** Self-hosted MP4/WebM only (a library file of kind `video`). */
    video: c({ media, autoplay: z.boolean().optional(), controls: z.boolean().optional() }),
  } satisfies Record<BlockType, z.ZodType>;
}

/** Block settings (side panel), the same for every block type. */
export const blockSettingsSchema = z
  .object({ align: align.optional(), marginTop: space.optional(), marginBottom: space.optional(), width: z.enum(['auto', 'full']).optional() })
  .strict();

export const visibilitySchema = z.object({ desktop: z.boolean(), tablet: z.boolean(), mobile: z.boolean() }).strict();

export const draftSections = sectionSchemas(mediaRefSchema);
export const draftBlocks = blockSchemas(mediaRefSchema);
export const snapshotSections = sectionSchemas(snapshotMediaSchema);
export const snapshotBlocks = blockSchemas(snapshotMediaSchema);

function blockUnion<B extends ReturnType<typeof blockSchemas>>(blocks: B, withIds: boolean) {
  const id = withIds ? { id: uuid, column: z.number().int().min(0).max(3), visibility: visibilitySchema } : {};
  return z.discriminatedUnion(
    'type',
    BLOCK_TYPES.map((t) => z.object({ ...id, type: z.literal(t), settings: blockSettingsSchema, content: blocks[t] }).strict()) as unknown as [
      z.ZodObject,
      ...z.ZodObject[],
    ],
  );
}

function sectionUnion<S extends ReturnType<typeof sectionSchemas>>(sections: S, block: z.ZodType | null) {
  return z.discriminatedUnion(
    'type',
    SECTION_TYPES.map((t) => {
      const variants = SECTION_VARIANTS[t] as unknown as [string, ...string[]];
      const shape = {
        type: z.literal(t),
        variant: z.enum(variants),
        settings: sections[t].settings,
        content: sections[t].content,
      };
      if (!block) return z.object(shape).strict();
      const flexible = (FLEXIBLE_SECTION_TYPES as readonly string[]).includes(t);
      return z
        .object({ id: uuid, ...shape, visibility: visibilitySchema, ...(flexible ? { blocks: z.array(block).max(200) } : {}) })
        .strict();
    }) as unknown as [z.ZodObject, ...z.ZodObject[]],
  );
}

/**
 * A `sections` row's editable part: `{type, variant, settings, content}`.
 * Validate before every insert/update from the editor.
 */
export const sectionDraftSchema = sectionUnion(draftSections, null);

/** A `blocks` row's editable part: `{type, settings, content}`. */
export const blockDraftSchema = blockUnion(draftBlocks, false);

// ---------------------------------------------------------------------------
// Site navigation and footer (`site.nav`, `site.footer`)
// ---------------------------------------------------------------------------

const navLeaf = z.object({ id: kebabId.max(60), label: z.string().trim().min(1).max(60), link: linkSchema }).strict();

export const navItemSchema = navLeaf.extend({ children: z.array(navLeaf).max(10).optional() }).strict();

export const siteNavSchema = z
  .object({ items: z.array(navItemSchema).max(12), cta: buttonSchema.optional() })
  .strict();

export const siteFooterSchema = z
  .object({
    text: inlineTextSchema.optional(),
    links: z.array(navLeaf).max(20),
    showSocials: z.boolean(),
    /** "© <year> <meta.author>. All rights reserved." */
    showCopyright: z.boolean(),
    showBackToTop: z.boolean(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Theme (`theme.tokens`)
// ---------------------------------------------------------------------------

const hex = z.string().regex(/^#[0-9a-f]{6}$/, 'must be a lowercase #rrggbb colour');

export const paletteSchema = z
  .object({
    background: hex,
    surface: hex,
    text: hex,
    muted: hex,
    accent: hex,
    /** Text on an accent background (buttons). */
    accentContrast: hex,
    border: hex,
    focus: hex,
  })
  .strict();

/**
 * Curated, open-licence fonts, self-hosted from the build (no Google Fonts
 * requests). `system-*` are the platform font stacks v2 uses (no download).
 */
export const FONT_IDS = [
  'system-sans',
  'system-serif',
  'inter',
  'dm-sans',
  'ibm-plex-sans',
  'space-grotesk',
  'source-serif-4',
  'lora',
  'fraunces',
  'playfair-display',
  'ibm-plex-mono',
] as const;
export const fontId = z.enum(FONT_IDS);

export const themeTokensSchema = z
  .object({
    colors: z.object({ light: paletteSchema, dark: paletteSchema.nullable() }).strict(),
    typography: z
      .object({
        headingFont: fontId,
        bodyFont: fontId,
        /** Size scale; `medium` = the v2 sizes. */
        scale: z.enum(['small', 'medium', 'large']),
        headingWeight: z.union([z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700)]),
        bodyWeight: z.union([z.literal(300), z.literal(400), z.literal(500)]),
        lineHeight: z.number().min(1.2).max(2),
        headingLineHeight: z.number().min(0.9).max(1.6),
        /** em */
        letterSpacing: z.number().min(-0.05).max(0.2),
        headingLetterSpacing: z.number().min(-0.05).max(0.2),
        headingCase: z.enum(['none', 'uppercase']),
      })
      .strict(),
    /** `medium` = the v2 spacing. */
    spacing: z.object({ scale: z.enum(['compact', 'medium', 'roomy']) }).strict(),
    buttons: z
      .object({ shape: z.enum(['square', 'rounded', 'pill']), style: z.enum(['solid', 'outline']), textCase: z.enum(['none', 'uppercase']) })
      .strict(),
    radius: z.enum(['none', 'small', 'medium', 'large']),
    links: z.object({ underline: z.enum(['always', 'hover', 'none']), color: z.enum(['accent', 'text']) }).strict(),
    /** false = no reveal/hover animation for anyone (prefers-reduced-motion still applies when true). */
    motion: z.object({ enabled: z.boolean() }).strict(),
  })
  .strict();

/** The v2 look. Must equal `default_theme_tokens()` in SQL (tested). */
export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  colors: {
    light: {
      background: '#f6f5f2', surface: '#ffffff', text: '#1b1b1a', muted: '#5d5c58',
      accent: '#8a3b2a', accentContrast: '#ffffff', border: '#dcdad4', focus: '#1a5fd0',
    },
    dark: {
      background: '#121211', surface: '#1b1b19', text: '#efede8', muted: '#a3a19a',
      accent: '#e08a73', accentContrast: '#121211', border: '#2f2e2b', focus: '#7fb0ff',
    },
  },
  typography: {
    headingFont: 'system-serif', bodyFont: 'system-sans', scale: 'medium',
    headingWeight: 400, bodyWeight: 400, lineHeight: 1.6, headingLineHeight: 1.1,
    letterSpacing: 0, headingLetterSpacing: 0, headingCase: 'none',
  },
  spacing: { scale: 'medium' },
  buttons: { shape: 'pill', style: 'solid', textCase: 'none' },
  radius: 'medium',
  links: { underline: 'always', color: 'text' },
  motion: { enabled: true },
};

/** Preset ids. `classic` is DEFAULT_THEME_TOKENS; the others are defined by the theme editor (TITA-90 stage 6). */
export const THEME_PRESETS = ['classic'] as const;

export const themeSchema = z.object({ preset: kebabId, tokens: themeTokensSchema }).strict();

// ---------------------------------------------------------------------------
// Pages (draft row fields the editor writes)
// ---------------------------------------------------------------------------

export const PAGE_STATUSES = ['draft', 'published', 'hidden'] as const;

export const pageDraftSchema = z
  .object({
    slug: pageSlug,
    title: z.string().trim().min(1).max(120),
    seo_title: z.string().max(200).nullable().optional(),
    seo_description: z.string().max(500).nullable().optional(),
    social_media_id: uuid.nullable().optional(),
    status: z.enum(PAGE_STATUSES),
  })
  .strict();

// ---------------------------------------------------------------------------
// Publish snapshot v3 (`get_published_content()`)
// ---------------------------------------------------------------------------

export const snapshotBlockSchema = blockUnion(snapshotBlocks, true);
export const snapshotSectionSchema = sectionUnion(snapshotSections, snapshotBlockSchema);

export const snapshotPageSchema = z
  .object({
    id: uuid,
    slug: pageSlug,
    title: z.string().min(1),
    status: z.enum(PAGE_STATUSES),
    isHome: z.boolean(),
    seo: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        /** Bucket key, like `site.meta.ogImage`. Falls back to the site default. */
        ogImage: z.string().min(1).optional(),
        ogImageId: uuid.optional(),
      })
      .strict(),
    sections: z.array(snapshotSectionSchema),
  })
  .strict();

/**
 * `site` in snapshot v3: the v2 `Site` (kept while the v2 build runs, see
 * V3-CONTRACTS §5) plus `nav`, `footer` and `socials`. v3 code reads only
 * `placeholder`, `meta`, `categories`, `socials`, `nav` and `footer`.
 */
export const snapshotSiteSchema = siteSchema.extend({
  nav: siteNavSchema,
  footer: siteFooterSchema,
  socials: z.array(z.object({ id: kebabId, label: z.string().min(1), url: z.url() })),
});

export const snapshotV3Schema = z
  .object({
    version: z.literal(3),
    site: snapshotSiteSchema,
    theme: themeSchema,
    pages: z.array(snapshotPageSchema),
    works: z.array(workSchema),
  })
  .superRefine((snap, ctx) => {
    const homes = snap.pages.filter((p) => p.isHome).length;
    if (homes !== 1) ctx.addIssue({ code: 'custom', path: ['pages'], message: `exactly one home page is required, found ${homes}` });
    const slugs = new Set<string>();
    snap.pages.forEach((p, i) => {
      if (slugs.has(p.slug)) ctx.addIssue({ code: 'custom', path: ['pages', i, 'slug'], message: `duplicate slug "${p.slug}"` });
      slugs.add(p.slug);
    });
  });

export type Mark = z.infer<typeof markSchema>;
export type InlineNode = z.infer<typeof inlineNodeSchema>;
export type InlineText = z.infer<typeof inlineTextSchema>;
export type RichBlock = z.infer<typeof richBlockSchema>;
export type RichText = z.infer<typeof richTextSchema>;
export type Link = z.infer<typeof linkSchema>;
export type Button = z.infer<typeof buttonSchema>;
export type MediaRef = z.infer<typeof mediaRefSchema>;
export type SnapshotMedia = z.infer<typeof snapshotMediaSchema>;
export type WorkSource = z.infer<typeof workSourceSchema>;
export type Visibility = z.infer<typeof visibilitySchema>;
export type BlockSettings = z.infer<typeof blockSettingsSchema>;
export type SectionDraft = z.infer<typeof sectionDraftSchema>;
export type BlockDraft = z.infer<typeof blockDraftSchema>;
export type NavItem = z.infer<typeof navItemSchema>;
export type SiteNav = z.infer<typeof siteNavSchema>;
export type SiteFooter = z.infer<typeof siteFooterSchema>;
export type Palette = z.infer<typeof paletteSchema>;
export type FontId = z.infer<typeof fontId>;
export type ThemeTokens = z.infer<typeof themeTokensSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type PageDraft = z.infer<typeof pageDraftSchema>;
export type SnapshotBlock = z.infer<typeof snapshotBlockSchema>;
export type SnapshotSection = z.infer<typeof snapshotSectionSchema>;
export type SnapshotPage = z.infer<typeof snapshotPageSchema>;
export type SnapshotSite = z.infer<typeof snapshotSiteSchema>;
export type SnapshotV3 = z.infer<typeof snapshotV3Schema>;

/** Settings and content types per section type, for typed components. */
export type SectionSettings<T extends SectionType> = z.infer<(typeof snapshotSections)[T]['settings']>;
export type SectionContent<T extends SectionType> = z.infer<(typeof snapshotSections)[T]['content']>;
export type BlockContent<T extends BlockType> = z.infer<(typeof snapshotBlocks)[T]>;
