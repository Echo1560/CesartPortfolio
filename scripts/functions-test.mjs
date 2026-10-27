/**
 * `npm run functions:test`: Deno tests for the Edge Functions against the
 * running LOCAL stack (`npm run db:start`).
 *
 *   1. `supabase db reset` (fresh seed, resets Auth's email rate limit). Skip with --no-reset.
 *   2. `supabase functions serve` with local-only test secrets. GitHub is mocked:
 *      GITHUB_API_URL points at a server the tests start on the host.
 *   3. `deno test` for the unit tests and supabase/functions/tests/*.
 *
 * Never point it at a hosted project: it signs in with the local-only seed accounts.
 */
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

const status = JSON.parse(execSync('npx supabase status -o json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
  console.error(`✗ refusing to run against a non-local API (${status.API_URL})`);
  process.exit(1);
}

if (!process.argv.includes('--no-reset')) run('npx supabase db reset');

// The GitHub mock runs on the host. Docker Desktop (Windows/macOS) reaches the
// host as host.docker.internal; on Linux (CI) use the Supabase network gateway.
const MOCK_GITHUB_PORT = '54399';
function hostFromContainers() {
  if (process.platform !== 'linux') return 'host.docker.internal';
  const network = `supabase_network_${status.PROJECT_ID ?? 'cesart-portfolio'}`;
  return execSync(`docker network inspect ${network} --format '{{(index .IPAM.Config 0).Gateway}}'`, { encoding: 'utf8' }).trim();
}

// Local-only test values. They are not secrets and never reach a hosted project.
const testEnv = {
  EVENTS_HASH_SECRET: 'local-test-events-hash-secret-not-real',
  PUBLISH_STATUS_TOKEN: 'local-test-publish-status-token-not-real',
  GITHUB_DISPATCH_TOKEN: 'local-test-github-token-not-real',
  GITHUB_API_URL: `http://${hostFromContainers()}:${MOCK_GITHUB_PORT}`,
  ADMIN_REDIRECT_URL: 'http://localhost:4321/CesartPortfolio/admin/',
};
mkdirSync(join(root, 'supabase/.temp'), { recursive: true });
const envFile = join(root, 'supabase/.temp/functions-test.env');
writeFileSync(envFile, Object.entries(testEnv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');

const serve = spawn(npx, ['supabase', 'functions', 'serve', '--env-file', envFile], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: process.platform === 'win32',
  detached: process.platform !== 'win32',
});

function stopServe() {
  if (serve.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${serve.pid} /T /F`, { stdio: 'ignore' });
    else process.kill(-serve.pid, 'SIGTERM');
  } catch {
    // already gone
  }
}
process.on('exit', stopServe);
process.on('SIGINT', () => process.exit(130));

const functionsUrl = `${status.API_URL}/functions/v1`;
// Kong reloads shortly after `functions serve` replaces the edge runtime
// container, so one good answer is not enough: wait for five in a row.
async function waitForFunctions() {
  let streak = 0;
  for (let i = 0; i < 120 && streak < 5; i++) {
    try {
      const res = await fetch(`${functionsUrl}/track`, { method: 'GET' });
      await res.body?.cancel();
      streak = res.status === 405 ? streak + 1 : 0;
    } catch {
      streak = 0;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (streak < 5) throw new Error('functions serve did not become ready');
}

let code = 1;
try {
  await waitForFunctions();
  execSync('npx deno test --allow-net --allow-env --config supabase/functions/deno.json supabase/functions', {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      FUNCTIONS_URL: functionsUrl,
      SUPABASE_URL: status.API_URL,
      SUPABASE_ANON_KEY: status.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      PUBLISH_STATUS_TOKEN: testEnv.PUBLISH_STATUS_TOKEN,
      GITHUB_DISPATCH_TOKEN: testEnv.GITHUB_DISPATCH_TOKEN,
      MOCK_GITHUB_PORT,
    },
  });
  code = 0;
} catch (e) {
  if (!(e && typeof e === 'object' && 'status' in e)) console.error(e);
} finally {
  stopServe();
}
process.exit(code);
