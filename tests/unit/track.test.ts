import { afterEach, describe, expect, it, vi } from 'vitest';
import { track } from '../../src/lib/track';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('track', () => {
  it('makes no network call and writes no cookie or storage', () => {
    const fetchSpy = vi.fn();
    const beacon = vi.fn();
    const xhr = vi.fn();
    const setItem = vi.fn();
    const cookieSet = vi.fn();
    const document = {};
    Object.defineProperty(document, 'cookie', { get: () => '', set: cookieSet });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhr);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    vi.stubGlobal('localStorage', { setItem });
    vi.stubGlobal('sessionStorage', { setItem });
    vi.stubGlobal('document', document);

    track('page_view');
    track('work_open', { slug: 'alpha' });
    track('video_play', { slug: 'beta' });
    track('contact_click');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('returns undefined', () => {
    expect(track('page_view', { path: '/' })).toBeUndefined();
  });
});
