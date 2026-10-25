# Architecture

The site is a static Astro build. Every word, image and section on the page comes from the `content/` folder. Pages and components never read those files directly. They go through a small data layer in `src/lib/`. That boundary is what lets a future backend and artist dashboard replace the content source without rewriting the UI.

```
content/site.json  ┐
content/works.json ├─► src/lib/validate.ts ─► src/lib/content.ts ─► pages / components
content/media/**   ┘     (zod + cross-checks)    (getSite, getWorks…)        │
                                                                            ▼
                                     src/lib/media.ts (resolveMedia) ◄──────┘
                                     src/lib/track.ts (track)  ◄── client scripts
```

> **v2 (backend + dashboard):** the database schema, how rows map to the types below, storage, Edge Functions, event payloads and the `load()` source switch are specified in [`V2-CONTRACTS.md`](V2-CONTRACTS.md).

## Content schema (`src/lib/schema.ts`)

Zod schemas and the TypeScript types inferred from them. These are the only definition of the content shape.

| Type | Where | Notes |
|---|---|---|
| `Site` | `content/site.json` | `meta`, `hero`, `about` (`body` is Markdown), `contact`, `categories`, `layout`. Optional `placeholder: true`. |
| `Work` | `content/works.json` (array) | `id`, `slug` (unique, kebab-case, stable), `title`, `year?`, `categoryId`, `tags`, `description`, `featured?`, `order?`, `placeholder?`, `media`, `gallery?`. |
| `Media` | inside both | `type: image \| animated \| video \| embed`, `src`, `alt` (required, non-empty), `width`, `height`, `poster?` (required for `video`), `loop?`, `provider?` (`youtube \| vimeo`, required for `embed`). |
| `Layout` | `site.json → layout` | `sections[]` of `{id, visible, options?}`. |

Media paths are relative to `content/media/`. For `embed`, `src` is the YouTube or Vimeo page URL.

### Validation (`src/lib/validate.ts`)

`validateContent(siteRaw, worksRaw, mediaExists)` is pure: the caller says which files exist. It runs zod and then the cross-file rules:

- duplicate work `id` or `slug`, and duplicate category, social or section ids
- a `categoryId` that is not in `site.categories`
- a featured `workIds` entry that is not a work
- a referenced media file (`src`, `poster`, `ogImage`, gallery) that does not exist
- missing alt text, a video without a poster, an embed without a provider, non-kebab-case ids, absolute or `..` paths

It reports every problem at once, naming the file and the work id, and throws `ContentError`. The same function runs in three places:

1. `npm run validate:content` (`scripts/validate-content.ts`), which exits 1 on errors.
2. `npm run build`, which runs `content:prepare` (`scripts/prepare-content.ts`) first, so invalid content fails the build before Astro starts. With `CONTENT_SOURCE=supabase` that step also fetches the published snapshot and downloads its media (see below).
3. `src/lib/content.ts`, the first time any page asks for data. `npm run dev` therefore shows the same error.

## Data layer (`src/lib/content.ts`)

This is the only module that reads content. It runs at build time only, because it uses `node:fs`. `CONTENT_SOURCE` picks the source (`src/lib/content-source.ts`, contract in `docs/V2-CONTRACTS.md` §8):

| `CONTENT_SOURCE` | Source |
|---|---|
| `local` (default) | `content/*.json` + `content/media/`. Dev, tests, e2e fixtures. |
| `supabase` | The live publish snapshot from `get_published_content()`, fetched with `PUBLIC_SUPABASE_ANON_KEY`. Before Astro starts, `scripts/prepare-content.ts` downloads every referenced Storage object into `content/media/`, so pages serve media from GitHub Pages and never from Supabase. |

In `supabase` mode the build fails with `ContentSourceError` when an env var is missing, Supabase is unreachable or times out (30 s), the response is not 200, nothing is published or a download fails, and with `ContentError` when the snapshot does not validate. It never falls back to local content.

| Function | Returns |
|---|---|
| `getSite()` | `Promise<Site>` |
| `getLayout()` | `Promise<Layout>` |
| `getCategories()` | `Promise<Category[]>` |
| `getWorks(filter?: {categoryId?, featured?})` | `Promise<Work[]>`, sorted by `order` ascending (missing last), then `year` descending, then title |
| `getWork(slug)` | `Promise<Work \| undefined>` |
| `getFeaturedWorks()` | Works for the featured section, in `options.workIds` order and capped by `limit`. Falls back to `featured: true` works. |
| `renderMarkdown(md)` | HTML string (for `about.body`) |

Content is loaded and validated once per build and then cached.

