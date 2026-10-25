import { assert, assertEquals, assertMatch, assertNotEquals, assertRejects } from 'jsr:@std/assert@1';
import { timingSafeEqual, utcDay, visitorHash } from './crypto.ts';
import { corsHeaders, HttpError, readBody, readJsonObject, serve } from './http.ts';

Deno.test('visitorHash is 64 hex chars, stable within a day, different across days and visitors', async () => {
  const day1 = new Date('2026-10-25T01:00:00Z');
  const day1Late = new Date('2026-10-25T23:59:59Z');
  const day2 = new Date('2026-10-26T00:00:00Z');
  const a = await visitorHash('secret', '203.0.113.1', 'UA', day1);
  assertMatch(a, /^[0-9a-f]{64}$/);
  assertEquals(await visitorHash('secret', '203.0.113.1', 'UA', day1Late), a);
  assertNotEquals(await visitorHash('secret', '203.0.113.1', 'UA', day2), a);
  assertNotEquals(await visitorHash('secret', '203.0.113.2', 'UA', day1), a);
  assertNotEquals(await visitorHash('secret', '203.0.113.1', 'UA2', day1), a);
  assertNotEquals(await visitorHash('other', '203.0.113.1', 'UA', day1), a);
  assert(!a.includes('203'));
  assertEquals(utcDay(day1), '2026-10-25');
});

Deno.test('timingSafeEqual', async () => {
  assert(await timingSafeEqual('token-value', 'token-value'));
  assert(!(await timingSafeEqual('token-value', 'token-valuf')));
  assert(!(await timingSafeEqual('token-value', 'token')));
  assert(!(await timingSafeEqual('', 'token')));
});

Deno.test('corsHeaders allows only the site origins', () => {
  const allowed = corsHeaders(new Request('http://x/', { headers: { origin: 'https://echo1560.github.io' } }));
  assertEquals(allowed.get('access-control-allow-origin'), 'https://echo1560.github.io');
  assertEquals(allowed.get('access-control-allow-headers'), 'authorization, apikey, content-type');
  const denied = corsHeaders(new Request('http://x/', { headers: { origin: 'https://evil.example' } }));
  assertEquals(denied.get('access-control-allow-origin'), null);
});

Deno.test('readBody enforces the size limit even without Content-Length', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(1500));
      c.enqueue(new Uint8Array(1500));
      c.close();
    },
  });
  const req = new Request('http://x/', { method: 'POST', body: stream });
  const e = await assertRejects(() => readBody(req, 2048), HttpError);
  assertEquals(e.code, 'payload_too_large');
  const declared = new Request('http://x/', { method: 'POST', body: 'x', headers: { 'content-length': '999999' } });
  assertEquals((await assertRejects(() => readBody(declared, 2048), HttpError)).code, 'payload_too_large');
  assertEquals(await readBody(new Request('http://x/', { method: 'POST', body: 'hello' }), 2048), 'hello');
});

Deno.test('readJsonObject', async () => {
  const req = (body: string) => new Request('http://x/', { method: 'POST', body });
  assertEquals(await readJsonObject(req('')), {});
  assertEquals(await readJsonObject(req('{"a":1}')), { a: 1 });
  assertEquals((await assertRejects(() => readJsonObject(req('{')), HttpError)).code, 'bad_request');
  assertEquals((await assertRejects(() => readJsonObject(req('[1]')), HttpError)).code, 'bad_request');
});

Deno.test('serve maps errors to the envelope and enforces methods', async () => {
  const h = serve(['POST'], (req) => {
    if (req.headers.get('x-fail') === 'http') throw new HttpError('conflict', 'nope');
    if (req.headers.get('x-fail') === 'crash') throw new Error('secret detail');
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  const get = await h(new Request('http://x/'));
  assertEquals(get.status, 405);
  assertEquals((await get.json()).error.code, 'method_not_allowed');

  const conflict = await h(new Request('http://x/', { method: 'POST', headers: { 'x-fail': 'http' } }));
  assertEquals(conflict.status, 409);
  assertEquals(await conflict.json(), { ok: false, error: { code: 'conflict', message: 'nope' } });

  const crash = await h(new Request('http://x/', { method: 'POST', headers: { 'x-fail': 'crash' } }));
  assertEquals(crash.status, 500);
  const body = await crash.text();
  assert(!body.includes('secret detail'));

  const pre = await h(new Request('http://x/', { method: 'OPTIONS', headers: { origin: 'http://localhost:4321' } }));
  assertEquals(pre.status, 204);
  assertEquals(pre.headers.get('access-control-allow-origin'), 'http://localhost:4321');
  const preBad = await h(new Request('http://x/', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  assertEquals(preBad.status, 403);
});
