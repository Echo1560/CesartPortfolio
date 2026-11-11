# CesartPortfolio

Portfolio site for Cesart, an illustrator and 2D animator. It is a static Astro site, published at https://echo1560.github.io/CesartPortfolio/. Pages, sections, texts, media and the site's look are edited in a visual editor at `/CesartPortfolio/admin/`, backed by Supabase (v3). Visitors get static HTML with no editor code.

| Doc | For |
|---|---|
| [`docs/ADMIN.md`](docs/ADMIN.md) | Editors: how to use the visual editor |
| [`docs/GO-LIVE.md`](docs/GO-LIVE.md) | One-time setup of the hosted Supabase project and secrets, and the v3 upgrade |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the site, data layer, editor, database, functions and deploy fit together |
| [`docs/V3-CONTRACTS.md`](docs/V3-CONTRACTS.md) | v3 contracts: pages, sections, blocks, theme, snapshot v3, restore, v2 → v3 migration |
| [`docs/V2-CONTRACTS.md`](docs/V2-CONTRACTS.md) | v2 contracts v3 builds on: works, media, RLS, storage, RPCs, Edge Functions, events |
| [`supabase/functions/README.md`](supabase/functions/README.md) | Edge Function API reference |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Design spec |

## Run locally (no backend)

Requires Node 22 and npm.

```sh
npm ci            # install dependencies
npm run dev       # dev server at http://localhost:4321/CesartPortfolio/
npm run build     # content:prepare (validate + media variants), then astro build into dist/
npm run preview   # serve dist/ at http://localhost:4321/CesartPortfolio/
npm run check     # type check (astro check)
```

This uses the local content in `content/` (`CONTENT_SOURCE=local`, the default): the pages render `content/snapshot-v3.json`. The site is served under `/CesartPortfolio/` in dev and preview too, so open that path, not `/`. Colours, fonts, spacing and motion durations are CSS custom properties in `src/styles/tokens.css`. Under `prefers-reduced-motion: reduce` all motion is switched off and videos or animations show their poster only.

**Animated media.** `npm run content:prepare` (the first half of `npm run build`) converts every animated GIF or WebP with ffmpeg (`ffmpeg-static`, else `PATH`) into `generated/media/<key>.webm`, `<key>.mp4` and `<key>.poster.jpg`. These files are git-ignored, have no audio, and are flattened onto the page background `#f6f5f2` because H.264 has no transparency. Outputs are cached in `node_modules/.cache/cesart-media-variants/`. `npm run dev` does not run this step, so run `npm run content:prepare` once to see the video variants in dev. `MEDIA_VARIANTS` controls what happens without ffmpeg:

| `MEDIA_VARIANTS` | Behaviour |
|---|---|
| `auto` (default) | generate. Without ffmpeg, warn and keep only the GIF. |
| `required` (default when `CI` is set) | generate. Without ffmpeg, fail the build. |
| `off` | skip. Components fall back to the GIF. |

## Local development with Supabase

Needs Docker. The CLI is a dev dependency (`npx supabase`).

```sh
npm run db:start    # supabase start: Postgres, Auth, Storage, Kong, Mailpit; applies migrations + seed
npx supabase status # URLs and the local anon / service-role keys
npm run db:reset    # re-apply migrations + seed from scratch
npm run db:stop
```

The seed (`supabase/seed.sql`) loads the same content as `content/*.json`, one published snapshot, and three **local-only** accounts:

| Account | Email | Password | Role |
|---|---|---|---|
| Cesart | `cesart@example.com` | `local-only-cesart-pass` | owner |
| Echo 1560 | `echo1560@example.com` | `local-only-echo-pass` | owner |
| Visitor | `visitor@example.com` | `local-only-visitor-pass` | not an editor |

The seed does not upload files. Import them into the local bucket once (bash / Git Bash):

```sh
eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npm run db:import   # add -- --publish to make it live
```

**Editor.** Copy `.env.example` to `.env`, set `PUBLIC_SUPABASE_ANON_KEY` to the local `ANON_KEY`, run `npm run dev`, and open http://localhost:4321/CesartPortfolio/admin/. Log in with a seed account. The visual editor opens on the home page; the other views (Pages and navigation, Works, Site settings, Media library, Stats, Accounts, Activity, Publish history) are in its **Account** menu. Emails (invites, password resets) land in Mailpit at http://127.0.0.1:54324. Publish and invites also need the functions running: `npm run functions:serve` (set the secrets below in `supabase/functions/.env`, which is git-ignored, or use `npm run functions:test`, which sets test values).

