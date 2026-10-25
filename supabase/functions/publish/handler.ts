// POST /functions/v1/publish (editor JWT): freeze the draft into a publish run
// and trigger the GitHub Pages rebuild (docs/V2-CONTRACTS.md §6).
import { requireEditor, rpcError, serviceClient } from '../_shared/auth.ts';
import { dispatchPublish } from '../_shared/github.ts';
import { HttpError, ok, readJsonObject, serve } from '../_shared/http.ts';

interface Run {
  id: string;
  status: string;
  requested_at: string;
  content_hash: string;
}

export const handler = serve(['POST'], async (req) => {
  const caller = await requireEditor(req);
  await readJsonObject(req, 1024); // body is `{}`; reject garbage and oversized bodies

  // With the caller's JWT: RLS applies and the run + activity_log are attributed to them.
  const created = await caller.db.rpc('create_publish_run');
  if (created.error) throw rpcError(created.error, {});
  const run = created.data as Run;

  const admin = serviceClient();
  try {
    await dispatchPublish(run.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('publish dispatch failed', run.id, message);
    const failed = await admin.rpc('update_publish_run', { p_id: run.id, p_status: 'failed', p_error: message });
    if (failed.error) console.error('could not mark run failed', run.id, failed.error);
    throw new HttpError('upstream_error', 'could not start the site rebuild on GitHub');
  }

  const updated = await admin.rpc('update_publish_run', { p_id: run.id, p_status: 'dispatched' });
  // PT409: the workflow already reported a final status; the dispatch still happened.
  if (updated.error && updated.error.code !== 'PT409') throw rpcError(updated.error, {});
  const r = (updated.data as Run | null) ?? run;
  return ok({ run: { id: r.id, status: r.status, requested_at: r.requested_at, content_hash: r.content_hash } });
});
