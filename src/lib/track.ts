/**
 * Analytics hook. v1 is a deliberate no-op: no network, no cookies, no storage.
 *
 * Components call `track()` at the moments the artist will want metrics for.
 * A future backend/dashboard replaces the body of `track()` (for example a
 * `navigator.sendBeacon` to its own endpoint) and every call site starts
 * reporting without other changes. See docs/ARCHITECTURE.md.
 *
 * Safe to import from client-side scripts.
 */
export type TrackEvent = 'page_view' | 'work_open' | 'video_play' | 'contact_click';

export function track(event: TrackEvent, payload?: Record<string, unknown>): void {
  void event;
  void payload;
}
