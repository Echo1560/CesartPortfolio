// Validation and normalisation of a `track` beacon (docs/V2-CONTRACTS.md §7).
// Pure functions: no I/O, unit-tested in event.test.ts.
import { HttpError, SITE_HOSTS } from '../_shared/http.ts';

export const MAX_BODY_BYTES = 2048;

export const EVENT_NAMES = ['page_view', 'work_open', 'video_play', 'contact_click'] as const;
export type EventName = (typeof EVENT_NAMES)[number];
export type Device = 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown';

/** The arguments of record_event(), minus the visitor hash. */
export interface NormalisedEvent {
  p_name: EventName;
  p_path: string;
  p_work_slug: string | null;
  p_referrer_host: string | null;
  p_device: Device;
  p_props: Record<string, string>;
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isKebab = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && KEBAB.test(v);

// Allowed props per event. Every value is a string of at most 40 characters;
// anything else (unknown keys, wrong values) is dropped, not rejected.
const PROPS: Record<EventName, Record<string, (v: string) => boolean>> = {
  page_view: {},
  work_open: { source: (v) => v === 'lightbox' || v === 'page' },
  video_play: { provider: (v) => v === 'embed' },
  contact_click: { source: (v) => isKebab(v, 40) },
};

function bad(message: string): never {
  throw new HttpError('bad_request', message);
}

/** Path without query or fragment. Must start with `/`, no whitespace, ≤ 512 chars. */
export function normalisePath(raw: unknown): string {
  if (typeof raw !== 'string') bad('path must be a string');
  const path = raw.split(/[?#]/, 1)[0];
  if (!path.startsWith('/') || path.startsWith('//') || /\s/.test(path) || path.length > 512) bad('invalid path');
  return path;
}

/** Lowercased hostname of an external referrer; null when absent, invalid or the site itself. */
export function referrerHost(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '' || raw.length > 2048) return null;
  let host: string;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === '' || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || SITE_HOSTS.has(host)) return null;
  return host;
}

const BOT_RE =
  /bot|crawl|spider|slurp|scrape|fetch|preview|monitor|headless|lighthouse|pagespeed|facebookexternalhit|embedly|whatsapp|curl|wget|python-|go-http|java\/|okhttp|axios|node-fetch|deno\//i;

/** Device class from the User-Agent. The UA itself is never stored. */
export function deviceClass(ua: string): Device {
  if (ua.trim() === '') return 'unknown';
  if (BOT_RE.test(ua)) return 'bot';
  if (/ipad|tablet|playbook|silk|kindle/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return 'tablet';
  if (/mobi|iphone|ipod|android|windows phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * The client IP as seen by the platform, never one the client can choose:
 * cf-connecting-ip, then x-real-ip, then the LAST x-forwarded-for entry (the
 * first entries are client-controlled).
 */
export function platformIp(headers: Headers): string {
  const direct = headers.get('cf-connecting-ip') ?? headers.get('x-real-ip');
  if (direct?.trim()) return direct.trim();
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const last = xff.split(',').map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return 'unknown';
}

/** Parses and validates a beacon body. Throws HttpError('bad_request') on bad input. */
export function parseEvent(text: string, userAgent: string): NormalisedEvent {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    bad('body is not valid JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) bad('body must be a JSON object');
  const b = body as Record<string, unknown>;

  if (b.v !== 1) bad('unsupported version');
  if (typeof b.name !== 'string' || !(EVENT_NAMES as readonly string[]).includes(b.name)) bad('unknown event name');
  const name = b.name as EventName;

  let slug: string | null = null;
  if (b.slug !== undefined && b.slug !== null) {
    if (!isKebab(b.slug, 100)) bad('invalid slug');
    slug = b.slug;
  }
  if (name === 'work_open' && slug === null) bad('work_open needs a slug');
  if (name === 'page_view' || name === 'contact_click') slug = null;

  const props: Record<string, string> = {};
  if (typeof b.props === 'object' && b.props !== null && !Array.isArray(b.props)) {
    for (const [key, check] of Object.entries(PROPS[name])) {
      const v = (b.props as Record<string, unknown>)[key];
      if (typeof v === 'string' && v.length <= 40 && check(v)) props[key] = v;
    }
  }

  return {
    p_name: name,
    p_path: normalisePath(b.path),
    p_work_slug: slug,
    p_referrer_host: referrerHost(b.referrer),
    p_device: deviceClass(userAgent),
    p_props: props,
  };
}
