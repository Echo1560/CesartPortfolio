// /functions/v1/publish-status (docs/V2-CONTRACTS.md §6)
//   GET  (editor JWT)                 latest publish runs, newest first
//   POST (x-publish-token, workflow)  report building / succeeded / failed
import { requireEditor, rpcError, serviceClient } from '../_shared/auth.ts';
import { timingSafeEqual } from '../_shared/crypto.ts';
import { HttpError, ok, readJsonObject, serve, UUID_RE } from '../_shared/http.ts';

const REPORTABLE = ['building', 'succeeded', 'failed'];

async function list(req: Request): Promise<Response> {
  const caller = await requireEditor(req);
  const raw = new URL(req.url).searchParams.get('limit');
  const limit = raw === null ? 10 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpError('bad_request', 'limit must be 1–50');

  const runs = await caller.db
    .from('publish_runs')
    .select('id, status, requested_at, requested_by, dispatched_at, finished_at, github_run_url, error')
    .order('requested_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (runs.error) throw rpcError(runs.error, {});

  const ids = [...new Set(runs.data.map((r) => r.requested_by).filter((v): v is string => v !== null))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const eds = await caller.db.from('editors').select('user_id, display_name').in('user_id', ids);
    if (eds.error) throw rpcError(eds.error, {});
    for (const e of eds.data) names.set(e.user_id, e.display_name);
  }

  return ok({
    runs: runs.data.map(({ requested_by, ...r }) => ({
      ...r,
      requested_by_name: requested_by ? (names.get(requested_by) ?? null) : null,
    })),
  });
}

async function report(req: Request): Promise<Response> {
  const expected = Deno.env.get('PUBLISH_STATUS_TOKEN') ?? '';
  const given = req.headers.get('x-publish-token') ?? '';
  // Fail closed when the secret is not configured.
  if (expected.length < 16 || !(await timingSafeEqual(given, expected))) {
    throw new HttpError('unauthorized', 'missing or invalid publish token');
  }

  const body = await readJsonObject(req, 4096);
  const { run_id, status, github_run_url, error } = body;
  if (typeof run_id !== 'string' || !UUID_RE.test(run_id)) throw new HttpError('bad_request', 'run_id must be a uuid');
  if (typeof status !== 'string' || !REPORTABLE.includes(status)) {
    throw new HttpError('bad_request', `status must be one of ${REPORTABLE.join(', ')}`);
  }
  if (github_run_url !== undefined && github_run_url !== null &&
      (typeof github_run_url !== 'string' || !/^https:\/\/github\.com\/\S+$/.test(github_run_url) || github_run_url.length > 500)) {
    throw new HttpError('bad_request', 'github_run_url must be an https://github.com/ URL');
  }
  if (error !== undefined && error !== null && typeof error !== 'string') throw new HttpError('bad_request', 'error must be a string');

  const updated = await serviceClient().rpc('update_publish_run', {
    p_id: run_id,
    p_status: status,
    p_github_run_url: github_run_url ?? null,
    p_error: typeof error === 'string' ? error.slice(0, 2000) : null,
  });
  if (updated.error) throw rpcError(updated.error, {});
  const r = updated.data as { id: string; status: string; finished_at: string | null };
  return ok({ run: { id: r.id, status: r.status, finished_at: r.finished_at } });
}

export const handler = serve(['GET', 'POST'], (req) => (req.method === 'GET' ? list(req) : report(req)));
