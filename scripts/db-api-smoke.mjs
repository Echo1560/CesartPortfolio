/**
 * `npm run db:test:api`: end-to-end checks against the running LOCAL stack
 * (`supabase start` + `supabase db reset`), through the real Auth, PostgREST and
 * Storage APIs. Complements the pgTAP tests, which cannot see auth config or the
 * bucket's MIME/size enforcement.
 *
 * Reads the local URL and anon key from `supabase status`. Never point it at a
 * hosted project: it signs in with the local-only seed accounts.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const url = status.API_URL;
const anon = status.ANON_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error(`✗ refusing to run against a non-local API (${url})`);
  process.exit(1);
}

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
}

async function call(path, { token = anon, method = 'GET', body, type = 'application/json' } = {}) {
  const res = await fetch(url + path, {
    method,
    headers: { apikey: anon, authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': type } : {}) },
    body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function login(email, password) {
  const r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  return r.json.access_token;
}

const signup = await call('/auth/v1/signup', { method: 'POST', body: { email: 'stranger@example.com', password: 'stranger-password-1' } });
check('public sign-up is disabled', signup.json?.error_code === 'signup_disabled', JSON.stringify(signup.json));

const editor = await login('cesart@example.com', 'local-only-cesart-pass');
const visitor = await login('visitor@example.com', 'local-only-visitor-pass');
check('seeded editor can sign in with a password', Boolean(editor), 'no access token');
check('seeded non-editor can sign in', Boolean(visitor), 'no access token');

const anonWorks = await call('/rest/v1/works?select=id');
check('anon cannot read draft tables', anonWorks.status === 401 || anonWorks.status === 403, `HTTP ${anonWorks.status}`);
const live = await call('/rest/v1/rpc/get_published_content', { method: 'POST', body: {} });
check('anon reads the published content', live.status === 200 && Array.isArray(live.json?.works), `HTTP ${live.status}`);

const visitorWorks = await call('/rest/v1/works?select=id', { token: visitor });
check('non-editor sees no draft rows', visitorWorks.status === 200 && visitorWorks.json.length === 0, JSON.stringify(visitorWorks.json));
const editorWorks = await call('/rest/v1/works?select=id', { token: editor });
check('editor sees draft rows', editorWorks.status === 200 && editorWorks.json.length > 0, JSON.stringify(editorWorks.json));

const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const key = `uploads/smoke-${Date.now()}.gif`;
const up = await call(`/storage/v1/object/media/${key}`, { token: editor, method: 'POST', body: gif, type: 'image/gif' });
check('editor can upload a GIF', up.status === 200, JSON.stringify(up.json));
const svg = await call(`/storage/v1/object/media/uploads/smoke-${Date.now()}.svg`, { token: editor, method: 'POST', body: '<svg/>', type: 'image/svg+xml' });
check('SVG upload is rejected by the MIME allow-list', svg.status === 415 || svg.json?.statusCode === '415', JSON.stringify(svg.json));
const big = await call(`/storage/v1/object/media/uploads/smoke-big-${Date.now()}.gif`, { token: editor, method: 'POST', body: new Uint8Array(26 * 1024 * 1024), type: 'image/gif' });
check('uploads over 25 MiB are rejected', big.status === 413 || big.json?.statusCode === '413', JSON.stringify(big.json));
const visitorUp = await call(`/storage/v1/object/media/uploads/smoke-v-${Date.now()}.gif`, { token: visitor, method: 'POST', body: gif, type: 'image/gif' });
check('non-editor cannot upload', visitorUp.status === 400 || visitorUp.status === 403, `HTTP ${visitorUp.status}`);
const anonDraft = await call(`/storage/v1/object/authenticated/media/${key}`);
check('anon cannot download a draft upload', anonDraft.status >= 400, `HTTP ${anonDraft.status}`);

// A file referenced by the live snapshot is readable with the anon key (this is how the build downloads media).
const publishedKey = live.json.site.meta.ogImage;
const jpg = readFileSync(join('content', 'media', publishedKey));
await call(`/storage/v1/object/media/${publishedKey}`, { token: editor, method: 'POST', body: jpg, type: 'image/jpeg' });
const anonPublished = await call(`/storage/v1/object/authenticated/media/${publishedKey}`);
check('anon can download a published file', anonPublished.status === 200, `HTTP ${anonPublished.status}`);

await call('/storage/v1/object/media', { token: editor, method: 'DELETE', body: { prefixes: [key, publishedKey] } });

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll API checks passed');
