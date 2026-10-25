// Caller verification and Supabase clients. SUPABASE_SERVICE_ROLE_KEY is read
// here and nowhere else; it never leaves the function.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { env, type ErrorCode, HttpError } from './http.ts';

export interface Caller {
  id: string;
  email: string | undefined;
  /** Client that sends the caller's JWT: RLS and auth.uid() apply. */
  db: SupabaseClient;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), noSession);
}

function bearer(req: Request): string {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!m) throw new HttpError('unauthorized', 'missing bearer token');
  return m[1];
}

/** Verifies the JWT with Supabase Auth (rejects expired, forged and signed-out tokens). */
export async function requireUser(req: Request): Promise<Caller> {
  const jwt = bearer(req);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    ...noSession,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) {
    console.warn('rejected session:', error?.message);
    throw new HttpError('unauthorized', 'invalid or expired session');
  }
  return { id: data.user.id, email: data.user.email, db };
}

async function checkRole(caller: Caller, fn: 'is_editor' | 'is_owner'): Promise<boolean> {
  const { data, error } = await caller.db.rpc(fn);
  if (error) throw rpcError(error, {});
  return data === true;
}

/** Active editor (owner or editor), checked with the caller's own JWT. */
export async function requireEditor(req: Request): Promise<Caller> {
  const caller = await requireUser(req);
  if (!(await checkRole(caller, 'is_editor'))) throw new HttpError('forbidden', 'not an active editor');
  return caller;
}

/** Active owner, checked with the caller's own JWT. */
export async function requireOwner(req: Request): Promise<Caller> {
  const caller = await requireEditor(req);
  if (!(await checkRole(caller, 'is_owner'))) throw new HttpError('forbidden', 'only owners can manage accounts');
  return caller;
}

interface PgError {
  code?: string;
  message?: string;
}

/**
 * Maps a PostgREST/RPC error (SQLSTATE in `code`) to an HttpError. `map`
 * overrides or extends the defaults; anything unmapped is an internal error.
 */
export function rpcError(error: PgError, map: Partial<Record<string, ErrorCode>>): HttpError {
  const defaults: Record<string, ErrorCode> = { '42501': 'forbidden', PT404: 'not_found', PT409: 'conflict', PT422: 'unprocessable' };
  const code = error.code ? (map[error.code] ?? defaults[error.code]) : undefined;
  if (!code) {
    console.error('rpc error', error);
    return new HttpError('internal_error', 'database error');
  }
  return new HttpError(code, error.message ?? code);
}
