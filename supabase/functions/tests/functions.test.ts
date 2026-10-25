// Integration tests: the real functions under `supabase functions serve`,
// against the local stack, with GitHub mocked. Run with `npm run functions:test`
// (it resets the database, serves the functions and sets the env below).
// Skipped when FUNCTIONS_URL is not set, so `deno test` alone runs only the unit tests.
import { assert, assertEquals, assertExists, assertMatch } from 'jsr:@std/assert@1';

const FUNCTIONS_URL = Deno.env.get('FUNCTIONS_URL');
const ignore = !FUNCTIONS_URL;
const API = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUBLISH_TOKEN = Deno.env.get('PUBLISH_STATUS_TOKEN') ?? '';
const GITHUB_TOKEN = Deno.env.get('GITHUB_DISPATCH_TOKEN') ?? '';
const MOCK_PORT = Number(Deno.env.get('MOCK_GITHUB_PORT') ?? '54399');

const opts = { ignore, sanitizeOps: false, sanitizeResources: false };
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const SITE = 'https://echo1560.github.io';
const IDS = {
  cesart: '11111111-1111-4111-8111-111111111111',
  echo: '22222222-2222-4222-8222-222222222222',
  visitor: '33333333-3333-4333-8333-333333333333',
};

// ---------------------------------------------------------------------------
// GitHub mock (reached from the edge runtime container via host.docker.internal)
// ---------------------------------------------------------------------------

