// POST /functions/v1/remove-editor (owner JWT): remove an editor and delete
// their auth account. The auth user is deleted ONLY after remove_editor()
// succeeded with the caller's JWT, so the service role can never be used to
// delete an arbitrary user id (docs/V2-CONTRACTS.md §6).
import { requireUser, rpcError, serviceClient } from '../_shared/auth.ts';
import { HttpError, ok, readJsonObject, serve, UUID_RE } from '../_shared/http.ts';

export const handler = serve(['POST'], async (req) => {
  const caller = await requireUser(req);
  const { user_id } = await readJsonObject(req, 1024);
  if (typeof user_id !== 'string' || !UUID_RE.test(user_id)) throw new HttpError('bad_request', 'user_id must be a uuid');

  // remove_editor() checks the caller is an active owner (42501), not acting on
  // themself or the last owner (PT409), and that the editor exists (PT404).
  const removed = await caller.db.rpc('remove_editor', { p_user_id: user_id });
  if (removed.error) throw rpcError(removed.error, {});

  const del = await serviceClient().auth.admin.deleteUser(user_id);
  if (del.error) {
    console.error('deleteUser failed after remove_editor', user_id, del.error);
    throw new HttpError('upstream_error', 'editor rights were removed, but the login could not be deleted');
  }
  return ok({ user_id });
});
