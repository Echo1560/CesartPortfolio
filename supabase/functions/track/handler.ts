// POST /functions/v1/track: public analytics beacon (verify_jwt = false).
// Body: text/plain JSON from navigator.sendBeacon, at most 2 KiB.
// 204 for stored, rate-limited and bot events alike; 400 bad input; 413 too large;
// 403 when a browser Origin other than the site sends it.
// Stores no IP, no User-Agent and sets no cookies (docs/V2-CONTRACTS.md §6, §7).
import { serviceClient } from '../_shared/auth.ts';
import { visitorHash } from '../_shared/crypto.ts';
import { env, HttpError, isAllowedOrigin, readBody, serve } from '../_shared/http.ts';
import { MAX_BODY_BYTES, parseEvent, platformIp } from './event.ts';

export const handler = serve(['POST'], async (req) => {
  const origin = req.headers.get('origin');
  if (origin !== null && !isAllowedOrigin(origin)) throw new HttpError('forbidden', 'origin not allowed');

  const ua = req.headers.get('user-agent') ?? '';
  const event = parseEvent(await readBody(req, MAX_BODY_BYTES), ua);
  const p_visitor_hash = await visitorHash(env('EVENTS_HASH_SECRET'), platformIp(req.headers), ua);

  const { error } = await serviceClient().rpc('record_event', { ...event, p_visitor_hash });
  if (error) {
    // 23514: a value the database rejected that parseEvent let through.
    if (error.code === '23514' || error.code === '22P02') throw new HttpError('bad_request', 'invalid event');
    console.error('record_event failed', error);
    throw new HttpError('internal_error', 'could not record the event');
  }
  return new Response(null, { status: 204 });
});
