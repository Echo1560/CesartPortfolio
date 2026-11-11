/** Publish: freeze the draft, trigger the rebuild and follow the run. */
import { append, clear, formatDate, h, toast } from '../dom';
import { callFunction, explain, sb } from '../supabase';
import type { ViewContext } from '../main';
import { confirmDialog } from './pages';
import { card } from './shared';

export interface Run {
  id: string;
  status: 'pending' | 'dispatched' | 'building' | 'succeeded' | 'failed';
  requested_at: string;
  requested_by_name: string | null;
  dispatched_at: string | null;
  finished_at: string | null;
  github_run_url: string | null;
  error: string | null;
}

export interface Version {
  id: string;
  version: number;
  schema_version: number;
  published_at: string;
  published_by_name: string | null;
  is_live: boolean;
}

export const LABEL: Record<Run['status'], string> = { pending: 'Queued', dispatched: 'Queued', building: 'Running', succeeded: 'Success', failed: 'Failed' };
const POLL_MS = 5000;
const SITE_URL = `${location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, '/');

let timer: number | undefined;

export const inFlight = (r: Run | undefined) => r !== undefined && (r.status === 'pending' || r.status === 'dispatched' || r.status === 'building');
export const listRuns = async () => (await callFunction<{ runs: Run[] }>('publish-status', { method: 'GET', query: 'limit=10' })).runs;
export async function listVersions(): Promise<Version[]> {
  const { data, error } = await sb().from('published_snapshots').select('id,version,schema_version,published_at,published_by_name,is_live').order('version', { ascending: false }).limit(20);
  if (error) throw new Error(explain(error));
  return (data ?? []) as Version[];
}

export async function renderPublish(el: HTMLElement, _ctx: ViewContext): Promise<void> {
  window.clearTimeout(timer);
  const statusEl = h('div', { class: 'publish-status', role: 'status', 'aria-live': 'polite' });
  const history = h('ul', { class: 'list' });
  const button = h('button', { type: 'button', class: 'btn' }, 'Publish');
  const note = h('p', { class: 'field__hint' }, 'Publishing freezes the current draft. The live site updates in about 1â€“2 minutes.');
  const versionList = h('ul', { class: 'list' });
  const siteLink = h('a', { href: SITE_URL, target: '_blank', rel: 'noopener' }, 'Open the live site');

  const paint = (runs: Run[]) => {
    const latest = runs[0];
    clear(statusEl);
    if (!latest) statusEl.appendChild(h('p', { class: 'empty' }, 'Nothing has been published yet.'));
    else {
      append(statusEl, [
        h('p', {}, h('span', { class: `tag tag--run-${latest.status}` }, LABEL[latest.status]), ' ', `Requested ${formatDate(latest.requested_at)}${latest.requested_by_name ? ` by ${latest.requested_by_name}` : ''}`),
        latest.finished_at ? h('p', { class: 'stamp' }, `Finished ${formatDate(latest.finished_at)}`) : null,
        inFlight(latest) ? h('p', { class: 'field__hint' }, 'Live in about 1â€“2 minutes. This page updates by itself.') : null,
        latest.status === 'failed' ? h('p', { class: 'field__error' }, latest.error ?? 'The publish failed. The site stays on the previous version.') : null,
        latest.github_run_url ? h('a', { href: latest.github_run_url, target: '_blank', rel: 'noopener' }, 'Build log') : null,
      ]);
    }
    button.disabled = inFlight(latest);
    clear(history);
    if (runs.length === 0) history.appendChild(h('li', { class: 'empty' }, 'No publish history.'));
    for (const r of runs) {
      history.appendChild(h('li', { class: 'list__item' }, h('span', { class: `tag tag--run-${r.status}` }, LABEL[r.status]), h('span', { class: 'grow' }, `${formatDate(r.requested_at)}${r.requested_by_name ? ` Â· ${r.requested_by_name}` : ''}`), r.error ? h('span', { class: 'field__hint' }, r.error) : null));
    }
  };

  const paintVersions = (versions: Version[]) => {
    clear(versionList);
    if (versions.length === 0) versionList.appendChild(h('li', { class: 'empty' }, 'No published versions yet.'));
    for (const v of versions) {
      const restore = h('button', { type: 'button', class: 'btn btn--ghost', disabled: v.schema_version < 3, title: v.schema_version < 3 ? 'This version was published before pages and sections existed and cannot be restored.' : undefined, 'aria-label': `Restore version ${v.version}` }, 'Restore');
      restore.onclick = async () => {
        const ok = await confirmDialog(`Restore version ${v.version}?`, 'This replaces your current draft with this version. It does not publish: the live site stays as it is until you publish.', 'Restore to draft', restore);
        if (!ok) return;
        restore.disabled = true;
        const { error } = await sb().rpc('restore_published_snapshot', { p_run_id: v.id });
        if (error) toast(error.code === 'PT422' ? `This version cannot be restored: ${error.message}` : explain(error), 'error');
        else toast(`Version ${v.version} restored to the draft. Publish to make it live.`);
        restore.disabled = v.schema_version < 3;
      };
      versionList.appendChild(h('li', { class: 'list__item' }, h('span', { class: 'tag' }, `v${v.version}`), h('span', { class: 'grow' }, `${formatDate(v.published_at)}${v.published_by_name ? ` · ${v.published_by_name}` : ''}${v.is_live ? ' · live' : ''}`), restore));
    }
  };

  let pollError: HTMLElement | null = null;
  const poll = async () => {
    window.clearTimeout(timer);
    if (!statusEl.isConnected) return;
    try {
      const [runs, versions] = await Promise.all([listRuns(), listVersions().catch(() => null)]);
      if (versions) paintVersions(versions);
      pollError?.remove();
      pollError = null;
      paint(runs);
      if (inFlight(runs[0])) timer = window.setTimeout(() => void poll(), POLL_MS);
    } catch (e) {
      pollError?.remove();
      pollError = h('p', { class: 'field__error', role: 'alert' }, (e as Error).message);
      statusEl.appendChild(pollError);
      button.disabled = false;
      timer = window.setTimeout(() => void poll(), POLL_MS * 3);
    }
  };

  button.onclick = async () => {
    button.disabled = true;
    try {
      await callFunction('publish');
      toast('Publish started');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    await poll();
  };

  el.append(h('h1', {}, 'Publish'), card('Publish the draft', null, note, h('p', {}, button, ' ', siteLink), statusEl), card('History', null, history), card('Versions', null, h('p', { class: 'field__hint' }, 'Restoring copies a published version back into the draft. It does not publish.'), versionList));
  await poll();
}
