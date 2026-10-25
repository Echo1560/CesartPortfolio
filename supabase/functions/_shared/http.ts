// JSON envelope, error codes and CORS shared by every Edge Function.
// Contract: docs/V2-CONTRACTS.md §6.

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'payload_too_large'
  | 'unprocessable'
  | 'rate_limited'
  | 'internal_error'
  | 'upstream_error';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  payload_too_large: 413,
  unprocessable: 422,
  rate_limited: 429,
  internal_error: 500,
  upstream_error: 502,
};

/** Thrown inside a handler; `serve()` turns it into the error envelope. */
export class HttpError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
  }
  get status(): number {
    return STATUS[this.code];
  }
}

export const ALLOWED_ORIGINS: readonly string[] = [
  'https://echo1560.github.io',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
];

/** Hostnames of the site itself (a referrer from one of them is not external). */
export const SITE_HOSTS: ReadonlySet<string> = new Set(ALLOWED_ORIGINS.map((o) => new URL(o).hostname));

export function isAllowedOrigin(origin: string | null): boolean {
  return origin !== null && ALLOWED_ORIGINS.includes(origin);
}

export function corsHeaders(req: Request): Headers {
  const h = new Headers({ vary: 'Origin' });
  const origin = req.headers.get('origin');
  if (isAllowedOrigin(origin)) {
    h.set('access-control-allow-origin', origin!);
    h.set('access-control-allow-headers', 'authorization, apikey, content-type');
    h.set('access-control-allow-methods', 'GET, POST, OPTIONS');
    h.set('access-control-max-age', '600');
  }
  return h;
}

function withCors(req: Request, res: Response): Response {
  corsHeaders(req).forEach((v, k) => res.headers.set(k, v));
  return res;
}

export function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function ok(body: Record<string, unknown> = {}): Response {
  return json({ ok: true, ...body });
}

export function errorResponse(code: ErrorCode, message: string): Response {
  return json({ ok: false, error: { code, message } }, STATUS[code]);
}

export type Handler = (req: Request) => Promise<Response>;

/**
 * Wraps a handler: answers CORS preflights, enforces the method list, maps
 * HttpError to the envelope and hides unexpected errors behind internal_error.
 */
export function serve(methods: readonly string[], handler: Handler): Handler {
  return async (req) => {
    if (req.method === 'OPTIONS') {
      return withCors(req, new Response(null, { status: isAllowedOrigin(req.headers.get('origin')) ? 204 : 403 }));
    }
    if (!methods.includes(req.method)) {
      const res = errorResponse('method_not_allowed', `use ${methods.join(' or ')}`);
      res.headers.set('allow', methods.join(', '));
      return withCors(req, res);
    }
    try {
      return withCors(req, await handler(req));
    } catch (e) {
      if (e instanceof HttpError) return withCors(req, errorResponse(e.code, e.message));
      console.error(e);
      return withCors(req, errorResponse('internal_error', 'unexpected error'));
    }
  };
}

/**
 * Reads the body as text, at most `maxBytes` (checked on Content-Length and
 * again while streaming, so a missing or lying header does not help).
 */
export async function readBody(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new HttpError('payload_too_large', `body is limited to ${maxBytes} bytes`);
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError('payload_too_large', `body is limited to ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(all);
  } catch {
    throw new HttpError('bad_request', 'body is not valid UTF-8');
  }
}

/** Parses a JSON object body. An empty body counts as `{}`. */
export async function readJsonObject(req: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  const text = await readBody(req, maxBytes);
  if (text.trim() === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError('bad_request', 'body is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError('bad_request', 'body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new HttpError('internal_error', `server is missing ${name}`);
  return v;
}
