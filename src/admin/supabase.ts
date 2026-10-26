/**
 * Supabase client for the dashboard. It only ever uses the public anon (publishable) key:
 * what a visitor can read or write is decided by RLS, never by this bundle.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

/** True when the page was opened from an invite or password-reset email (read before the client consumes the hash). */
export const arrivedViaEmailLink = typeof location !== 'undefined' && /type=(invite|recovery)/.test(location.hash);

export const configured = Boolean(url && key);

let client: SupabaseClient | null = null;

export function sb(): SupabaseClient {
  if (!url || !key) throw new Error('Supabase is not configured (PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY).');
  client ??= createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

/** Turns a PostgREST/Storage error into a sentence for the editor. */
export function explain(error: { message?: string; code?: string; details?: string } | null | undefined): string {
  if (!error) return 'Unknown error';
  switch (error.code) {
    case '42501':
      return 'You do not have permission to do that.';
    case '23505':
      return 'That value is already used (ids and slugs must be unique).';
    case '23503':
      return 'It is still referenced elsewhere, or the thing it points to does not exist.';
    case '23514':
      return `A value was rejected by the database: ${error.message ?? ''}`;
  }
  return error.message ?? 'Unknown error';
}
