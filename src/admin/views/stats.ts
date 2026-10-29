/** Stats: visits over time, top works, referrers and devices. Real events only; empty states otherwise. */
import { clear, field, h, select, textInput } from '../dom';
import { explain, sb } from '../supabase';
import type { ViewContext } from '../main';
import { card } from './shared';

interface Daily { day: string; page_views: number; visitors: number }
interface TopWork { work_slug: string; title: string | null; opens: number; video_plays: number }
interface Referrer { referrer_host: string; page_views: number }
interface Device { device: string; page_views: number }
interface Overview { page_views: number; visitors: number; work_opens: number; video_plays: number; contact_clicks: number }

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const num = (n: number) => Number(n).toLocaleString();

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await sb().rpc(name, args);
  if (error) throw new Error(explain(error));
  return (data ?? []) as T[];
}

/** A table whose rows carry an inline proportional bar. The numbers are always in the text. */
function barTable(caption: string, headers: [string, string], rows: [label: string, value: number, text?: string][]): HTMLElement {
  if (rows.length === 0) return h('p', { class: 'empty' }, 'No events in this range.');
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return h(
    'table',
    { class: 'data' },
    h('caption', { class: 'sr-only' }, caption),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, headers[0]), h('th', { scope: 'col', class: 'num' }, headers[1]), h('th', { scope: 'col', class: 'sr-only' }, 'Share'))),
    h('tbody', {}, ...rows.map(([label, value, text]) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', { class: 'num' }, text ?? num(value)), h('td', { class: 'bar-cell', 'aria-hidden': 'true' }, h('span', { class: 'bar', style: `width:${Math.max(2, (value / max) * 100)}%` }))))),
  );
}

/** Daily page views as an SVG column chart with a text summary and a data table behind it. */
function dailyChart(rows: Daily[]): HTMLElement {
  const total = rows.reduce((s, r) => s + Number(r.page_views), 0);
  if (rows.length === 0 || total === 0) return h('p', { class: 'empty' }, 'No page views in this range.');
  const W = 640, H = 180, pad = 24;
  const max = Math.max(...rows.map((r) => Number(r.page_views)), 1);
  const bw = (W - pad) / rows.length;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 18}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  const peak = rows.reduce((a, b) => (Number(b.page_views) > Number(a.page_views) ? b : a));
  svg.setAttribute('aria-label', `Page views per day, ${rows[0]!.day} to ${rows.at(-1)!.day}. ${num(total)} in total, peak ${num(Number(peak.page_views))} on ${peak.day}. The same numbers are in the table below.`);
  const mk = (tag: string, attrs: Record<string, string>, text?: string) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text) e.textContent = text;
    svg.appendChild(e);
    return e;
  };
  mk('line', { x1: String(pad), y1: String(H), x2: String(W), y2: String(H), class: 'chart__axis' });
  mk('text', { x: '0', y: '12', class: 'chart__label' }, num(max));
  rows.forEach((r, i) => {
    const v = Number(r.page_views);
    const bh = (v / max) * (H - 14);
    const bar = mk('rect', { x: String(pad + i * bw + 1), y: String(H - bh), width: String(Math.max(1, bw - 2)), height: String(bh), class: 'chart__bar' });
    const t = document.createElementNS(NS, 'title');
    t.textContent = `${r.day}: ${v} page views`;
    bar.appendChild(t);
  });
  mk('text', { x: String(pad), y: String(H + 14), class: 'chart__label' }, rows[0]!.day);
  mk('text', { x: String(W), y: String(H + 14), class: 'chart__label', 'text-anchor': 'end' }, rows.at(-1)!.day);
  const table = h('table', { class: 'data' }, h('caption', { class: 'sr-only' }, 'Page views and visitors per day'), h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Day'), h('th', { scope: 'col', class: 'num' }, 'Page views'), h('th', { scope: 'col', class: 'num' }, 'Visitors'))), h('tbody', {}, ...rows.map((r) => h('tr', {}, h('th', { scope: 'row' }, r.day), h('td', { class: 'num' }, num(r.page_views)), h('td', { class: 'num' }, num(r.visitors))))));
  return h('div', {}, svg, h('details', {}, h('summary', {}, 'Show as a table'), table));
}

