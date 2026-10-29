/** Login, password reset and set-password views. Email + password only: there is no sign-up path. */
import { z } from 'zod';
import { applyIssues, clear, field, h, textInput, type Field } from './dom';
import { explain, sb } from './supabase';

const emailSchema = z.email('Enter a valid email address');
export const passwordSchema = z.string().min(10, 'Use at least 10 characters');

function card(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'auth', 'aria-labelledby': 'auth-title' }, h('h1', { id: 'auth-title' }, title), ...children);
}

export function renderLogin(root: HTMLElement, message = ''): void {
  clear(root);
  const email = textInput('', { type: 'email', autocomplete: 'username', name: 'email', required: true });
  const password = textInput('', { type: 'password', autocomplete: 'current-password', name: 'password', required: true });
  const fields: Record<string, Field> = { email: field('Email', email), password: field('Password', password) };
  const status = h('p', { class: 'field__error', role: 'alert', hidden: !message }, message);
  const submit = h('button', { type: 'submit', class: 'btn' }, 'Log in');

  const form = h('form', { novalidate: true, class: 'stack' }, fields.email!.el, fields.password!.el, status, submit, h('button', { type: 'button', class: 'link', onclick: () => renderReset(root) }, 'Forgot your password?'));
  form.onsubmit = async (e) => {
    e.preventDefault();
    status.hidden = true;
    const parsed = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password') }).safeParse({ email: email.value.trim(), password: password.value });
    if (!parsed.success) {
      applyIssues(fields, parsed.error.issues);
      return;
    }
    applyIssues(fields, []);
    submit.disabled = true;
    const { error } = await sb().auth.signInWithPassword(parsed.data);
    submit.disabled = false;
    if (error) {
      // One message for every failure so the form does not reveal which accounts exist.
      status.textContent = error.status && error.status >= 500 ? explain(error) : 'Email or password is incorrect.';
      status.hidden = false;
    }
    // On success onAuthStateChange in main.ts takes over.
  };
  root.appendChild(card('Dashboard login', form));
  email.focus();
}

export function renderReset(root: HTMLElement): void {
  clear(root);
  const email = textInput('', { type: 'email', autocomplete: 'username', required: true });
  const fields = { email: field('Email', email) };
  const status = h('p', { role: 'status' });
  const form = h('form', { novalidate: true, class: 'stack' }, fields.email.el, h('button', { type: 'submit', class: 'btn' }, 'Send reset link'), status, h('button', { type: 'button', class: 'link', onclick: () => renderLogin(root) }, 'Back to login'));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email.value.trim());
    if (!parsed.success) {
      fields.email.setError(parsed.error.issues[0]!.message);
      return;
    }
    fields.email.setError(null);
    await sb().auth.resetPasswordForEmail(parsed.data, { redirectTo: location.origin + location.pathname });
    // Same answer whether or not the address has an account.
    status.textContent = 'If that address belongs to an editor, a reset link is on its way.';
  };
  root.appendChild(card('Reset your password', form));
  email.focus();
}

/** Shown after following a password-reset or invite link. */
export function renderSetPassword(root: HTMLElement, onDone: () => void): void {
  clear(root);
  const pw = textInput('', { type: 'password', autocomplete: 'new-password', required: true });
  const again = textInput('', { type: 'password', autocomplete: 'new-password', required: true });
  const fields = { password: field('New password', pw, 'At least 10 characters.'), confirm: field('Repeat the new password', again) };
  const status = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const form = h('form', { novalidate: true, class: 'stack' }, fields.password.el, fields.confirm.el, status, h('button', { type: 'submit', class: 'btn' }, 'Save password'));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(pw.value);
    fields.password.setError(parsed.success ? null : parsed.error.issues[0]!.message);
    const same = pw.value === again.value;
    fields.confirm.setError(same ? null : 'The passwords do not match');
    if (!parsed.success || !same) return;
    const { error } = await sb().auth.updateUser({ password: pw.value });
    if (error) {
      status.textContent = explain(error);
      status.hidden = false;
      return;
    }
    onDone();
  };
  root.appendChild(card('Choose a password', form));
  pw.focus();
}
