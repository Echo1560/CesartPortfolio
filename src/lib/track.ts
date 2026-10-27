/**
 * Analytics hook. Components call `track()` at the moments the artist wants
 * metrics for; this is the only place that knows how events leave the page.
 *
 * Sends one `navigator.sendBeacon` per event to the `track` Edge Function
 * (`{PUBLIC_SUPABASE_URL}/functions/v1/track`) as `text/plain` JSON, which
 * needs no CORS preflight and no key: the function is public and rate-limited.
 * No cookies, no storage, no identifiers are created here; the function hashes
 * the visitor server-side (docs/V2-CONTRACTS.md §6, §7).
 *
 * A no-op when PUBLIC_SUPABASE_URL is unset (local dev, tests, v1 builds), on
 * the admin pages, and wherever sendBeacon is unavailable.
 *
 * Safe to import from client-side scripts. Never throws.
 */
export type TrackEvent = 'page_view' | 'work_open' | 'video_play' | 'contact_click';

/** Wire format of one beacon (version 1). */
export interface TrackBody {
  v: 1;
  name: TrackEvent;
  path: string;
  slug?: string;
  referrer?: string;
  props?: Record<string, string>;
}

/** The `track` endpoint, or null when analytics is off. */
export function trackEndpoint(supabaseUrl: string | undefined = import.meta.env.PUBLIC_SUPABASE_URL): string | null {
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/track`;
}

/** True on the dashboard (`<base>admin/...`), which is never tracked. */
export function isAdminPath(pathname: string, base: string = import.meta.env.BASE_URL): boolean {
  const b = base.endsWith('/') ? base : `${base}/`;
  return pathname === `${b}admin` || pathname.startsWith(`${b}admin/`);
}

/**
 * Builds the beacon body from a call site's payload. `slug` and `path` are
 * fields of their own; other string values become `props` (the function keeps
 * only the ones it knows).
 */
export function buildTrackBody(
  event: TrackEvent,
  payload: Record<string, unknown> | undefined,
  pathname: string,
  referrer: string,
): TrackBody {
  const { slug, path, ...rest } = payload ?? {};
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(rest)) if (typeof v === 'string') props[k] = v;
  const body: TrackBody = { v: 1, name: event, path: typeof path === 'string' ? path : pathname };
  if (typeof slug === 'string' && slug) body.slug = slug;
  if (referrer) body.referrer = referrer;
  if (Object.keys(props).length > 0) body.props = props;
  return body;
}

export function track(event: TrackEvent, payload?: Record<string, unknown>): void {
  try {
    const endpoint = trackEndpoint();
    if (!endpoint || typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
    if (isAdminPath(location.pathname)) return;
    const body = buildTrackBody(event, payload, location.pathname, document.referrer);
    navigator.sendBeacon(endpoint, new Blob([JSON.stringify(body)], { type: 'text/plain;charset=UTF-8' }));
  } catch {
    // Analytics must never break the page.
  }
}
