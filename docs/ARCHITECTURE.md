# Architecture

The public site is a static Astro build on GitHub Pages. Every word, image and section on it comes from one validated `Content` object (`src/lib/schema.ts`). Pages and components never read content directly: they go through the data layer in `src/lib/`. Since v2 that object comes from Supabase. The artist edits it in an in-site dashboard and freezes it with a Publish step. The v1 `content/` folder is still a supported source for dev, tests and the fallback build.

The exact contracts (tables, mapping to `schema.ts`, storage, RPCs, Edge Functions, events, the `load()` switch) are in [`V2-CONTRACTS.md`](V2-CONTRACTS.md). This file explains how the pieces fit together. Go-live steps: [`GO-LIVE.md`](GO-LIVE.md). Editor guide: [`ADMIN.md`](ADMIN.md).

## Two data flows

**Build time (public site).** While a visitor browses, nothing on the public site talks to the database except the analytics beacon.

```
CONTENT_SOURCE=local (default)          CONTENT_SOURCE=supabase  (scripts/prepare-content.ts, before astro build)
content/site.json  ┐                    get_published_content()  (anon key, one request)
content/works.json ├──────┐             + download every object it references from the `media` bucket → content/media/
content/media/**   ┘      │             → generated/content.json
                          ▼                          │
               src/lib/validate.ts ◄─────────────────┘
                          ▼
               src/lib/content.ts (getSite, getWorks…) ─► pages / components ─► dist/ ─► GitHub Pages
                                                              │
               src/lib/media.ts (resolveMedia) ◄──────────────┤
               src/lib/track.ts (track) ◄── client scripts ───┘──► POST /functions/v1/track (in the visitor's browser)
```

**Admin runtime (dashboard).** `/CesartPortfolio/admin/` is a static page. Its script (`src/admin/`) runs in the editor's browser with the public anon key and the editor's session.

```
editor's browser ── supabase-js (anon key + editor JWT) ──► PostgREST: draft tables, RPCs, stats      ┐
                                                         ──► Storage: `media` bucket (uploads)         ├ every call checked by RLS
                                                         ──► Edge Functions: publish, publish-status,  │
                                                             invite-editor, remove-editor             ┘
Publish ─► `publish` ─► create_publish_run(): build_content(true) frozen into publish_runs.snapshot
                    └─► GitHub repository_dispatch `publish` ─► deploy.yml builds with CONTENT_SOURCE=supabase
                                                               └─► reports building / succeeded / failed to `publish-status`
```

Draft and live content are separate. Editors only write **draft tables**. The site only reads the **snapshot** of the newest publish run that did not fail (`get_published_content()`). So an edit stays private until Publish, a code push in between rebuilds the same live snapshot, and a failed publish leaves the site on the previous good version (contracts §1).

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
| `supabase` | The live publish snapshot from `get_published_content()`, fetched with `PUBLIC_SUPABASE_ANON_KEY`. Before Astro starts, `scripts/prepare-content.ts` downloads every referenced Storage object into `content/media/` and writes the validated snapshot to `generated/content.json`, which `load()` reads. Pages serve media from GitHub Pages and never from Supabase, and `astro build` itself makes no Supabase request. |

In `supabase` mode the build fails with `ContentSourceError` when an env var is missing, Supabase is unreachable or times out (30 s), the response is not 200, nothing is published or a download fails, and with `ContentError` when the snapshot does not validate. It never falls back to local content.

| Function | Returns |
|---|---|
| `getSite()` | `Promise<Site>` |
| `getLayout()` | `Promise<Layout>` |
| `getCategories()` | `Promise<Category[]>` |
| `getWorks(filter?: {categoryId?, featured?})` | `Promise<Work[]>`, sorted by `order` ascending (missing last), then `year` descending, then title |
| `getWork(slug)` | `Promise<Work \| undefined>` |
| `getFeaturedWorks()` | Works for the featured section, in `options.workIds` order and capped by `limit`. Falls back to `featured: true` works. |
| `renderMarkdown(md)` | Sanitized HTML string (for `about.body`). Editors write this text in supabase mode, so the output is allowlisted (`p, br, em, strong, a, ul, ol, li, h2–h4, blockquote, code, pre`; links only `http`, `https`, `mailto`). |

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

UI code calls it at the moments the artist will want metrics for. It is the only `src/lib` module that client scripts may import.

In v1 it did nothing. Since v2 it sends one `navigator.sendBeacon` (`text/plain` JSON) to the `track` Edge Function at `{PUBLIC_SUPABASE_URL}/functions/v1/track`, with no cookies and no storage. It stays a no-op when `PUBLIC_SUPABASE_URL` is unset (local dev, tests) and on the `/admin` pages. See `docs/V2-CONTRACTS.md` §6–7 and `supabase/functions/README.md`.

## Access model (Row Level Security)

All authorization lives in Postgres (`supabase/migrations/20261025000500_rls.sql` and `…0600_storage.sql`). The anon key in the site and the dashboard bundle is public by design. It can only do what the policies allow.

| Caller | Can |
|---|---|
| anon (visitors, the build) | execute `get_published_content()`, and read Storage objects whose key is in the live snapshot (`is_published_media`). No table access at all. |
| signed in, not an editor | nothing beyond anon. The dashboard signs them out. |
| active editor (`is_editor()`) | read and write the draft tables, upload to and delete from the `media` bucket, preview (`build_content(false)`), `create_publish_run()`, read stats, the activity log and the editor list, and change their own display name. |
| active owner (`is_owner()`) | everything an editor can, plus `set_editor_disabled`, `remove_editor` and inviting editors. Never on themselves, and never on the last active owner. |
| service role | only inside Edge Functions (after they have verified the caller) and the one-off `npm run db:import`. Never in the site build, the bundle or GitHub. |

