import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { HttpError } from '../_shared/http.ts';
import { deviceClass, normalisePath, parseEvent, platformIp, referrerHost } from './event.ts';

const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function badRequest(fn: () => unknown) {
  const e = assertThrows(fn, HttpError);
  assertEquals(e.code, 'bad_request');
}

Deno.test('parseEvent normalises a work_open beacon', () => {
  const e = parseEvent(
    JSON.stringify({
      v: 1,
      name: 'work_open',
      path: '/CesartPortfolio/work/foo/?utm=x#top',
      slug: 'foo',
      referrer: 'https://WWW.Instagram.com/p/x?y=1',
      props: { source: 'lightbox', evil: 'x', nested: { a: 1 } },
      extra: 'ignored',
    }),
    FIREFOX,
  );
  assertEquals(e, {
    p_name: 'work_open',
    p_path: '/CesartPortfolio/work/foo/',
    p_work_slug: 'foo',
    p_referrer_host: 'www.instagram.com',
    p_device: 'desktop',
    p_props: { source: 'lightbox' },
  });
});

Deno.test('parseEvent rejects malformed input', () => {
  badRequest(() => parseEvent('not json', FIREFOX));
  badRequest(() => parseEvent('[]', FIREFOX));
  badRequest(() => parseEvent('null', FIREFOX));
  badRequest(() => parseEvent(JSON.stringify({ name: 'page_view', path: '/' }), FIREFOX)); // no v
  badRequest(() => parseEvent(JSON.stringify({ v: 2, name: 'page_view', path: '/' }), FIREFOX));
  badRequest(() => parseEvent(JSON.stringify({ v: 1, name: 'login', path: '/' }), FIREFOX));
  badRequest(() => parseEvent(JSON.stringify({ v: 1, name: 'page_view' }), FIREFOX));
  badRequest(() => parseEvent(JSON.stringify({ v: 1, name: 'work_open', path: '/' }), FIREFOX)); // slug required
  badRequest(() => parseEvent(JSON.stringify({ v: 1, name: 'work_open', path: '/', slug: 'Not Kebab' }), FIREFOX));
  badRequest(() => parseEvent(JSON.stringify({ v: 1, name: 'work_open', path: '/', slug: 'a'.repeat(101) }), FIREFOX));
});

Deno.test('parseEvent keeps only the props listed for each event', () => {
  const props = (name: string, p: unknown, slug?: string) =>
    parseEvent(JSON.stringify({ v: 1, name, path: '/', slug, props: p }), FIREFOX).p_props;
  assertEquals(props('page_view', { source: 'email' }), {});
  assertEquals(props('work_open', { source: 'page' }, 'foo'), { source: 'page' });
  assertEquals(props('work_open', { source: 'somewhere' }, 'foo'), {});
  assertEquals(props('video_play', { provider: 'embed' }), { provider: 'embed' });
  assertEquals(props('video_play', { provider: 'youtube' }), {});
  assertEquals(props('contact_click', { source: 'instagram' }), { source: 'instagram' });
  assertEquals(props('contact_click', { source: 'x'.repeat(41) }), {});
  assertEquals(props('contact_click', { source: 42 }), {});
  assertEquals(props('contact_click', 'not an object'), {});
});

Deno.test('parseEvent drops the slug on events that do not carry one', () => {
  const e = parseEvent(JSON.stringify({ v: 1, name: 'page_view', path: '/', slug: 'foo' }), FIREFOX);
  assertEquals(e.p_work_slug, null);
});

Deno.test('normalisePath', () => {
  assertEquals(normalisePath('/CesartPortfolio/'), '/CesartPortfolio/');
  assertEquals(normalisePath('/a?b=c'), '/a');
  assertEquals(normalisePath('/a#b'), '/a');
  badRequest(() => normalisePath('relative'));
  badRequest(() => normalisePath('//evil.example/'));
  badRequest(() => normalisePath('https://evil.example/'));
  badRequest(() => normalisePath('/with space'));
  badRequest(() => normalisePath('/' + 'a'.repeat(512)));
  badRequest(() => normalisePath(42));
});

Deno.test('referrerHost keeps only external hostnames', () => {
  assertEquals(referrerHost('https://t.co/abc'), 't.co');
  assertEquals(referrerHost('https://echo1560.github.io/CesartPortfolio/'), null); // the site itself
  assertEquals(referrerHost('http://localhost:4321/'), null);
  assertEquals(referrerHost(''), null);
  assertEquals(referrerHost(undefined), null);
  assertEquals(referrerHost('not a url'), null);
  assertEquals(referrerHost('javascript:alert(1)'), null);
  assertEquals(referrerHost('https://bücher.example/'), 'xn--bcher-kva.example');
});

Deno.test('deviceClass', () => {
  assertEquals(deviceClass(FIREFOX), 'desktop');
  assertEquals(deviceClass(IPHONE), 'mobile');
  assertEquals(deviceClass(ANDROID_PHONE), 'mobile');
  assertEquals(deviceClass(IPAD), 'tablet');
  assertEquals(deviceClass(ANDROID_TABLET), 'tablet');
  assertEquals(deviceClass(GOOGLEBOT), 'bot');
  assertEquals(deviceClass('curl/8.0'), 'bot');
  assertEquals(deviceClass(''), 'unknown');
});

Deno.test('platformIp never trusts the first x-forwarded-for entry', () => {
  assertEquals(platformIp(new Headers({ 'cf-connecting-ip': '203.0.113.1', 'x-forwarded-for': '1.1.1.1' })), '203.0.113.1');
  assertEquals(platformIp(new Headers({ 'x-real-ip': '203.0.113.2', 'x-forwarded-for': '1.1.1.1' })), '203.0.113.2');
  assertEquals(platformIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1, 203.0.113.3' })), '203.0.113.3');
  assertEquals(platformIp(new Headers()), 'unknown');
});