interface Dispatch {
  path: string;
  authorization: string | null;
  body: { event_type?: string; client_payload?: { run_id?: string } };
}
const github = { status: 204, calls: [] as Dispatch[] };
const mock = ignore ? null : Deno.serve({ port: MOCK_PORT, hostname: '0.0.0.0', onListen() {} }, async (req) => {
  github.calls.push({ path: new URL(req.url).pathname, authorization: req.headers.get('authorization'), body: await req.json() });
  return new Response(github.status === 204 ? null : '{"message":"boom"}', { status: github.status });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fn(name: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, { ...init, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

const post = (name: string, body: unknown, token?: string, headers: HeadersInit = {}) =>
  fn(name, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), token, headers });

/** Service-role REST call: test setup and assertions only. */
async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  assertExists(body.access_token, `login ${email}: ${JSON.stringify(body)}`);
  return body.access_token;
}

const tokens = ignore ? null : {
  cesart: await login('cesart@example.com', 'local-only-cesart-pass'),
  echo: await login('echo1560@example.com', 'local-only-echo-pass'),
  visitor: await login('visitor@example.com', 'local-only-visitor-pass'),
};

function track(body: unknown, headers: Record<string, string> = {}) {
  return post('track', body, undefined, { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': BROWSER_UA, origin: SITE, ...headers });
}

async function eventsAt(path: string) {
  const r = await rest(`/rest/v1/events?path=eq.${encodeURIComponent(path)}&select=*&order=id`);
  assertEquals(r.status, 200);
  return r.json as Record<string, unknown>[];
}

async function authUserExists(id: string): Promise<boolean> {
  const r = await rest(`/auth/v1/admin/users/${id}`);
  return r.status === 200;
}

const unique = () => crypto.randomUUID().slice(0, 8);

// ---------------------------------------------------------------------------
// track
// ---------------------------------------------------------------------------

Deno.test({ name: 'track stores a normalised event without IP, UA or cookies', ...opts, async fn() {
  const path = `/CesartPortfolio/t-${unique()}/`;
  const ip = '203.0.113.77';
  const res = await track(
    { v: 1, name: 'work_open', path: `${path}?utm_source=x#frag`, slug: 'some-work', referrer: 'https://www.Instagram.com/p/abc', props: { source: 'lightbox', junk: 'x' } },
    { 'cf-connecting-ip': ip },
  );
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('set-cookie'), null);

  const rows = await eventsAt(path);
  assertEquals(rows.length, 1);
  const row = rows[0];
  assertEquals(row.name, 'work_open');
  assertEquals(row.work_slug, 'some-work');
  assertEquals(row.referrer_host, 'www.instagram.com');
  assertEquals(row.device, 'desktop');
  assertEquals(row.props, { source: 'lightbox' });
  assertMatch(String(row.visitor_hash), /^[0-9a-f]{64}$/);
  const stored = JSON.stringify(row);
  assert(!stored.includes(ip), 'raw IP stored');
  assert(!stored.includes('Firefox'), 'user agent stored');
}});

Deno.test({ name: 'track rejects malformed and oversized payloads', ...opts, async fn() {
  const bad = [
    'not json',
    '[1,2]',
    { v: 2, name: 'page_view', path: '/' },
    { v: 1, name: 'drop_table', path: '/' },
    { v: 1, name: 'page_view', path: 'https://evil.example/' },
    { v: 1, name: 'work_open', path: '/' },
    { v: 1, name: 'work_open', path: '/', slug: '../etc' },
  ];
  for (const body of bad) {
    const r = await track(body);
    assertEquals(r.status, 400, JSON.stringify(body));
    assertEquals(r.json.error.code, 'bad_request');
  }
  const big = await track({ v: 1, name: 'page_view', path: '/', props: { pad: 'x'.repeat(3000) } });
  assertEquals(big.status, 413);
  assertEquals(big.json.error.code, 'payload_too_large');
}});

Deno.test({ name: 'track: method and origin rules', ...opts, async fn() {
  // CORS headers themselves are unit-tested (_shared/shared.test.ts): the local
  // Kong gateway adds its own permissive CORS on /functions, the hosted gateway does not.
  const get = await fn('track');
  assertEquals(get.status, 405);
  assertEquals(get.json.error.code, 'method_not_allowed');
  const foreign = await track({ v: 1, name: 'page_view', path: '/' }, { origin: 'https://evil.example' });
  assertEquals(foreign.status, 403);
  assertEquals(foreign.json.error.code, 'forbidden');
  const dev = await track({ v: 1, name: 'page_view', path: `/dev-${unique()}/` }, { origin: 'http://localhost:4321' });
  assertEquals(dev.status, 204);
}});

Deno.test({ name: 'track rate-limits each visitor to 60 events per minute', ...opts, async fn() {
  const path = `/rl-${unique()}/`;
  const headers = { 'cf-connecting-ip': '198.51.100.9', 'user-agent': `${BROWSER_UA} rl-${unique()}` };
  for (let i = 0; i < 65; i++) {
    const r = await track({ v: 1, name: 'page_view', path }, headers);
    assertEquals(r.status, 204, 'rate-limited events still answer 204');
  }
  assertEquals((await eventsAt(path)).length, 60);
  // Another visitor is not affected.
  const other = await track({ v: 1, name: 'page_view', path }, { 'cf-connecting-ip': '198.51.100.10' });
  assertEquals(other.status, 204);
  assertEquals((await eventsAt(path)).length, 61);
}});

Deno.test({ name: 'track ignores spoofed x-forwarded-for entries and stores bots as bots', ...opts, async fn() {
  const path = `/xff-${unique()}/`;
  const ua = `${BROWSER_UA} xff-${unique()}`;
  await track({ v: 1, name: 'page_view', path }, { 'user-agent': ua, 'x-forwarded-for': '6.6.6.1' });
  await track({ v: 1, name: 'page_view', path }, { 'user-agent': ua, 'x-forwarded-for': '6.6.6.2' });
  const rows = await eventsAt(path);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].visitor_hash, rows[1].visitor_hash);

  const botPath = `/bot-${unique()}/`;
  assertEquals((await track({ v: 1, name: 'page_view', path: botPath }, { 'user-agent': 'Googlebot/2.1' })).status, 204);
  assertEquals((await eventsAt(botPath))[0].device, 'bot');
}});

