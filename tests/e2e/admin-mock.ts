// Fake Supabase for the dashboard e2e specs. The admin bundle is built against API_URL
// (see the `admin` project in playwright.config.ts) and every request to it is answered here,
// so no real backend, GitHub or email is ever contacted.
import type { Page, Route } from '@playwright/test';

export const API_URL = 'http://127.0.0.1:54399';
export const ADMIN = '/CesartPortfolio/admin/';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const OWNER_ID = '00000000-0000-4000-8000-000000000001';

export interface Editor { user_id: string; display_name: string; email: string; role: 'owner' | 'editor'; disabled_at: string | null; created_at: string }
export interface StatEvent { day: string; name: string; visitor: string; referrer_host?: string; device: string; slug?: string }

export interface Backend {
  editors: Editor[];
  events: StatEvent[];
  /** Every Edge Function call, in order. */
  calls: { name: string; method: string; body: unknown }[];
  /** `publish-status` answers, one per GET; the last one repeats. */
  runs: unknown[][];
  /** Edge Function name -> response override. */
  fn: Record<string, (body: any) => { status?: number; json: unknown }>;
}

export function newBackend(): Backend {
  return {
    editors: [{ user_id: OWNER_ID, display_name: 'Cesart', email: 'cesart@example.com', role: 'owner', disabled_at: null, created_at: '2026-01-01T00:00:00Z' }],
    events: [],
    calls: [],
    runs: [[]],
    fn: {},
  };
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

function stats(name: string, a: { p_from: string; p_to: string; p_limit?: number }, events: StatEvent[]) {
  const inRange = events.filter((e) => e.day >= a.p_from.slice(0, 10) && e.day < a.p_to.slice(0, 10));
  const views = inRange.filter((e) => e.name === 'page_view');
  const uniq = (xs: StatEvent[]) => new Set(xs.map((e) => e.visitor)).size;
  const group = <K extends string>(xs: StatEvent[], key: (e: StatEvent) => string | undefined, out: K) =>
    Object.entries(xs.reduce<Record<string, number>>((m, e) => ((m[key(e) ?? ''] = (m[key(e) ?? ''] ?? 0) + 1), m), {}))
      .filter(([k]) => k)
      .map(([k, n]) => ({ [out]: k, page_views: n }))
      .sort((x: any, y: any) => y.page_views - x.page_views);
  switch (name) {
    case 'stats_overview':
      return [{ page_views: views.length, visitors: uniq(views), work_opens: inRange.filter((e) => e.name === 'work_open').length, video_plays: inRange.filter((e) => e.name === 'video_play').length, contact_clicks: inRange.filter((e) => e.name === 'contact_click').length }];
    case 'stats_daily':
      return [...new Set(views.map((e) => e.day))].sort().map((day) => ({ day, page_views: views.filter((e) => e.day === day).length, visitors: uniq(views.filter((e) => e.day === day)) }));
    case 'stats_top_works': {
      const slugs = [...new Set(inRange.filter((e) => e.slug).map((e) => e.slug!))];
      return slugs.map((s) => ({ work_slug: s, title: `Work ${s}`, opens: inRange.filter((e) => e.slug === s && e.name === 'work_open').length, video_plays: inRange.filter((e) => e.slug === s && e.name === 'video_play').length })).sort((x, y) => y.opens - x.opens);
    }
    case 'stats_referrers':
      return group(views, (e) => e.referrer_host, 'referrer_host');
    case 'stats_devices':
      return group(views, (e) => e.device, 'device');
  }
  return [];
}

/** Signs in as the seeded owner and answers every Supabase request from `backend`. */
export async function mountAdmin(page: Page, backend: Backend, hash = ''): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: OWNER_ID, role: 'authenticated', exp: now + 36000 })}.sig`;
  const session = { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000, user: { id: OWNER_ID, email: 'cesart@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
  await page.addInitScript((s) => localStorage.setItem('sb-127-auth-token', JSON.stringify(s)), session);

  let polls = 0;
  await page.route(`${API_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });

    const fnMatch = url.pathname.match(/^\/functions\/v1\/([\w-]+)$/);
    if (fnMatch) {
      const name = fnMatch[1]!;
      const body = req.method() === 'POST' ? req.postDataJSON() : undefined;
      backend.calls.push({ name, method: req.method(), body });
      if (backend.fn[name]) {
        const r = backend.fn[name]!(body);
        return json(route, r.json, r.status ?? 200);
      }
      if (name === 'publish-status') return json(route, { ok: true, runs: backend.runs[Math.min(polls++, backend.runs.length - 1)] });
      if (name === 'invite-editor') {
        const editor: Editor = { user_id: `00000000-0000-4000-8000-${String(backend.editors.length + 1).padStart(12, '0')}`, display_name: body.display_name, email: body.email, role: 'editor', disabled_at: null, created_at: new Date().toISOString() };
        backend.editors.push(editor);
        return json(route, { ok: true, editor });
      }
      return json(route, { ok: true });
    }

    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc) {
      const name = rpc[1]!;
      if (name === 'is_editor' || name === 'is_owner') return json(route, true);
      return json(route, stats(name, req.postDataJSON(), backend.events));
    }

    const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (table) {
      const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      if (table === 'editors') return json(route, backend.editors);
      if (table === 'site') return json(route, single ? { id: 1, updated_at: '2026-01-01T00:00:00Z', updated_by: null } : []);
      return json(route, []);
    }
    return json(route, {});
  });

  await page.goto(ADMIN + hash);
}
