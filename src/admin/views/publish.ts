/** Publish: freeze the draft, trigger the rebuild and follow the run. */
import { append, clear, formatDate, h, toast } from '../dom';
import { callFunction } from '../supabase';
import type { ViewContext } from '../main';
import { card } from './shared';

interface Run {
  id: string;
  status: 'pending' | 'dispatched' | 'building' | 'succeeded' | 'failed';
  requested_at: string;
  requested_by_name: string | null;
  dispatched_at: string | null;
  finished_at: string | null;
  github_run_url: string | null;
  error: string | null;
}

const LABEL: Record<Run['status'], string> = { pending: 'Queued', dispatched: 'Queued', building: 'Running', succeeded: 'Success', failed: 'Failed' };
const POLL_MS = 5000;
const SITE_URL = `${location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, '/');

let timer: number | undefined;

const inFlight = (r: Run | undefined) => r !== undefined && (r.status === 'pending' || r.status === 'dispatched' || r.status === 'building');
const listRuns = async () => (await callFunction<{ runs: Run[] }>('publish-status', { method: 'GET', query: 'limit=10' })).runs;

export async function renderPublish(el: HTMLElement, _ctx: ViewContext): Promise<void> {
  window.clearTimeout(timer);
  const statusEl = h('div', { class: 'publish-status', role: 'status', 'aria-live': 'polite' });
  const history = h('ul', { class: 'list' });
  const button = h('button', { type: 'button', class: 'btn' }, 'Publish');
  const note = h('p', { class: 'field__hint' }, 'Publishing freezes the current draft. The live site updates in about 1–2 minutes.');
  const siteLink = h('a', { href: SITE_URL, target: '_blank', rel: 'noopener' }, 'Open the live site');

  const paint = (runs: Run[]) => {
    const latest = runs[0];
    clear(statusEl);
    if (!latest) statusEl.appendChild(h('p', { class: 'empty' }, 'Nothing has been published yet.'));
    else {
      append(statusEl, [
        h('p', {}, h('span', { class: `tag tag--run-${latest.status}` }, LABEL[latest.status]), ' ', `Requested ${formatDate(latest.requested_at)}${latest.requested_by_name ? ` by ${latest.requested_by_name}` : ''}`),
        latest.finished_at ? h('p', { class: 'stamp' }, `Finished ${formatDate(latest.finished_at)}`) : null,
        inFlight(latest) ? h('p', { class: 'field__hint' }, 'Live in about 1–2 minutes. This page updates by itself.') : null,
        latest.status === 'failed' ? h('p', { class: 'field__error' }, latest.error ?? 'The publish failed. The site stays on the previous version.') : null,
        latest.github_run_url ? h('a', { href: latest.github_run_url, target: '_blank', rel: 'noopener' }, 'Build log') : null,
      ]);
    }
    button.disabled = inFlight(latest);
    clear(history);
    if (runs.length === 0) history.appendChild(h('li', { class: 'empty' }, 'No publish history.'));
    for (const r of runs) {
      history.appendChild(h('li', { class: 'list__item' }, h('span', { class: `tag tag--run-${r.status}` }, LABEL[r.status]), h('span', { class: 'grow' }, `${formatDate(r.requested_at)}${r.requested_by_name ? ` · ${r.requested_by_name}` : ''}`), r.error ? h('span', { class: 'field__hint' }, r.error) : null));
    }
  };

  const poll = async () => {
    if (!statusEl.isConnected) return;
    try {
      const runs = await listRuns();
      paint(runs);
      if (inFlight(runs[0])) timer = window.setTimeout(() => void poll(), POLL_MS);
    } catch (e) {
      statusEl.appendChild(h('p', { class: 'field__error', role: 'alert' }, (e as Error).message));
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

  el.append(h('h1', {}, 'Publish'), card('Publish the draft', null, note, h('p', {}, button, ' ', siteLink), statusEl), card('History', null, history));
  await poll();
}
