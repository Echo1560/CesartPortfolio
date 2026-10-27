# Edge Functions

Deno functions for the v2 backend. The contract is `docs/V2-CONTRACTS.md` §6–7; this file is the short API reference.

| Function | Auth | Purpose |
|---|---|---|
| `track` | public | analytics beacon → `record_event()` |
| `publish` | editor JWT | freeze the draft, trigger the GitHub Pages rebuild |
| `publish-status` | editor JWT (GET) / `x-publish-token` (POST) | list runs / workflow reports progress |
| `invite-editor` | owner JWT | invite a new editor by email |
| `remove-editor` | owner JWT | remove an editor and delete their login |

Disabling and re-enabling an editor needs no function: the dashboard calls the owner-only `set_editor_disabled` RPC directly.

Every response is `{"ok": true, ...}` or `{"ok": false, "error": {"code", "message"}}`, except `track`, which answers an empty 204. Error codes are listed in the contract (§6).

## Layout

```
_shared/http.ts     envelope, error codes, CORS, method check, size-capped body reader
_shared/auth.ts     JWT verification (auth.getUser), is_editor()/is_owner() with the caller's JWT, service client, SQLSTATE → error code
_shared/crypto.ts   daily-salted visitor hash, constant-time compare
_shared/github.ts   repository_dispatch
<name>/handler.ts   the function (exported `handler`)
<name>/index.ts     Deno.serve(handler)
tests/              integration tests against `supabase functions serve`
```

The service-role key is read only in `_shared/auth.ts` (`serviceClient()`), and only after the caller has been checked.

## Endpoints

### `POST /functions/v1/track`

Body (`text/plain` JSON, ≤ 2 KiB): `{"v": 1, "name": "page_view|work_open|video_play|contact_click", "path": "/…", "slug"?: "kebab", "referrer"?: "url", "props"?: {…}}`.

- **204**: stored, rate-limited or bot. The client cannot tell which.
- **400** `bad_request`: bad JSON, unknown `v`/`name`, a path that does not start with `/`, a bad slug, or `work_open` without a slug.
- **413** `payload_too_large`: body over 2 KiB.
- **403** `forbidden`: a browser `Origin` that is not one of the site origins.

Normalisation: query/hash stripped from `path`, referrer reduced to an external hostname, device derived from the User-Agent, unknown props dropped. The visitor hash is `HMAC(HMAC(EVENTS_HASH_SECRET, UTC day), ip|ua)`, using the platform-set IP (`cf-connecting-ip`, `x-real-ip`, last `x-forwarded-for`). No IP, UA or cookie is stored. Rate limits (60/visitor/min, 1200/min site-wide) are enforced by `record_event()`.

### `POST /functions/v1/publish`

Header `Authorization: Bearer <editor JWT>`, body `{}`.

- **200** `{"ok": true, "run": {id, status: "dispatched", requested_at, content_hash}}`
- **401** no/invalid session · **403** not an active editor · **409** a run is in flight · **422** missing hero media or categories · **502** GitHub dispatch failed (the run is marked `failed`, and the live site keeps the previous snapshot).

### `GET /functions/v1/publish-status?limit=10`

Editor JWT. `limit` must be 1–50. Returns `{"ok": true, "runs": [{id, status, requested_at, requested_by_name, dispatched_at, finished_at, github_run_url, error}]}`, newest first. 401 / 403 as above, 400 for a bad `limit`.

### `POST /functions/v1/publish-status`

Header `x-publish-token: $PUBLISH_STATUS_TOKEN` (deploy workflow). Body `{"run_id": uuid, "status": "building|succeeded|failed", "github_run_url"?: "https://github.com/…", "error"?: string}`.

- **200** `{"ok": true, "run": {id, status, finished_at}}`
- **401** missing/wrong token (constant-time compare; also when the secret is unset) · **400** bad fields · **404** unknown run · **409** run already finished.

### `POST /functions/v1/invite-editor`

Owner JWT. Body `{"email": "...", "display_name": "..."}`.

- **200** `{"ok": true, "editor": {user_id, email, display_name}}`. The invite email links to `ADMIN_REDIRECT_URL`, and the new account has role `editor`.
- **401** · **403** not an active owner · **400** bad email/name · **409** already an editor, or an auth account with that email exists · **429** more than 10 invites by this owner in 24 h · **502** Auth could not send the invite. If registration fails after the invite, the invited auth user is deleted again.

### `POST /functions/v1/remove-editor`

Owner JWT. Body `{"user_id": uuid}`.

- **200** `{"ok": true, "user_id"}`: the editors row and the auth user are deleted.
- **401** · **400** bad uuid · **403** not an active owner · **404** not an editor · **409** yourself or the last active owner · **502** the rights were removed but deleting the login failed. On any RPC error nothing is deleted.

## Secrets

Set on the hosted project with `supabase secrets set` (never in the repo or the site build):

| Name | Required | Notes |
|---|---|---|
| `EVENTS_HASH_SECRET` | yes | random ≥ 32 bytes; `track` answers 500 without it |
| `GITHUB_DISPATCH_TOKEN` | yes | fine-grained token, this repo only, "Contents: read & write" |
| `PUBLISH_STATUS_TOKEN` | yes | random ≥ 32 bytes; same value as the GitHub Actions secret |
| `ADMIN_REDIRECT_URL` | no | default `https://echo1560.github.io/CesartPortfolio/admin/` |
| `GITHUB_REPOSITORY`, `GITHUB_API_URL` | no | defaults `Echo1560/CesartPortfolio`, `https://api.github.com` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the platform.

Deploy: `npx supabase functions deploy` (it reads `verify_jwt = false` from `supabase/config.toml`).

## Tests

```sh
npm run db:start            # local stack; include mailpit (invites send email)
npm run functions:test      # db reset → functions serve (test secrets, GitHub mocked) → deno test
npm run functions:test:unit # unit tests only, no stack
npm run functions:check     # type-check
```

The GitHub mock runs on the host (port 54399). Containers reach it through `host.docker.internal` on Docker Desktop and through the Supabase network gateway on Linux. The local Kong gateway adds its own permissive CORS headers on `/functions`, so CORS is covered by the unit tests rather than the integration tests.

If `supabase start` fails on mailpit with `exec format error`, the cached image is corrupt: `docker rmi public.ecr.aws/supabase/mailpit:<tag>` and start again.
