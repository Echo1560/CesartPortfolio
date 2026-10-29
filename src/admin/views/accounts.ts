/** Accounts: list editors, invite, disable or remove them (owners), and change your own password. */
import { passwordSchema } from '../auth';
import { clear, field, formatDate, h, textInput, toast } from '../dom';
import { callFunction, explain, sb } from '../supabase';
import type { ViewContext } from '../main';
import { card, runSave } from './shared';

interface Account {
  user_id: string;
  display_name: string;
  email: string;
  role: 'owner' | 'editor';
  disabled_at: string | null;
  created_at: string;
}

export async function renderAccounts(el: HTMLElement, _ctx: ViewContext): Promise<void> {
  const [{ data: owner }, { data: session }, { data, error }] = await Promise.all([
    sb().rpc('is_owner'),
    sb().auth.getSession(),
    sb().from('editors').select('user_id, display_name, email, role, disabled_at, created_at').order('created_at'),
  ]);
  if (error) throw new Error(explain(error));
  const me = session.session?.user.id;
  const isOwner = owner === true;
  const list = h('ul', { class: 'list' });
  const accounts = (data ?? []) as Account[];

  const reload = async () => {
    const res = await sb().from('editors').select('user_id, display_name, email, role, disabled_at, created_at').order('created_at');
    if (res.error) throw new Error(explain(res.error));
    accounts.splice(0, accounts.length, ...(res.data as Account[]));
    paint();
  };
  const act = async (fn: () => Promise<void>, message: string) => {
    try {
      await fn();
      toast(message);
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const paint = () => {
    clear(list);
    for (const a of accounts) {
      const self = a.user_id === me;
      const actions = isOwner && !self
        ? [
            h('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': `${a.disabled_at ? 'Enable' : 'Disable'} ${a.display_name}`, onclick: () => void act(async () => {
              const r = await sb().rpc('set_editor_disabled', { p_user_id: a.user_id, p_disabled: !a.disabled_at });
              if (r.error) throw new Error(explain(r.error));
            }, a.disabled_at ? 'Account enabled' : 'Account disabled') }, a.disabled_at ? 'Enable' : 'Disable'),
            h('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': `Remove ${a.display_name}`, onclick: () => {
              if (!confirm(`Remove ${a.display_name}? Their login is deleted and they lose access.`)) return;
              void act(async () => void (await callFunction('remove-editor', { body: { user_id: a.user_id } })), 'Editor removed');
            } }, 'Remove'),
          ]
        : [];
      list.appendChild(
        h('li', { class: 'list__item' },
          h('span', { class: 'grow' }, h('strong', {}, a.display_name), self ? ' (you)' : '', h('br'), h('span', { class: 'field__hint' }, `${a.email} · added ${formatDate(a.created_at)}`)),
          h('span', { class: 'tag' }, a.role),
          a.disabled_at ? h('span', { class: 'tag tag--archived' }, 'Disabled') : h('span', { class: 'tag tag--published' }, 'Active'),
          ...actions,
        ),
      );
    }
  };
  paint();

  const sections: (Node | null)[] = [h('h1', {}, 'Accounts'), card('Editors', null, list)];

  if (isOwner) {
    const email = textInput('', { type: 'email', autocomplete: 'off', required: true });
    const name = textInput('', { autocomplete: 'off', required: true, maxlength: 80 });
    const fe = field('Email', email), fn = field('Display name', name);
    const submit = h('button', { type: 'submit', class: 'btn' }, 'Send invitation');
    const form = h('form', { novalidate: true, class: 'stack' }, fe.el, fn.el, submit);
    form.onsubmit = (ev) => {
      ev.preventDefault();
      fe.setError(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim()) ? null : 'Enter a valid email address');
      fn.setError(name.value.trim() ? null : 'Enter a name');
      if (!email.validity.valid || fe.control.getAttribute('aria-invalid') || fn.control.getAttribute('aria-invalid')) return;
      void runSave(submit, async () => {
        await callFunction('invite-editor', { body: { email: email.value.trim(), display_name: name.value.trim() } });
        email.value = name.value = '';
        await reload();
      }, 'Invitation sent');
    };
    sections.push(card('Invite an editor', null, h('p', { class: 'field__hint' }, 'They get an email with a link to choose a password. Invited accounts are editors.'), form));
  } else {
    sections.push(h('p', { class: 'field__hint' }, 'Only owners can invite, disable or remove editors.'));
  }

  const pw = textInput('', { type: 'password', autocomplete: 'new-password', required: true });
  const again = textInput('', { type: 'password', autocomplete: 'new-password', required: true });
  const fp = field('New password', pw, 'At least 8 characters.'), fa = field('Repeat the new password', again);
  const save = h('button', { type: 'submit', class: 'btn' }, 'Change password');
  const pwForm = h('form', { novalidate: true, class: 'stack' }, fp.el, fa.el, save);
  pwForm.onsubmit = (ev) => {
    ev.preventDefault();
    const parsed = passwordSchema.safeParse(pw.value);
    const same = pw.value === again.value;
    fp.setError(parsed.success ? null : parsed.error.issues[0]!.message);
    fa.setError(same ? null : 'The passwords do not match');
    if (!parsed.success || !same) return;
    void runSave(save, async () => {
      const { error: e } = await sb().auth.updateUser({ password: pw.value });
      if (e) throw new Error(explain(e));
      pw.value = again.value = '';
    }, 'Password changed');
  };
  sections.push(card('Your password', null, pwForm));
  el.append(...(sections.filter(Boolean) as Node[]));
}
