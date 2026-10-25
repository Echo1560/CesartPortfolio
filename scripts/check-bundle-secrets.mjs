/**
 * `npm run check:bundle`: fails if the built site (dist/) contains anything
 * that must stay server-side: service-role JWTs, Supabase secret keys, GitHub
 * tokens, or the names of server-only secrets (a sign they were inlined).
 * The anon/publishable key is allowed: RLS protects the data.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const dist = join(import.meta.dirname, '..', 'dist');
const TEXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.txt', '.xml', '.map', '.webmanifest', '.svg']);

const RULES = [
  [/sb_secret_[A-Za-z0-9_-]+/, 'Supabase secret key'],
  [/\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/SUPABASE_SERVICE_ROLE_KEY|GITHUB_DISPATCH_TOKEN|PUBLISH_STATUS_TOKEN|EVENTS_HASH_SECRET/, 'server-only secret name'],
];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (TEXT.has(extname(p).toLowerCase())) yield p;
  }
}

let problems = 0;
for (const file of files(dist)) {
  const text = readFileSync(file, 'utf8');
  for (const [re, what] of RULES) {
    if (re.test(text)) {
      console.error(`✗ ${relative(dist, file)}: ${what}`);
      problems++;
    }
  }
  for (const m of text.matchAll(JWT)) {
    try {
      const claims = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (claims.role && claims.role !== 'anon') {
        console.error(`✗ ${relative(dist, file)}: JWT with role "${claims.role}"`);
        problems++;
      }
    } catch {
      // not a JWT
    }
  }
}

if (problems > 0) process.exit(1);
console.log('✓ no server-side secrets in dist/');
