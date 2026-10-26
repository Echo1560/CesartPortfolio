# CesartPortfolio

Portfolio site for Cesart, an illustrator and 2D animator. Static Astro site published at https://echo1560.github.io/CesartPortfolio/. Design spec: [`docs/DESIGN.md`](docs/DESIGN.md). Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Run locally

Requires Node 22 and npm.

```sh
npm ci            # install dependencies
npm run dev       # dev server at http://localhost:4321/CesartPortfolio/
npm run build     # validate content, then build the static site into dist/
npm run preview   # serve dist/ at http://localhost:4321/CesartPortfolio/
npm run check     # type check (astro check)
```

The site is served under `/CesartPortfolio/` in dev and preview too, so open that path, not `/`. Colours, fonts, spacing and motion durations are CSS custom properties in `src/styles/tokens.css`. Under `prefers-reduced-motion: reduce` all motion is switched off and videos or animations show their poster only.

## Adding content

You add new work by editing files only. No code changes are needed.

1. **Add the file** to `content/media/`. Subfolders are fine, for example `content/media/2026/fox-poster.jpg`.
   - Still images: JPG, PNG, WebP or AVIF. Export at least 2000px on the long edge. The build makes the smaller sizes.
   - Short loops: animated WebP or GIF (type `animated`). Also export a still frame as a JPG to use as the `poster`.
   - Videos: MP4 (H.264) or WebM (type `video`). A `poster` JPG is **required**.
   - YouTube or Vimeo: no file needed. Use type `embed` with the page URL as `src` and `provider: "youtube"` or `"vimeo"`.
2. **Add an entry** to `content/works.json`. Copy an existing entry and change it:

   ```json
   {
     "id": "fox-poster",
     "slug": "fox-poster",
     "title": "Fox Poster",
     "year": 2026,
     "categoryId": "illustration",
     "tags": ["poster", "animals"],
     "description": "Poster for the autumn festival.",
     "featured": false,
     "media": {
       "type": "image",
       "src": "2026/fox-poster.jpg",
       "alt": "A red fox curled up in falling leaves",
       "width": 2000,
       "height": 2800
     }
   }
   ```

   - `id` and `slug` must be unique, lowercase and hyphenated. The slug becomes the URL `/CesartPortfolio/work/fox-poster/`, so do not change it later.
   - `categoryId` must be one of the `id`s in `content/site.json → categories` (`illustration` or `animation`).
   - `src` and `poster` are paths relative to `content/media/`.
   - `alt` is required. Describe what is in the picture.
   - `width` and `height` are the file's pixel size. They only set the aspect ratio, so they must match the file's proportions.
   - Optional fields: `order` (lower numbers come first, otherwise newest `year` first), `gallery` (more media shown on the detail page), `loop` (for animations and videos).
   - To show the work in the Featured section, add its `id` to `content/site.json → layout.sections → featured → options.workIds`.
3. **Check it** (optional): run `npm run validate:content`. It lists any mistake, such as a missing alt text, a typo in a path or a duplicate slug.
4. **Push** to `main`. The site rebuilds and publishes. If something is wrong the build stops and leaves the live site unchanged. The error message names the entry and the field.

Site text (hero, about, contact, social links, SEO), categories and the order and visibility of home sections live in `content/site.json`. Edit them the same way.

**Replacing the placeholders:** every sample entry has `"placeholder": true`. Edit it or delete it, then delete the files in `content/media/placeholder/` that are no longer referenced.

## Deploy

The site is published to GitHub Pages at https://echo1560.github.io/CesartPortfolio/ (base path `/CesartPortfolio/`).

- **Deploy:** every push to `main` runs `.github/workflows/deploy.yml` (`npm ci && npm run build`, upload `dist/`, `actions/deploy-pages`). It can also be run manually from the Actions tab (`workflow_dispatch`). Pages source is set to **GitHub Actions** in repo settings.
- **PR check:** `.github/workflows/ci.yml` runs type check, unit tests, content validation, build and e2e on every pull request.
- **Secrets:** none needed for v1. Future secrets go in GitHub's secret store, with names listed in `.env.example`.
- **Roll back:** revert the bad commit on `main` (`git revert <sha>` via PR); the deploy workflow redeploys the previous good state. For an immediate rollback, re-run the deploy workflow from the last good commit in the Actions tab.

## Backend (v2, local Supabase)

The v2 database lives in `supabase/`: migrations, seed, RLS and storage policies, and pgTAP tests. It needs Docker.

```sh
npm run db:start   # local Supabase with migrations + seed
npm run db:test    # pgTAP RLS/storage/seed tests
npm run db:test:api
```

Build from Supabase instead of `content/*.json` (the published snapshot and its media):

```sh
# one-off: upload content/media + upsert the draft tables (service-role key from env only, never committed)
eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npm run db:import   # add -- --publish to make it live

CONTENT_SOURCE=supabase PUBLIC_SUPABASE_URL=$API_URL PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY npm run build
npm run test:parity   # builds local + supabase, diffs the HTML, checks the build fails when Supabase is down
```

For a hosted project, `db:import` needs `--hosted`. The build fails loudly if Supabase is unreachable, nothing is published or the content is invalid; it never falls back to local content.

Contracts (schema, mapping to `schema.ts`, storage, Edge Functions, events, data layer): `docs/V2-CONTRACTS.md`.