// ---------------------------------------------------------------------------
// publish + publish-status
// ---------------------------------------------------------------------------

Deno.test({ name: 'publish and publish-status reject unauthenticated and non-editor callers', ...opts, async fn() {
  for (const token of [undefined, 'not-a-jwt', `${tokens!.cesart.slice(0, -4)}AAAA`]) {
    const p = await post('publish', {}, token);
    assertEquals(p.status, 401);
    assertEquals(p.json, { ok: false, error: { code: 'unauthorized', message: p.json.error.message } });
    assertEquals((await fn('publish-status', { token })).status, 401);
  }
  const p = await post('publish', {}, tokens!.visitor);
  assertEquals(p.status, 403);
  assertEquals(p.json.error.code, 'forbidden');
  assertEquals((await fn('publish-status', { token: tokens!.visitor })).status, 403);
  assertEquals((await fn('publish', { token: tokens!.cesart })).status, 405);
  assertEquals(github.calls.length, 0);
}});

Deno.test({ name: 'publish flow: dispatch, conflict, workflow status reports', ...opts, async fn(t) {
  let runId = '';

  await t.step('an editor publishes and GitHub gets a repository_dispatch', async () => {
    github.status = 204;
    github.calls = [];
    const r = await post('publish', {}, tokens!.cesart);
    assertEquals(r.status, 200, JSON.stringify(r.json));
    assertEquals(r.json.ok, true);
    runId = r.json.run.id;
    assertEquals(r.json.run.status, 'dispatched');
    assertMatch(r.json.run.content_hash, /^[0-9a-f]{64}$/);
    assertEquals(github.calls.length, 1);
    assertEquals(github.calls[0].path, '/repos/Echo1560/CesartPortfolio/dispatches');
    assertEquals(github.calls[0].authorization, `Bearer ${GITHUB_TOKEN}`);
    assertEquals(github.calls[0].body, { event_type: 'publish', client_payload: { run_id: runId } });

    const row = (await rest(`/rest/v1/publish_runs?id=eq.${runId}&select=status,requested_by,dispatched_at`)).json[0];
    assertEquals(row.status, 'dispatched');
    assertEquals(row.requested_by, IDS.cesart);
    assertExists(row.dispatched_at);
  });

  await t.step('a second publish while one is in flight is a conflict', async () => {
    const r = await post('publish', {}, tokens!.echo);
    assertEquals(r.status, 409);
    assertEquals(r.json.error.code, 'conflict');
    assertEquals(github.calls.length, 1);
  });

  await t.step('status reports need the publish token', async () => {
    const body = { run_id: runId, status: 'building' };
    assertEquals((await post('publish-status', body)).status, 401);
    assertEquals((await post('publish-status', body, undefined, { 'x-publish-token': 'wrong' })).status, 401);
    assertEquals((await post('publish-status', body, tokens!.cesart)).status, 401); // an editor JWT is not enough
  });

  const report = (body: unknown) => post('publish-status', body, undefined, { 'x-publish-token': PUBLISH_TOKEN });

  await t.step('status reports are validated', async () => {
    assertEquals((await report({ run_id: runId, status: 'pending' })).status, 400);
    assertEquals((await report({ run_id: 'nope', status: 'building' })).status, 400);
    assertEquals((await report({ run_id: runId, status: 'building', github_run_url: 'https://evil.example/' })).status, 400);
    const missing = await report({ run_id: crypto.randomUUID(), status: 'building' });
    assertEquals(missing.status, 404);
    assertEquals(missing.json.error.code, 'not_found');
  });

  const runUrl = 'https://github.com/Echo1560/CesartPortfolio/actions/runs/1';

  await t.step('building, then the editor sees it in the list', async () => {
    const r = await report({ run_id: runId, status: 'building', github_run_url: runUrl });
    assertEquals(r.status, 200);
    assertEquals(r.json.run.status, 'building');

    const list = await fn('publish-status?limit=5', { token: tokens!.echo });
    assertEquals(list.status, 200);
    const latest = list.json.runs[0];
    assertEquals(latest.id, runId);
    assertEquals(latest.status, 'building');
    assertEquals(latest.requested_by_name, 'Cesart');
    assertEquals(latest.github_run_url, runUrl);
    assert(!('snapshot' in latest));
    assertEquals((await fn('publish-status?limit=0', { token: tokens!.echo })).status, 400);
  });

  await t.step('succeeded is final', async () => {
    const r = await report({ run_id: runId, status: 'succeeded' });
    assertEquals(r.status, 200);
    assertExists(r.json.run.finished_at);
    const again = await report({ run_id: runId, status: 'failed', error: 'late' });
    assertEquals(again.status, 409);
    assertEquals(again.json.error.code, 'conflict');
  });

  await t.step('a failed GitHub dispatch marks the run failed and the live content stays', async () => {
    const before = (await rest('/rest/v1/rpc/get_published_content', { method: 'POST', body: '{}' })).json;
    github.status = 500;
    const r = await post('publish', {}, tokens!.echo);
    github.status = 204;
    assertEquals(r.status, 502);
    assertEquals(r.json.error.code, 'upstream_error');
    const failed = (await rest('/rest/v1/publish_runs?select=status,error&order=requested_at.desc&limit=1')).json[0];
    assertEquals(failed.status, 'failed');
    assertMatch(failed.error, /HTTP 500/);
    assert(!failed.error.includes(GITHUB_TOKEN), 'token leaked into the error');
    const after = (await rest('/rest/v1/rpc/get_published_content', { method: 'POST', body: '{}' })).json;
    assertEquals(after, before);
  });

  await t.step('content that cannot be published is unprocessable', async () => {
    const hero = (await rest('/rest/v1/media_placements?slot=eq.hero&select=*')).json;
    assertEquals(hero.length, 1);
    assertEquals((await rest(`/rest/v1/media_placements?id=eq.${hero[0].id}`, { method: 'DELETE' })).status, 204);
    try {
      const calls = github.calls.length;
      const r = await post('publish', {}, tokens!.cesart);
      assertEquals(r.status, 422);
      assertEquals(r.json.error.code, 'unprocessable');
      assertEquals(github.calls.length, calls);
    } finally {
      const back = await rest('/rest/v1/media_placements', { method: 'POST', body: JSON.stringify(hero[0]) });
      assertEquals(back.status, 201);
    }
  });
}});