## Media (`src/lib/media.ts`)

`resolveMedia(media, {sizes?, widths?}) → Promise<ResolvedMedia>` returns what a component renders. Every URL already includes the `/CesartPortfolio/` base.

| `media.type` | Result |
|---|---|
| `image` | `ResolvedImage`: WebP `srcset` (320–2048w, capped at the source width), fallback `src`, `sizes`, `width`, `height`, `alt` |
| `animated` | `ResolvedAnimated`: the original GIF or animated WebP (`src`, the fallback), `sources` (muted WebM then MP4 renditions, `[]` if none were generated), `loop`, optional `poster` (the content poster, else the generated first frame) |
| `video` | `ResolvedVideo`: file URL, `mimeType`, `loop`, `poster` (`ResolvedImage`) |
| `embed` | `ResolvedEmbed`: `embedUrl` (youtube-nocookie, or Vimeo with `dnt=1`; load it only after a click), `pageUrl`, optional `poster` |

`resolveImage(path, alt, opts)` and `resolveMediaUrl(path)` (a 1200px JPG, used for `og:image`) are also exported. Files are found through Vite `import.meta.glob`, so every file in `content/media/` ends up in `dist/_astro/` with a content hash. Do not leave unused or private files in that folder.

**Animated variants.** `scripts/prepare-content.ts` converts every `animated` GIF/WebP with ffmpeg (`ffmpeg-static`, else PATH) into `generated/media/<key>.webm` (VP9), `<key>.mp4` (H.264, yuv420p, `+faststart`) and `<key>.poster.jpg`, all without audio and flattened onto the page background. Outputs are cached in `node_modules/.cache/cesart-media-variants/` by a hash of the source bytes and encoder settings, so rebuilds only encode new files. `media.ts` finds them by name (`src/lib/media-variants.ts`). `MEDIA_VARIANTS=auto|required|off` controls what happens without ffmpeg (`required` is the default under CI). `npm run dev` does not run this step, so run `npm run content:prepare` once to see variants in dev.

## Layout config

`site.json → layout.sections` is an ordered list. The home page renders the sections in that order and skips any with `visible: false`.

| Section | Options |
|---|---|
| `hero` | none |
| `featured` | `workIds: string[]`, `limit?: number` |
| `grid` | `columns?: {sm, md, lg}`, `masonry?: boolean`, `showFilters?: boolean` |
| `about` | none |
| `contact` | none |

## Track hook (`src/lib/track.ts`)

```ts
type TrackEvent = 'page_view' | 'work_open' | 'video_play' | 'contact_click';
function track(event: TrackEvent, payload?: Record<string, unknown>): void;
```

In v1 it does nothing: no network, no cookies, no storage. UI code calls it at the moments the artist will want metrics for. It is the only `src/lib` module that client scripts may import.

## How a backend and dashboard replace each piece

The UI only depends on the function signatures and types above. Each piece can be swapped on its own:

| Piece | v1 | With a backend |
|---|---|---|
| Content source | `content/*.json` imported in `content.ts → load()` | `load()` fetches `GET /api/site` and `GET /api/works` at build time. The response is still checked with `validateContent`, so the API contract is `schema.ts`. A dashboard save triggers a Pages rebuild (`repository_dispatch` or a webhook). |
| Schema | zod in `schema.ts` | The same schemas are shared with the API, or exported as JSON Schema with `z.toJSONSchema()` for a non-TypeScript backend and the dashboard forms. |
| Media | Files in `content/media/`, optimised by Astro at build | Uploads go to object storage or a CDN. `resolveMedia` maps `src` to CDN URLs and builds the srcset from the CDN's resize parameters. `media.src` stays a path or key. |
| Layout | `site.json → layout` | Edited in the dashboard (reorder, toggle, pick featured works). Same shape, served by `getLayout()`. |
| Metrics | `track()` no-op | `track()` sends `navigator.sendBeacon('/api/events', …)` to the artist's own endpoint, without cookies. The dashboard reads the aggregates. Call sites do not change. |
| Live data (optional) | Fully static | Astro can switch individual routes to on-demand rendering with an adapter. The data layer API stays the same. |

Rules to keep the swap cheap: no component imports `content/*.json`, no component builds media URLs by hand, and no analytics code outside `track.ts`.

## Placeholder media

`content/media/placeholder/` is generated by `node scripts/generate-placeholders.mjs` (sharp, plus ffmpeg for the MP4s; see the script header). Every placeholder entry has `"placeholder": true`, and its copy reads as lorem ipsum. Replace an entry by editing it and dropping `placeholder`. Delete the folder once real work is in.
