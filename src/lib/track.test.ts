// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTrackBody, isAdminPath, track, trackEndpoint } from './track';

describe('trackEndpoint', () => {
  it('is null without a Supabase URL', () => {
    expect(trackEndpoint(undefined)).toBeNull();
    expect(trackEndpoint('')).toBeNull();
  });
  it('points at the track function', () => {
    expect(trackEndpoint('https://abc.supabase.co/')).toBe('https://abc.supabase.co/functions/v1/track');
    expect(trackEndpoint('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321/functions/v1/track');
  });
});

describe('isAdminPath', () => {
  it('matches the dashboard only', () => {
    expect(isAdminPath('/CesartPortfolio/admin/', '/CesartPortfolio/')).toBe(true);
    expect(isAdminPath('/CesartPortfolio/admin', '/CesartPortfolio/')).toBe(true);
    expect(isAdminPath('/CesartPortfolio/admin/works/', '/CesartPortfolio')).toBe(true);
    expect(isAdminPath('/CesartPortfolio/', '/CesartPortfolio/')).toBe(false);
    expect(isAdminPath('/CesartPortfolio/work/administration/', '/CesartPortfolio/')).toBe(false);
    expect(isAdminPath('/CesartPortfolio/administrator/', '/CesartPortfolio/')).toBe(false);
  });
});

describe('buildTrackBody', () => {
  it('maps call-site payloads to the wire format', () => {
    expect(buildTrackBody('work_open', { slug: 'foo', source: 'lightbox' }, '/CesartPortfolio/', 'https://t.co/x')).toEqual({
      v: 1,
      name: 'work_open',
      path: '/CesartPortfolio/',
      slug: 'foo',
      referrer: 'https://t.co/x',
      props: { source: 'lightbox' },
    });
    expect(buildTrackBody('page_view', { path: '/CesartPortfolio/work/a/' }, '/ignored/', '')).toEqual({
      v: 1,
      name: 'page_view',
      path: '/CesartPortfolio/work/a/',
    });
  });
  it('drops non-string props and empty slugs', () => {
    expect(buildTrackBody('video_play', { slug: undefined, provider: 'embed', n: 3 }, '/', '')).toEqual({
      v: 1,
      name: 'video_play',
      path: '/',
      props: { provider: 'embed' },
    });
    expect(buildTrackBody('contact_click', { source: undefined }, '/', '')).toEqual({ v: 1, name: 'contact_click', path: '/' });
  });
});

describe('track', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubBrowser(pathname: string) {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon });
    vi.stubGlobal('location', { pathname });
    vi.stubGlobal('document', { referrer: 'https://www.instagram.com/' });
    return sendBeacon;
  }

  it('is a no-op without PUBLIC_SUPABASE_URL', () => {
    vi.stubEnv('PUBLIC_SUPABASE_URL', '');
    const sendBeacon = stubBrowser('/');
    expect(track('page_view')).toBeUndefined();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('sends a text/plain beacon to the track function', async () => {
    vi.stubEnv('PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    const sendBeacon = stubBrowser('/work/foo/');
    track('work_open', { slug: 'foo', source: 'page' });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe('https://abc.supabase.co/functions/v1/track');
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(JSON.parse(await blob.text())).toEqual({
      v: 1,
      name: 'work_open',
      path: '/work/foo/',
      slug: 'foo',
      referrer: 'https://www.instagram.com/',
      props: { source: 'page' },
    });
  });

  it('never tracks the admin pages', () => {
    vi.stubEnv('PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    vi.stubEnv('BASE_URL', '/CesartPortfolio/');
    const sendBeacon = stubBrowser('/CesartPortfolio/admin/');
    track('page_view');
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('never throws', () => {
    vi.stubEnv('PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    vi.stubGlobal('navigator', {
      sendBeacon: () => {
        throw new Error('blocked');
      },
    });
    vi.stubGlobal('location', { pathname: '/' });
    vi.stubGlobal('document', { referrer: '' });
    expect(() => track('page_view')).not.toThrow();
  });
});
