// POST /functions/v1/invite-editor (owner JWT): invite a new editor by email.
// Sign-ups stay disabled; this is the only way an account is created
// (docs/V2-CONTRACTS.md §6).
import { requireOwner, rpcError, serviceClient } from '../_shared/auth.ts';
import { HttpError, ok, readJsonObject, serve } from '../_shared/http.ts';

export const INVITES_PER_DAY = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_REDIRECT = 'https://echo1560.github.io/CesartPortfolio/admin/';

function parse(body: Record<string, unknown>): { email: string; displayName: string } {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError('bad_request', 'a valid email is required');
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  if (displayName.length < 1 || displayName.length > 80) throw new HttpError('bad_request', 'display_name must be 1–80 characters');
  return { email, displayName };
}

export const handler = serve(['POST'], async (req) => {
  const caller = await requireOwner(req);
  const { email, displayName } = parse(await readJsonObject(req, 2048));
  const admin = serviceClient();

  const existing = await caller.db.from('editors').select('user_id').eq('email', email).maybeSingle();
  if (existing.error) throw rpcError(existing.error, {});
  if (existing.data) throw new HttpError('conflict', 'this email is already an editor');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sent = await admin
    .from('activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'invite')
    .eq('actor_id', caller.id)
    .gte('occurred_at', since);
  if (sent.error) throw rpcError(sent.error, {});
  if ((sent.count ?? 0) >= INVITES_PER_DAY) throw new HttpError('rate_limited', `at most ${INVITES_PER_DAY} invites per day`);

  const invited = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: Deno.env.get('ADMIN_REDIRECT_URL') ?? DEFAULT_REDIRECT,
    data: { display_name: displayName },
  });
  if (invited.error || !invited.data.user) {
    if (invited.error?.code === 'email_exists' || invited.error?.status === 422) {
      throw new HttpError('conflict', 'an account with this email already exists');
    }
    console.error('inviteUserByEmail failed', invited.error);
    throw new HttpError('upstream_error', 'could not send the invite');
  }
  const user = invited.data.user;

  const reg = await admin.rpc('register_invited_editor', {
    p_user_id: user.id,
    p_email: email,
    p_display_name: displayName,
    p_invited_by: caller.id,
  });
  if (reg.error) {
    // Do not leave an invited auth user without an editors row.
    const undo = await admin.auth.admin.deleteUser(user.id);
    if (undo.error) console.error('could not roll back invited user', user.id, undo.error);
    throw rpcError(reg.error, { '23505': 'conflict' });
  }

  return ok({ editor: { user_id: user.id, email, display_name: displayName } });
});