export async function renderStats(el: HTMLElement, _ctx: ViewContext): Promise<void> {
  const today = new Date();
  const range = select([['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['custom', 'Custom range']], '30');
  const from = textInput(ymd(new Date(+today - 29 * DAY)), { type: 'date' });
  const to = textInput(ymd(today), { type: 'date' });
  const err = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const out = h('div', { 'aria-live': 'polite', 'aria-busy': 'false' });
  const customRow = h('div', { class: 'row', hidden: true });
  customRow.append(field('From', from).el, field('To (inclusive)', to).el);

  let reqId = 0;
  const load = async () => {
    const seq = ++reqId;
    err.hidden = true;
    let start: Date, end: Date;
    if (range.value === 'custom') {
      start = new Date(`${from.value}T00:00:00Z`);
      end = new Date(+new Date(`${to.value}T00:00:00Z`) + DAY);
      if (Number.isNaN(+start) || Number.isNaN(+end) || +end <= +start || +end - +start > 400 * DAY) {
        err.textContent = 'Choose a valid range of at most 400 days.';
        err.hidden = false;
        return;
      }
    } else {
      end = new Date(+new Date(`${ymd(today)}T00:00:00Z`) + DAY);
      start = new Date(+end - Number(range.value) * DAY);
    }
    const args = { p_from: start.toISOString(), p_to: end.toISOString() };
    out.setAttribute('aria-busy', 'true');
    try {
      const [overview, daily, works, refs, devices] = await Promise.all([
        rpc<Overview>('stats_overview', args),
        rpc<Daily>('stats_daily', args),
        rpc<TopWork>('stats_top_works', { ...args, p_limit: 10 }),
        rpc<Referrer>('stats_referrers', { ...args, p_limit: 10 }),
        rpc<Device>('stats_devices', args),
      ]);
      if (seq !== reqId) return;
      const o = overview[0];
      clear(out);
      const tiles: [string, number][] = o ? [['Page views', o.page_views], ['Visitors', o.visitors], ['Work opens', o.work_opens], ['Video plays', o.video_plays], ['Contact clicks', o.contact_clicks]] : [];
      out.append(
        h('dl', { class: 'tiles' }, ...tiles.map(([label, v]) => h('div', { class: 'tile' }, h('dt', {}, label), h('dd', {}, num(v))))),
        card('Visits over time', null, dailyChart(daily)),
        card('Top works', null, barTable('Works by opens', ['Work', 'Opens and plays'], works.map((w) => [w.title ?? w.work_slug, Number(w.opens), `${num(w.opens)} opens Â· ${num(w.video_plays)} plays`]))),
        card('Referrers', null, barTable('Referrers by page views', ['Source', 'Page views'], refs.map((r) => [r.referrer_host, Number(r.page_views)]))),
        card('Devices', null, h('p', { class: 'field__hint' }, 'Includes bots, shown as “bot”.'), barTable('Page views by device', ['Device', 'Page views'], devices.map((d) => [d.device, Number(d.page_views)]))),
      );
    } catch (e) {
      if (seq !== reqId) return;
      err.textContent = (e as Error).message;
      err.hidden = false;
    } finally {
      if (seq === reqId) out.setAttribute('aria-busy', 'false');
    }
  };

  range.onchange = () => {
    customRow.hidden = range.value !== 'custom';
    void load();
  };
  from.onchange = to.onchange = () => void load();
  el.append(h('h1', {}, 'Stats'), h('p', { class: 'field__hint' }, 'Privacy-friendly counts of real visits. Bots are left out except in the device split. Times are UTC.'), h('div', { class: 'row' }, field('Date range', range).el), customRow, err, out);
  await load();
}
