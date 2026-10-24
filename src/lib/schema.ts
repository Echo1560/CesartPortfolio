/**
 * Content schema: the single source of truth for the shape of
 * `content/site.json` and `content/works.json`.
 *
 * The zod schemas check the shape of each file. Cross-file rules (unique ids,
 * known categories, media files that exist) live in `validate.ts`.
 *
 * A future backend must return the same shapes, so these types are also the API
 * contract for a dashboard. See docs/ARCHITECTURE.md.
 */
import { z } from 'zod';

/** Stable, URL-safe identifier: lowercase letters, digits and single hyphens. */
export const kebabId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case (lowercase letters, digits and hyphens)');

/** Path relative to `content/media/`. No leading slash, no `..`, no URLs. */
const mediaPath = z
  .string()
  .min(1, 'is required')
  .refine((p) => !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..') && !/^[a-z]+:/i.test(p), {
    message: 'must be a path relative to content/media/ (no leading slash, no "..", no URL)',
  });

const altText = z
  .string({ error: 'alt text is required' })
  .trim()
  .min(1, 'alt text is required (describe the image for screen-reader users)');

const dimension = z.number().int().positive();

export const mediaSchema = z
  .object({
    type: z.enum(['image', 'animated', 'video', 'embed']),
    /** File path relative to `content/media/`, or the page URL for `embed`. */
    src: z.string().min(1, 'is required'),
    alt: altText,
    width: dimension,
    height: dimension,
    /** Still image shown before playback. Required for `video`. */
    poster: mediaPath.optional(),
    loop: z.boolean().optional(),
    provider: z.enum(['youtube', 'vimeo']).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.type === 'embed') {
      if (!m.provider) {
        ctx.addIssue({ code: 'custom', path: ['provider'], message: 'embed media needs a provider ("youtube" or "vimeo")' });
      }
      if (!/^https:\/\//.test(m.src)) {
        ctx.addIssue({ code: 'custom', path: ['src'], message: 'embed src must be an https URL' });
      }
      return;
    }
    const parsed = mediaPath.safeParse(m.src);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', path: ['src'], message: parsed.error.issues[0]?.message ?? 'invalid path' });
    }
    if (m.type === 'video' && !m.poster) {
      ctx.addIssue({ code: 'custom', path: ['poster'], message: 'video needs a poster image' });
    }
  });

export const categorySchema = z.object({
  id: kebabId,
  slug: kebabId,
  label: z.string().min(1),
});

export const socialSchema = z.object({
  id: kebabId,
  label: z.string().min(1),
  url: z.url(),
});

const featuredOptions = z.object({
  workIds: z.array(kebabId),
  limit: z.number().int().positive().optional(),
});

const gridOptions = z.object({
  columns: z
    .object({
      sm: z.number().int().min(1).max(6),
      md: z.number().int().min(1).max(6),
      lg: z.number().int().min(1).max(6),
    })
    .optional(),
  masonry: z.boolean().optional(),
  showFilters: z.boolean().optional(),
});

const sectionBase = { visible: z.boolean() };

export const sectionSchema = z.discriminatedUnion('id', [
  z.object({ id: z.literal('hero'), ...sectionBase, options: z.object({}).optional() }),
  z.object({ id: z.literal('featured'), ...sectionBase, options: featuredOptions.optional() }),
  z.object({ id: z.literal('grid'), ...sectionBase, options: gridOptions.optional() }),
  z.object({ id: z.literal('about'), ...sectionBase, options: z.object({}).optional() }),
  z.object({ id: z.literal('contact'), ...sectionBase, options: z.object({}).optional() }),
]);

export const layoutSchema = z.object({
  sections: z.array(sectionSchema),
});

export const siteSchema = z.object({
  /** True while the copy is placeholder text, so it is easy to find and replace. */
  placeholder: z.boolean().optional(),
  meta: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    author: z.string().min(1),
    /** Social share image, relative to `content/media/`. */
    ogImage: mediaPath,
    lang: z.string().min(2),
  }),
  hero: z.object({
    heading: z.string().min(1),
    subheading: z.string(),
    media: mediaSchema,
  }),
  about: z.object({
    heading: z.string().min(1),
    /** Markdown. Render with `renderMarkdown()` from `content.ts`. */
    body: z.string(),
    portrait: mediaSchema.optional(),
  }),
  contact: z.object({
    heading: z.string().min(1),
    email: z.email(),
    ctaLabel: z.string().min(1),
    socials: z.array(socialSchema),
  }),
  categories: z.array(categorySchema).min(1),
  layout: layoutSchema,
});

export const workSchema = z.object({
  id: kebabId,
  slug: kebabId,
  title: z.string().min(1),
  year: z.number().int().min(1900).max(2100).optional(),
  categoryId: kebabId,
  tags: z.array(z.string().min(1)),
  description: z.string(),
  featured: z.boolean().optional(),
  order: z.number().optional(),
  placeholder: z.boolean().optional(),
  media: mediaSchema,
  gallery: z.array(mediaSchema).optional(),
});

export const worksSchema = z.array(workSchema);

export type Media = z.infer<typeof mediaSchema>;
export type MediaType = Media['type'];
export type Category = z.infer<typeof categorySchema>;
export type Social = z.infer<typeof socialSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type SectionId = Section['id'];
export type Layout = z.infer<typeof layoutSchema>;
export type Site = z.infer<typeof siteSchema>;
export type Work = z.infer<typeof workSchema>;
export type FeaturedOptions = z.infer<typeof featuredOptions>;
export type GridOptions = z.infer<typeof gridOptions>;
