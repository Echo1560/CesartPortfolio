/** Dashboard entry: auth gate, shell and hash router. */
import { clear, h, toast } from './dom';
import { loadDraft, type Draft } from './data';
import { renderLogin, renderSetPassword } from './auth';
import { arrivedViaEmailLink, configured, sb } from './supabase';
import { renderContent } from './views/content';
import { renderWorks } from './views/works';
import { renderLayout } from './views/layout';
import { renderMedia } from './views/media';
import { renderPreview } from './views/preview';

export interface ViewContext {
  draft: Draft;
  /** Reload the draft from the database and re-render the current view. */
  refresh(): Promise<void>;
}

const ROUTES: [id: string, label: string, render: (el: HTMLElement, ctx: ViewContext) => void | Promise<void>][] = [
  ['content', 'Content', renderContent],
  ['works', 'Works', renderWorks],
  ['layout', 'Layout', renderLayout],
  ['media', 'Media library', renderMedia],
  ['preview', 'Preview', renderPreview],
];

const root = document.getElementById('admin-root')!;
let recovering = arrivedViaEmailLink;

function boot(): void {
  if (!configured) {
    clear(root);
    root.appendChild(h('section', { class: 'auth' }, h('h1', {}, 'Dashboard not configured'), h('p', {}, 'This build has no Supabase connection. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY and rebuild.')));
    return;
  }
  const client = sb();
  client.auth.onAuthStateChange((event, session) => {
    // Never await Supabase calls inside this callback.
    if (event === 'PASSWORD_RECOVERY') recovering = true;
    setTimeout(() => void route(Boolean(session)), 0);
  });
  void route(null);
}

/** The active shell's render function. One listener serves every login, so none pile up. */
let currentShow: (() => Promise<void>) | null = null;
window.addEventListener('hashchange', () => void currentShow?.());
let shownFor: string | null = null;
let loginMessage = '';

async function route(hasSession: boolean | null): Promise<void> {
  const { data } = await sb().auth.getSession();
  const session = data.session;
  if (hasSession === false || !session) {
    shownFor = null;
    renderLogin(root, loginMessage);
    loginMessage = '';
    return;
  }
  if (recovering) {
    renderSetPassword(root, () => {
      recovering = false;
      history.replaceState(null, '', location.pathname);
      void route(true);
    });
    return;
  }
  if (shownFor === session.user.id) return;
  const { data: isEditor, error } = await sb().rpc('is_editor');
  if (error || isEditor !== true) {
    // Not an active editor: leave only the login form.
    loginMessage = 'This account does not have dashboard access.';
    await sb().auth.signOut();
    return;
  }
  shownFor = session.user.id;
  await renderShell(session.user.email ?? '');
}

async function renderShell(email: string): Promise<void> {
  clear(root);
  const main = h('main', { id: 'admin-main', tabindex: '-1' });
  const nav = h('nav', { 'aria-label': 'Dashboard sections' });
  const logout = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => void sb().auth.signOut() }, 'Log out');
  root.append(
    h('header', { class: 'bar' }, h('strong', {}, 'Cesart · dashboard'), nav, h('span', { class: 'bar__user' }, email), logout),
    h('p', { class: 'banner' }, 'Everything you save here is a draft. It is not public until it is published.'),
    main,
  );

  let draft = await loadDraft().catch((e: Error) => {
    toast(e.message, 'error');
    return null;
  });
  if (!draft) return;

  const current = () => ROUTES.find(([id]) => id === location.hash.replace(/^#\/?/, '').split('/')[0]) ?? ROUTES[0]!;
  const ctx: ViewContext = {
    get draft() {
      return draft!;
    },
    async refresh() {
      draft = await loadDraft();
      await show();
    },
  };
  const show = async () => {
    const [id, , render] = current();
    for (const a of nav.querySelectorAll('a')) a.toggleAttribute('aria-current', a.dataset.route === id);
    for (const a of nav.querySelectorAll('a[aria-current]')) a.setAttribute('aria-current', 'page');
    clear(main);
    try {
      await render(main, ctx);
    } catch (e) {
      main.appendChild(h('p', { class: 'field__error', role: 'alert' }, (e as Error).message));
    }
  };
  for (const [id, label] of ROUTES) nav.appendChild(h('a', { href: `#/${id}`, 'data-route': id }, label));
  currentShow = show;
  await show();
}

boot();
