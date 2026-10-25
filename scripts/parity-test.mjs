/**
 * `npm run test:parity`: proves CONTENT_SOURCE=supabase builds the same site as
 * CONTENT_SOURCE=local, and that the build fails loudly when Supabase is down.
 *
 * Needs the LOCAL stack with the seed and the imported media:
 *   npm run db:start && npm run db:reset
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run db:import   (values: npx supabase status -o env)
 *
 * Steps:
 *   1. `npm run build` with local content     → .parity/local
 *   2. `npm run build` with the Supabase snapshot → .parity/supabase
 *   3. compare both trees: same files, same HTML. Hashes in /_astro/ asset
 *      names are ignored, so only content and structure count.
 *   4. a build pointed at a closed port must exit non-zero and name the cause,
 *      both in the pre-build step and in `astro build` itself.
 *   5. the Supabase build must not have changed any tracked file in content/.
 */
import { execSync, spawnSync } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const out = join(root, '.parity');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const url = status.API_URL;
const anonKey = status.ANON_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error(`✗ refusing to run against a non-local API (${url})`);
  process.exit(1);
}

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : `\n${detail}`}`);
  if (!ok) failed++;
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, MEDIA_VARIANTS: 'auto', ...env },
    encoding: 'utf8',
    // npm is a .cmd shim on Windows and needs a shell; node itself must not go through one (spaces in its path).
    shell: process.platform === 'win32' && command === npm,
  });
  return { code: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function build(name, env) {
  console.log(`→ building with CONTENT_SOURCE=${env.CONTENT_SOURCE}`);
  const { code, output } = run(npm, ['run', 'build'], env);
  if (code !== 0) {
    console.error(output.slice(-3000));
    console.error(`✗ ${name} build failed`);
    process.exit(1);
  }
  rmSync(join(out, name), { recursive: true, force: true });
  cpSync(join(root, 'dist'), join(out, name), { recursive: true });
}

function files(dir) {
  const list = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else list.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return list;
}

// `_astro/name.Hash.ext` and `_astro/name.Hash_Variant.ext` → `_astro/name.ext`
const unhash = (s) => s.replace(/(_astro\/[^"'\s,)?]+?)\.[A-Za-z0-9_-]{8}(?:_[A-Za-z0-9_-]+)?\.([a-z0-9]+)/g, '$1.$2');

function firstDifference(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return `    line ${i + 1}\n    local:    ${(la[i] ?? '').slice(0, 300)}\n    supabase: ${(lb[i] ?? '').slice(0, 300)}`;
  }
  return '';
}

rmSync(out, { recursive: true, force: true });
const contentBefore = execSync('git status --porcelain -- content', { encoding: 'utf8' });

build('local', { CONTENT_SOURCE: 'local' });
build('supabase', { CONTENT_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: url, PUBLIC_SUPABASE_ANON_KEY: anonKey });

// Same file tree (ignoring hashes).
const localFiles = files(join(out, 'local')).map(unhash).sort();
const supabaseFiles = files(join(out, 'supabase')).map(unhash).sort();
const onlyLocal = localFiles.filter((f) => !supabaseFiles.includes(f));
const onlySupabase = supabaseFiles.filter((f) => !localFiles.includes(f));
check(
  `same ${localFiles.length} output files`,
  onlyLocal.length === 0 && onlySupabase.length === 0,
  `  only local: ${onlyLocal.join(', ') || '-'}\n  only supabase: ${onlySupabase.join(', ') || '-'}`,
);

// Same HTML.
const pages = files(join(out, 'local')).filter((f) => f.endsWith('.html'));
for (const page of pages) {
  const a = unhash(readFileSync(join(out, 'local', page), 'utf8'));
  let b;
  try {
    b = unhash(readFileSync(join(out, 'supabase', page), 'utf8'));
  } catch {
    check(`${page} is identical`, false, '  missing from the supabase build');
    continue;
  }
  check(`${page} is identical`, a === b, firstDifference(a.replaceAll('><', '>\n<'), b.replaceAll('><', '>\n<')));
}

// Fail loud when Supabase is down.
const down = { CONTENT_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', PUBLIC_SUPABASE_ANON_KEY: anonKey };
const prep = run(npm, ['run', 'content:prepare'], down);
check(
  'pre-build fails when Supabase is down',
  prep.code !== 0 && prep.output.includes('Supabase unreachable at http://127.0.0.1:9'),
  prep.output.slice(-800),
);
const astro = run(process.execPath, [join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build', '--outDir', join(out, 'down')], down);
check(
  'astro build fails when Supabase is down',
  astro.code !== 0 && astro.output.includes('Supabase unreachable at http://127.0.0.1:9'),
  astro.output.slice(-800),
);

const contentAfter = execSync('git status --porcelain -- content', { encoding: 'utf8' });
check('the supabase build left tracked content/ files unchanged', contentAfter === contentBefore, contentAfter);

console.log(failed ? `\n✗ ${failed} parity check(s) failed` : '\n✓ supabase build matches the local build');
process.exit(failed ? 1 : 0);