Every editable table has `updated_at` / `updated_by` and triggers that write `activity_log`, which the dashboard shows. Grants are revoked by default, so a new table or function stays unreachable until a migration grants it. `supabase/tests/database/00_structure.test.sql` fails if a table lacks RLS. The other pgTAP tests in `supabase/tests/database/` cover the rows of the table above.

## Edge Functions (`supabase/functions/`)

These Deno functions do what the browser must not do with its own rights: hold a secret, use the service role, or call GitHub. The gateway JWT check is off. Each function verifies the caller's JWT with `auth.getUser()` and checks `is_editor()` / `is_owner()` **with that JWT** before anything else, so the database applies the same rules a second time.

| Function | Caller | Does |
|---|---|---|
| `track` | public. CORS origins: `https://echo1560.github.io`, `http://localhost:4321`, `http://127.0.0.1:4321` | validates and normalises an analytics event, hashes the visitor, calls `record_event()` |
| `publish` | editor | `create_publish_run()` as the caller, then `repository_dispatch` with `GITHUB_DISPATCH_TOKEN` |
| `publish-status` | editor (GET) / deploy workflow with `PUBLISH_STATUS_TOKEN` (POST) | lists runs / records `building`, `succeeded` or `failed` |
| `invite-editor` | owner | `auth.admin.inviteUserByEmail` (link to `ADMIN_REDIRECT_URL`), then `register_invited_editor()` |
| `remove-editor` | owner | `remove_editor()` as the caller, then deletes the auth user only if that succeeded |

Payloads and error codes are in `supabase/functions/README.md`. Secrets: `GITHUB_DISPATCH_TOKEN`, `PUBLISH_STATUS_TOKEN` and `EVENTS_HASH_SECRET`. Optional settings: `ADMIN_REDIRECT_URL`, `GITHUB_REPOSITORY`, and `GITHUB_API_URL` (tests only). All of them are set with `supabase secrets set` (`GO-LIVE.md` step 5).

## Media pipeline

1. **Upload (dashboard).** The browser checks the type, the extension and the 25 MiB limit. It uploads the file to the private `media` bucket as `uploads/<uuid>.<ext>` and inserts a `media` row. A GIF or animated WebP gets kind `animated`. Replacing a file uploads a new key, so a published URL never changes content. Draft uploads are never public: the preview shows them through signed URLs.
2. **Publish.** The snapshot lists every key it uses (`publish_runs.media_paths`). Only those objects become readable by anon.
3. **Build.** `content:prepare` downloads exactly those objects into `content/media/` with the anon key. It then generates WebM, MP4 and a poster for every animated file (see "Animated variants" above). In CI, `MEDIA_VARIANTS=required` fails the build without ffmpeg.
4. **Serve.** `media.ts` turns everything into hashed files under `/CesartPortfolio/_astro/`. Visitors download media from GitHub Pages only, never from Supabase, so their traffic does not count against the free plan's egress.

## Analytics

`track()` is the only analytics code. It sends a `text/plain` beacon, with no cookies and no storage, to the `track` function. The function keeps only the event name, path, work slug, referrer host, a device class and a visitor hash. The hash is `HMAC(daily salt, ip|ua)`. The salt is derived per UTC day from `EVENTS_HASH_SECRET` and never stored, so a visitor cannot be followed across days. Raw IPs and User-Agents are never stored. `record_event()` rate-limits (60 events per visitor per minute, 1200 site-wide) and marks bots. The dashboard reads aggregates only, through the editor-only `stats_*` RPCs. Contract: §7.

`purge_old_events()` deletes events older than 400 days. It is service-role only, and nothing schedules it yet: at this site's traffic the free-plan database will not fill up for years. If it ever matters, run it from the SQL editor.

## Deploy, keep-alive and CI

- **`deploy.yml`** runs on a push to `main`, on `repository_dispatch: publish` and manually. With the Supabase secrets set, it builds with `CONTENT_SOURCE=supabase` and fails loudly when Supabase is unreachable or nothing is published. A push without the secrets builds the v1 content with a warning. For a publish, it reports progress to `publish-status`. After the build, `check:bundle` fails if `dist/` contains a service-role JWT, a secret key or a token.
- **`keep-alive.yml`** calls `get_published_content()` with the anon key every 3 days, so the free hosted project is not paused after a week without traffic. It does nothing until the secrets are set.
- **`ci.yml`** runs the unit tests, the build, e2e and Lighthouse. It also runs the database job (pgTAP RLS and storage tests, API checks, parity), the Edge Function tests (GitHub mocked) and gitleaks.

Rules that keep this cheap to change:

- No component imports `content/*.json`.
- No component builds media URLs by hand.
- No analytics code outside `track.ts`.
- No service-role key outside Edge Functions and the import script.
- Authorization lives only in RLS.

## Placeholder media

`content/media/placeholder/` is generated by `node scripts/generate-placeholders.mjs` (sharp, plus ffmpeg for the MP4s; see the script header). Every placeholder entry has `"placeholder": true`, and its copy reads as lorem ipsum. Replace an entry by editing it and dropping `placeholder`. Delete the folder once real work is in.
