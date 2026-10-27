// GitHub repository_dispatch. GITHUB_API_URL exists only so tests can point the
// function at a mock server; production uses the default.

export const DEFAULT_REPO = 'Echo1560/CesartPortfolio';

/** Sends `repository_dispatch` (event type `publish`). Throws with a readable message on failure. */
export async function dispatchPublish(runId: string): Promise<void> {
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN');
  if (!token) throw new Error('GITHUB_DISPATCH_TOKEN is not set');
  const api = (Deno.env.get('GITHUB_API_URL') ?? 'https://api.github.com').replace(/\/+$/, '');
  const repo = Deno.env.get('GITHUB_REPOSITORY') ?? DEFAULT_REPO;

  let res: Response;
  try {
    res = await fetch(`${api}/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'cesart-portfolio-publish',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ event_type: 'publish', client_payload: { run_id: runId } }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new Error(`GitHub dispatch request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status !== 204) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`GitHub dispatch answered HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  await res.body?.cancel();
}