// ---------------------------------------------------------------------------
// invite-editor + remove-editor
// ---------------------------------------------------------------------------

Deno.test({ name: 'invite-editor and remove-editor: auth, validation, conflicts, rate limit', ...opts, async fn(t) {
  const email = `invitee-${unique()}@example.com`;
  let invitedId = '';
  let invitedToken = '';

  await t.step('callers without an owner session are rejected', async () => {
    const body = { email, display_name: 'Nope' };
    assertEquals((await post('invite-editor', body)).status, 401);
    assertEquals((await post('invite-editor', body, 'garbage')).status, 401);
    const v = await post('invite-editor', body, tokens!.visitor);
    assertEquals(v.status, 403);
    assertEquals(v.json.error.code, 'forbidden');
    assertEquals((await post('remove-editor', { user_id: IDS.echo })).status, 401);
    assertEquals((await post('remove-editor', { user_id: IDS.echo }, tokens!.visitor)).status, 403);
    assert(await authUserExists(IDS.echo));
  });

  await t.step('input is validated', async () => {
    assertEquals((await post('invite-editor', { email: 'not-an-email', display_name: 'X' }, tokens!.cesart)).status, 400);
    assertEquals((await post('invite-editor', { email, display_name: '   ' }, tokens!.cesart)).status, 400);
    assertEquals((await post('invite-editor', '{', tokens!.cesart)).status, 400);
    assertEquals((await post('remove-editor', { user_id: 'nope' }, tokens!.cesart)).status, 400);
  });

  await t.step('existing editors and existing accounts are conflicts', async () => {
    const editor = await post('invite-editor', { email: 'Echo1560@Example.com', display_name: 'Echo' }, tokens!.cesart);
    assertEquals(editor.status, 409);
    assertEquals(editor.json.error.code, 'conflict');
    const account = await post('invite-editor', { email: 'visitor@example.com', display_name: 'Visitor' }, tokens!.cesart);
    assertEquals(account.status, 409);
  });

  await t.step('an owner invites a new editor', async () => {
    const r = await post('invite-editor', { email, display_name: 'New Editor' }, tokens!.cesart);
    assertEquals(r.status, 200, JSON.stringify(r.json));
    invitedId = r.json.editor.user_id;
    assertEquals(r.json.editor, { user_id: invitedId, email, display_name: 'New Editor' });

    const row = (await rest(`/rest/v1/editors?user_id=eq.${invitedId}&select=role,invited_by,email`)).json[0];
    assertEquals(row, { role: 'editor', invited_by: IDS.cesart, email });
    const log = (await rest(`/rest/v1/activity_log?action=eq.invite&row_id=eq.${invitedId}&select=actor_id`)).json;
    assertEquals(log, [{ actor_id: IDS.cesart }]);
  });

  await t.step('a non-owner editor cannot invite or remove', async () => {
    const set = await rest(`/auth/v1/admin/users/${invitedId}`, {
      method: 'PUT',
      body: JSON.stringify({ password: 'local-only-invitee-pass', email_confirm: true }),
    });
    assertEquals(set.status, 200);
    invitedToken = await login(email, 'local-only-invitee-pass');
    const inv = await post('invite-editor', { email: `x-${unique()}@example.com`, display_name: 'X' }, invitedToken);
    assertEquals(inv.status, 403);
    const rm = await post('remove-editor', { user_id: IDS.echo }, invitedToken);
    assertEquals(rm.status, 403);
    assert(await authUserExists(IDS.echo));
  });

  await t.step('remove-editor never deletes a user the RPC refused', async () => {
    const self = await post('remove-editor', { user_id: IDS.cesart }, tokens!.cesart);
    assertEquals(self.status, 409);
    assert(await authUserExists(IDS.cesart));
    // The visitor has an auth account but no editors row: the service role must not delete it.
    const notEditor = await post('remove-editor', { user_id: IDS.visitor }, tokens!.cesart);
    assertEquals(notEditor.status, 404);
    assertEquals(notEditor.json.error.code, 'not_found');
    assert(await authUserExists(IDS.visitor));
    assertEquals((await post('remove-editor', { user_id: crypto.randomUUID() }, tokens!.cesart)).status, 404);
  });

  await t.step('an owner removes the editor and their login', async () => {
    const r = await post('remove-editor', { user_id: invitedId }, tokens!.echo);
    assertEquals(r.status, 200);
    assertEquals(r.json, { ok: true, user_id: invitedId });
    assertEquals((await rest(`/rest/v1/editors?user_id=eq.${invitedId}&select=user_id`)).json, []);
    assert(!(await authUserExists(invitedId)));
  });

  await t.step('at most 10 invites per owner per day', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ actor_id: IDS.echo, action: 'invite', table_name: 'editors', row_id: `fake-${i}` }));
    assertEquals((await rest('/rest/v1/activity_log', { method: 'POST', body: JSON.stringify(rows) })).status, 201);
    const limited = `limited-${unique()}@example.com`;
    const r = await post('invite-editor', { email: limited, display_name: 'Limited' }, tokens!.echo);
    assertEquals(r.status, 429);
    assertEquals(r.json.error.code, 'rate_limited');
    assertEquals((await rest(`/rest/v1/editors?email=eq.${limited}&select=user_id`)).json, []);
  });
}});

Deno.test({ name: 'shut down the GitHub mock', ignore, async fn() {
  await mock?.shutdown();
}});
