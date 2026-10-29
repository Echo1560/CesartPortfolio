/** Activity log: who changed what and when, newest first, filterable. */
import { clear, field, formatDate, h, select } from '../dom';
import { explain, sb } from '../supabase';
import type { ViewContext } from '../main';
import { card } from './shared';

interface Entry {
  id: number;
  occurred_at: string;
  actor_name: string | null;
  action: string;
  table_name: string;
  row_id: string | null;
  details: Record<string, unknown>;
}

const PAGE = 50;
const ACTIONS = ['insert', 'update', 'delete', 'publish', 'invite', 'disable', 'enable', 'remove'];
const VERB: Record<string, string> = { insert: 'Added', update: 'Changed', delete: 'Deleted', publish: 'Published', invite: 'Invited', disable: 'Disabled', enable: 'Enabled', remove: 'Removed' };

/** One line on what changed, from `details`. */
function summary(e: Entry): string {
  const changed = (e.details as { changed?: Record<string, unknown> }).changed;
  if (e.action === 'update' && changed) {
    const keys = Object.keys(changed);
    return keys.length ? `Fields: ${keys.join(', ')}` : '';
  }
  return '';
}

export async function renderActivity(el: HTMLElement, _ctx: ViewContext): Promise<void> {
  const { data: names, error: namesError } = await sb().from('activity_log').select('actor_name').order('occurred_at', { ascending: false }).limit(500);
  if (namesError) throw new Error(explain(namesError));
  const actors = [...new Set((names ?? []).map((n) => n.actor_name).filter((n): n is string => !!n))].sort();
  const tables = [...new Set(((await sb().from('activity_log').select('table_name').limit(500)).data ?? []).map((n) => n.table_name))].sort();

  const who = select([['', 'Everyone'], ...actors.map((a): [string, string] => [a, a])], '');
  const what = select([['', 'Any action'], ...ACTIONS.map((a): [string, string] => [a, VERB[a]!])], '');
  const where = select([['', 'Anything'], ...tables.map((t): [string, string] => [t, t])], '');
  const list = h('ul', { class: 'list', 'aria-live': 'polite' });
  const more = h('button', { type: 'button', class: 'btn btn--ghost', hidden: true }, 'Show older');
  const err = h('p', { class: 'field__error', role: 'alert', hidden: true });
  let offset = 0;

  const load = async (append: boolean) => {
    err.hidden = true;
    if (!append) {
      offset = 0;
      clear(list);
    }
    let q = sb().from('activity_log').select('id, occurred_at, actor_name, action, table_name, row_id, details').order('occurred_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + PAGE - 1);
    if (who.value) q = q.eq('actor_name', who.value);
    if (what.value) q = q.eq('action', what.value);
    if (where.value) q = q.eq('table_name', where.value);
    const { data, error } = await q;
    if (error) {
      err.textContent = explain(error);
      err.hidden = false;
      return;
    }
    const rows = (data ?? []) as Entry[];
    if (!append && rows.length === 0) list.appendChild(h('li', { class: 'empty' }, 'No activity matches these filters.'));
    for (const e of rows) {
      const note = summary(e);
      list.appendChild(
        h('li', { class: 'list__item' },
          h('span', { class: 'grow' }, h('strong', {}, e.actor_name ?? 'System'), ` ${VERB[e.action]?.toLowerCase() ?? e.action} `, h('code', {}, e.row_id ? `${e.table_name}/${e.row_id}` : e.table_name), note ? h('br') : null, note ? h('span', { class: 'field__hint' }, note) : null),
          h('time', { class: 'stamp', datetime: e.occurred_at }, formatDate(e.occurred_at)),
        ),
      );
    }
    offset += rows.length;
    more.hidden = rows.length < PAGE;
  };

  for (const s of [who, what, where]) s.onchange = () => void load(false);
  more.onclick = () => void load(true);
  el.append(h('h1', {}, 'Activity'), h('div', { class: 'row' }, field('Who', who).el, field('Action', what).el, field('Table', where).el), err, card('Changes', null, list, more));
  await load(false);
}