**Build from Supabase** instead of `content/*.json` (the published snapshot and its media):

```sh
CONTENT_SOURCE=supabase PUBLIC_SUPABASE_URL=$API_URL PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY npm run build
```

The build fails loudly if Supabase is unreachable, nothing is published, a media download fails, or the content is invalid. It never falls back to local content.

If `supabase start` fails on a broken Docker image, skip the services the database does not need: `npx supabase start -x studio,postgres-meta,logflare,vector,imgproxy`. Keep Mailpit if you test invites. On mailpit `exec format error`, delete the cached image (`docker rmi public.ecr.aws/supabase/mailpit:<tag>`) and start again.

### Environment variables

| Variable | Where | Secret | Notes |
|---|---|---|---|
| `CONTENT_SOURCE` | build | no | `local` (default) or `supabase` |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | build, dashboard bundle | no | the anon key is public by design. RLS protects the data. Without a URL, `track()` is a no-op and the dashboard shows "not configured". |
| `MEDIA_VARIANTS` | build | no | `auto` / `required` / `off`, see above |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `npm run db:import` only | **key: yes** | set in the shell for that one command. Never in `.env` (every build loads it), never in GitHub. |
| `EVENTS_HASH_SECRET` | Edge Function secret | **yes** | random ≥ 32 bytes, derives the daily visitor-hash salt |
| `GITHUB_DISPATCH_TOKEN` | Edge Function secret | **yes** | fine-grained token, only this repo, *Contents: read and write* (for `repository_dispatch`) |
| `PUBLISH_STATUS_TOKEN` | Edge Function secret **and** GitHub Actions secret | **yes** | random ≥ 32 bytes, the same value in both places |
| `ADMIN_REDIRECT_URL` | Edge Function, optional | no | invite link target, default `https://echo1560.github.io/CesartPortfolio/admin/` |
| `GITHUB_REPOSITORY` | Edge Function, optional | no | default `Echo1560/CesartPortfolio` |
| `GITHUB_API_URL` | Edge Function, **tests only** | no | default `https://api.github.com`. The function tests point it at a mock. |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions by Supabase. The `track` function accepts browser requests only from `https://echo1560.github.io`, `http://localhost:4321` and `http://127.0.0.1:4321`. A new origin is a code change in `supabase/functions/_shared/http.ts`.

## Tests

```sh
npm test                    # unit tests (vitest)
npm run validate:content    # content/ against the schema and cross-file rules
npm run test:e2e            # Playwright e2e + axe against `npm run preview` (run `npm run build` first)
npm run check:bundle        # after a build: fails if dist/ contains a service-role JWT, secret key or token

# need the local stack (npm run db:start)
npm run db:test             # pgTAP: structure, seed = content, RLS (v2 and v3), storage, events/stats, accounts/publish, v3 migration and restore
npm run db:test:api         # Auth / PostgREST / Storage checks against the running stack
npm run db:seed:check       # fails if supabase/seed.sql is stale (db:seed:generate rebuilds it)
npm run test:parity         # after db:import: local and supabase builds produce the same pages; build fails when Supabase is down
npm run functions:test      # Edge Functions: db reset, functions serve (test secrets, GitHub mocked), Deno tests
npm run functions:test:unit # Edge Function unit tests only, no stack
npm run functions:check     # Deno type check
```

CI (`.github/workflows/ci.yml`) runs all of these on every pull request and push to `main`, plus Lighthouse and gitleaks.

## Adding content

**With the backend live, content is edited in the visual editor** (see [`docs/ADMIN.md`](docs/ADMIN.md)), not in files. `content/` is the source for local dev, the tests, the seed and the fallback build:

| File | Used for |
|---|---|
| `content/snapshot-v3.json` | what a local build renders (pages, sections, blocks, theme, nav, footer and works). Same file as `tests/fixtures/snapshot-v3.json`. |
| `content/site.json`, `content/works.json` | the v2 content: the source of `supabase/seed.sql` and `npm run db:import`, which convert it to v3 with `migrate_v2_to_v3()`. |
| `content/media/` | every file the JSON references |

`npm run validate:content` checks all three against the schemas and the files. To change the sample content, edit `site.json` / `works.json`, then:

1. `npm run db:seed:generate` so the seed stays in sync (CI checks it).
2. `npm run db:reset` on the local stack, then refresh the snapshot as in [V3-CONTRACTS §11](docs/V3-CONTRACTS.md#11-local-development-and-tests), writing it to both `tests/fixtures/snapshot-v3.json` and `content/snapshot-v3.json`.

**Media rules** (the same in the editor):

- Still images: JPG, PNG, WebP or AVIF, at least 2000px on the long edge. The build makes the smaller sizes.
- Short loops: animated WebP or GIF (type `animated`). The build makes the WebM/MP4 versions.
- Videos: MP4 (H.264) or WebM (type `video`). A `poster` JPG is **required**.
- `alt` is required. `width` and `height` set the aspect ratio, so they must match the file's proportions.
- A work's `id` and `slug` must be unique, lowercase and hyphenated. The slug becomes `/CesartPortfolio/work/<slug>/`, so do not change it later.

**Replacing the placeholders:** every sample entry has `"placeholder": true`. On the live site, Cesart replaces them in the editor (Works, and the media of each section).

## Deploy and publish

The site is published to GitHub Pages at https://echo1560.github.io/CesartPortfolio/ (base path `/CesartPortfolio/`). Pages source is **GitHub Actions** in the repo settings. First-time setup of the hosted backend: [`docs/GO-LIVE.md`](docs/GO-LIVE.md).

**Publish flow (content).**

1. An editor clicks **Publish** in the editor.
2. The `publish` Edge Function freezes the draft into a publish run (`create_publish_run()`, snapshot v3) and sends a `repository_dispatch` (type `publish`) with `GITHUB_DISPATCH_TOKEN`.
3. `.github/workflows/deploy.yml` reports `building` to `publish-status`, then builds with `CONTENT_SOURCE=supabase`. The build reads the snapshot and downloads its media with the anon key.
4. The workflow deploys to Pages and reports `succeeded` (or `failed`, with the run URL) to `publish-status` using the `x-publish-token` header. The token is masked and never printed. The editor shows Queued → Running → Success within 1–2 minutes.

A failed run never becomes live. The site stays on the previous good snapshot.

**Code deploys.** `deploy.yml` also runs on a push to `main` and manually (Actions tab, `workflow_dispatch`). Both rebuild from the current live snapshot. The workflow installs ffmpeg, runs `npm run build` (`MEDIA_VARIANTS=required`, video variants cached), runs `npm run check:bundle`, then publishes to Pages. With the Supabase secrets set, it fails loudly if they are missing (publish and manual runs), Supabase is unreachable, nothing is published, or the live snapshot is not version 3 (GO-LIVE "Upgrade to v3"). A push to `main` without them builds the local content and warns, so the site keeps deploying before go-live.

**Keep-alive.** `.github/workflows/keep-alive.yml` reads `get_published_content()` with the anon key every 3 days, so the free hosted project is not paused. It exits cleanly while the secrets are unset.

**CI.** `.github/workflows/ci.yml` runs on pull requests and pushes to `main`:

- `test`: type check, unit tests, content validation, build, bundle secret check, Playwright e2e and Lighthouse.
- `database`: local Supabase, seed check, pgTAP RLS/storage tests, API checks, content parity.
- `functions`: Deno type check and Edge Function tests, with GitHub mocked.
- `secrets`: gitleaks over the full history.

**GitHub secrets** (Settings > Secrets and variables > Actions). The values are never in the repo:

| Secret | Used by | Value |
|---|---|---|
| `SUPABASE_URL` | deploy, keep-alive | hosted project URL, e.g. `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | deploy, keep-alive | anon / publishable key (public by design, RLS protects the data) |
| `PUBLISH_STATUS_TOKEN` | deploy | the same random value as the Edge Function secret of that name |

`SUPABASE_SERVICE_ROLE_KEY` and `GITHUB_DISPATCH_TOKEN` are **not** GitHub secrets. The service-role key is only used by `npm run db:import`, run locally. The Edge Function secrets are set with `supabase secrets set` and the functions deployed with `npx supabase functions deploy` (GO-LIVE step 5).

**Roll back.**

- Bad content: change it back in the editor and publish again, or restore an earlier version (`restore_published_snapshot()`, see ADMIN.md) and publish it.
- Bad code: revert the commit on `main` (`git revert <sha>` via PR), and the deploy workflow redeploys. For an immediate rollback, re-run the deploy workflow from the last good commit in the Actions tab.
