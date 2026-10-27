/** Tiny DOM helpers for the dashboard. No framework: the admin island is plain TypeScript. */
export interface Issue {
  path: PropertyKey[];
  message: string;
}

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === 'class') el.className = String(value);
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'selected') (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let idCounter = 0;
export function uid(prefix = 'f'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export interface Field {
  el: HTMLElement;
  control: HTMLElement;
  setError(message: string | null): void;
}

/** A labelled control with an inline error slot wired to `aria-describedby`. */
export function field(label: string, control: HTMLElement, hint?: string): Field {
  const id = uid();
  control.id = control.id || id;
  const errorId = `${control.id}-err`;
  const hintId = `${control.id}-hint`;
  const error = h('p', { class: 'field__error', id: errorId, role: 'alert', hidden: true });
  const describedBy = [hint ? hintId : '', errorId].filter(Boolean).join(' ');
  control.setAttribute('aria-describedby', describedBy);
  const el = h(
    'div',
    { class: 'field' },
    h('label', { for: control.id }, label),
    hint ? h('p', { class: 'field__hint', id: hintId }, hint) : null,
    control,
    error,
  );
  return {
    el,
    control,
    setError(message) {
      error.hidden = !message;
      error.textContent = message ?? '';
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    },
  };
}

export function textInput(value: string | number | null | undefined, attrs: Attrs = {}): HTMLInputElement {
  return h('input', { type: 'text', value: value ?? '', ...attrs });
}

export function textArea(value: string, rows = 4, attrs: Attrs = {}): HTMLTextAreaElement {
  return h('textarea', { rows, value, ...attrs });
}

export function checkbox(label: string, checked: boolean): { el: HTMLLabelElement; input: HTMLInputElement } {
  const input = h('input', { type: 'checkbox', checked });
  return { el: h('label', { class: 'check' }, input, h('span', {}, label)), input };
}

export function select(options: [value: string, label: string][], value: string): HTMLSelectElement {
  const el = h('select', {});
  for (const [v, l] of options) el.appendChild(h('option', { value: v, selected: v === value }, l));
  el.value = value;
  return el;
}

/** Shows zod issues on the matching fields. Returns the messages nothing could show. */
export function applyIssues(fields: Record<string, Field>, issues: readonly Issue[]): string[] {
  for (const f of Object.values(fields)) f.setError(null);
  const rest: string[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const path = issue.path.join('.');
    const target = fields[path];
    if (target && !seen.has(path)) {
      target.setError(issue.message);
      seen.add(path);
    } else if (!target) {
      rest.push(`${path || 'form'}: ${issue.message}`);
    }
  }
  const first = Object.entries(fields).find(([k]) => seen.has(k));
  first?.[1].control.focus();
  return rest;
}

let toastHost: HTMLElement | null = null;

/** Polite status message (success) or alert (error) in a corner region. */
export function toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const t = h('div', { class: `toast toast--${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  toastHost.appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? 9000 : 4000);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function kebab(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}
