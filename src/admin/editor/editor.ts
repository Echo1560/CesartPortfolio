/**
 * The visual editor view: top bar, format bar, canvas and side panel around one
 * `EditorStore`. It replaces the form-based landing page; the other dashboard
 * views stay reachable from the account menu.
 */
import './editor.css';
import { SAFE_HREF } from '../../lib/schema-v3';
import { clear, h, toast } from '../dom';
import { callFunction } from '../supabase';
import { inFlight, LABEL, listRuns, type Run } from '../views/publish';
import { mountCanvas, type Canvas } from './canvas';
import { loadEditorData } from './model';
import { createPanel, type Panel } from './panel';
import { createStylesPanel } from './styles-panel';
import { pickBlock, pickSection } from './picker';
import { EditorStore, type Device, type SaveState } from './store';
import type { FieldBinding } from './inline';

const SAVE_LABEL: Record<SaveState, string> = { saved: 'All changes saved', dirty: 'Unsaved changes…', saving: 'Saving…', error: 'Not saved' };
const DEVICES: [Device, string][] = [
  ['desktop', 'Desktop'],
  ['tablet', 'Tablet'],
  ['mobile', 'Mobile'],
];
const POLL_MS = 5000;
const MENU: [href: string, label: string][] = [
  ['#/pages', 'Pages and navigation'],
  ['#/works', 'Works'],
  ['#/settings', 'Site settings'],
  ['#/media', 'Media library'],
  ['#/stats', 'Stats'],
  ['#/activity', 'Activity'],
  ['#/accounts', 'Accounts'],
  ['#/publish', 'Publish history'],
];

let active: { destroy(): void } | null = null;

/** Tears down the editor shown last (flushes its autosave). */
export function disposeEditor(): void {
  active?.destroy();
  active = null;
}

export async function renderEditor(el: HTMLElement, opts: { slug?: string; email: string; onLogout: () => void }): Promise<void> {
  disposeEditor();
  clear(el);
  const loading = h('p', { class: 'editor__loading', role: 'status' }, 'Loading the editor…');
  el.appendChild(loading);
  let store: EditorStore;
  try {
    store = new EditorStore(await loadEditorData(), opts.slug);
  } catch (e) {
    loading.replaceWith(h('p', { class: 'field__error', role: 'alert' }, `${(e as Error).message} If a media file is missing alt text or a poster, fix it in Works or the Media library, then reload.`));
    return;
  }
  loading.remove();

  // ---- top bar -------------------------------------------------------------
  const pageSelect = h('select', { 'aria-label': 'Page', class: 'editor__page' });
  const fillPages = () => {
    clear(pageSelect);
    for (const p of store.pages) pageSelect.appendChild(h('option', { value: p.id, selected: p.id === store.pageId }, `${p.title}${p.isHome ? ' (home)' : ''}${p.status !== 'published' ? ` · ${p.status}` : ''}`));
    pageSelect.value = store.pageId;
  };
  pageSelect.addEventListener('change', () => {
    store.setPage(pageSelect.value);
    const slug = store.page?.slug;
    if (slug) history.replaceState(null, '', `#/editor/${slug}`);
  });

  const deviceButtons = DEVICES.map(([d, label]) =>
    h('button', { type: 'button', class: 'btn-icon', 'data-device': d, 'aria-pressed': String(d === store.device), 'aria-label': `${label} width`, title: `${label} width`, onclick: () => store.setDevice(d) }, label[0]),
  );
  const undo = h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Undo', title: 'Undo (Ctrl+Z)', onclick: () => store.undo() }, '↶');
  const redo = h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Redo', title: 'Redo (Ctrl+Shift+Z)', onclick: () => store.redo() }, '↷');
  const flash = h('span', { class: 'editor__flash', role: 'status', 'aria-live': 'polite' });
  const saveState = h('span', { class: 'editor__save', role: 'status', 'aria-live': 'polite' });
  const stylesButton = h('button', { type: 'button', class: 'btn btn--ghost', 'aria-pressed': 'false', 'data-action': 'site-styles' }, 'Site styles');
  const previewButton = h('button', { type: 'button', class: 'btn btn--ghost', 'aria-pressed': 'false', 'data-action': 'preview' }, 'Preview');
  const publishButton = h('button', { type: 'button', class: 'btn' }, 'Publish');
  const publishState = h('span', { class: 'editor__publish', role: 'status', 'aria-live': 'polite' });
  const menu = h(
    'details',
    { class: 'editor__menu' },
    h('summary', {}, 'Account'),
    h('div', { class: 'editor__menu-list' }, h('p', { class: 'stamp' }, opts.email), ...MENU.map(([href, label]) => h('a', { href }, label)), h('button', { type: 'button', class: 'link', onclick: opts.onLogout }, 'Log out')),
  );
  const topbar = h(
    'header',
    { class: 'editor__bar' },
    h('strong', {}, 'Cesart'),
    pageSelect,
    h('div', { class: 'editor__group', role: 'group', 'aria-label': 'Preview width' }, ...deviceButtons),
    h('div', { class: 'editor__group', role: 'group', 'aria-label': 'History' }, undo, redo),
    saveState,
    flash,
    h('span', { class: 'grow' }),
    stylesButton,
    previewButton,
    publishButton,
    publishState,
    menu,
  );

  // ---- format bar ----------------------------------------------------------
  let linkRange: Range | null = null;
  const keepSelection = (e: Event) => e.preventDefault();
  const fmtButton = (label: string, title: string, run: () => void) => h('button', { type: 'button', class: 'btn-icon', title, 'aria-label': title, onmousedown: keepSelection, onclick: run }, label);
  let canvas: Canvas;
  const linkInput = h('input', { type: 'text', 'aria-label': 'Link address', placeholder: 'https://…' });
  const linkError = h('span', { class: 'field__error', role: 'alert', hidden: true });
  const linkForm = h('form', { class: 'editor__link', hidden: true }, linkInput, h('button', { type: 'submit', class: 'btn' }, 'Apply'), h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => canvas.exec('unlink') }, 'Remove link'), linkError);
  linkForm.addEventListener('submit', (e) => {
    e.preventDefault();
    let href = linkInput.value.trim();
    if (href && !/^([a-z]+:|\/|#)/i.test(href)) href = `https://${href}`;
    if (!SAFE_HREF.test(href)) {
      linkError.textContent = 'Use an https:// address, mailto: or tel:.';
      linkError.hidden = false;
      return;
    }
    linkError.hidden = true;
    const field = canvas.activeField();
    field?.el.focus();
    if (linkRange) canvas.restoreRange(linkRange);
    canvas.exec('createLink', href);
    linkForm.hidden = true;
  });
  const richOnly: HTMLElement[] = [
    fmtButton('H2', 'Heading 2', () => canvas.exec('formatBlock', 'h2')),
    fmtButton('H3', 'Heading 3', () => canvas.exec('formatBlock', 'h3')),
    fmtButton('H4', 'Heading 4', () => canvas.exec('formatBlock', 'h4')),
    fmtButton('¶', 'Paragraph', () => canvas.exec('formatBlock', 'p')),
    fmtButton('•', 'Bulleted list', () => canvas.exec('insertUnorderedList')),
    fmtButton('1.', 'Numbered list', () => canvas.exec('insertOrderedList')),
  ];
  const inlineButtons: HTMLElement[] = [
    fmtButton('B', 'Bold (Ctrl+B)', () => canvas.exec('bold')),
    fmtButton('I', 'Italic (Ctrl+I)', () => canvas.exec('italic')),
    fmtButton('Link', 'Link', () => {
      linkRange = canvas.selectionRange();
      linkInput.value = '';
      linkError.hidden = true;
      linkForm.hidden = false;
      linkInput.focus();
    }),
  ];
  const fmtHint = h('span', { class: 'field__hint' }, 'Click text on the page to edit it.');
  const fmt = h('div', { class: 'editor__fmt', role: 'toolbar', 'aria-label': 'Text formatting' }, ...inlineButtons, ...richOnly, fmtHint, linkForm);
  const setFmt = (b: FieldBinding | null) => {
    for (const x of [...inlineButtons, ...richOnly]) (x as HTMLButtonElement).disabled = !b;
    for (const x of richOnly) (x as HTMLButtonElement).hidden = b?.kind !== 'rich';
    fmtHint.hidden = Boolean(b);
    // Keep the link form open while the focus moves into it.
    if (!b && !linkForm.contains(document.activeElement)) linkForm.hidden = true;
  };
  setFmt(null);

  // ---- body ----------------------------------------------------------------
  const notice = h('div', { class: 'editor__notice', role: 'alert', hidden: true });
  const stage = h('div', { class: 'editor__stage' });
  const panelHost = h('aside', { class: 'editor__panel', 'aria-label': 'Settings' });
  const panelBody = h('div', { class: 'editor__panel-body' });
  const stylesBody = h('div', { class: 'editor__panel-body', hidden: true });
  panelHost.append(panelBody, stylesBody);
  const panel: Panel = createPanel(panelBody, store);
  const styles = createStylesPanel(stylesBody, store);
  stylesButton.addEventListener('click', () => {
    const open = stylesBody.hidden;
    stylesBody.hidden = !open;
    panelBody.hidden = open;
    stylesButton.setAttribute('aria-pressed', String(open));
    if (open) styles.render();
    (open ? stylesBody : panelBody).querySelector<HTMLElement>('h2')?.focus();
  });
  canvas = mountCanvas(stage, store, {
    onEditable: setFmt,
    onMedia: (_sel, slot, open) => panel.focusMedia(slot, open),
    onInsert: (index, opener) => void pickSection(store, index, opener),
    onAddBlock: (sectionId, column, opener) => void pickBlock(store, sectionId, column, opener),
  });
  previewButton.addEventListener('click', () => {
    const on = previewButton.getAttribute('aria-pressed') !== 'true';
    store.select(null);
    canvas.setPreview(on);
    el.classList.toggle('editor--preview', on);
    previewButton.setAttribute('aria-pressed', String(on));
    previewButton.textContent = on ? 'Back to editing' : 'Preview';
  });
  el.append(topbar, fmt, notice, h('div', { class: 'editor__body' }, h('div', { class: 'editor__canvas' }, stage), panelHost));

  // ---- publish -------------------------------------------------------------
  let pollTimer: number | undefined;
  let gone = false;
  const paintRun = (run: Run | undefined) => {
    publishState.textContent = run ? `${LABEL[run.status]}${run.status === 'failed' && run.error ? `: ${run.error}` : ''}` : '';
    publishState.dataset['status'] = run?.status ?? '';
    publishButton.disabled = inFlight(run);
  };
  const poll = async (): Promise<void> => {
    window.clearTimeout(pollTimer);
    if (gone) return;
    try {
      const runs = await listRuns();
      paintRun(runs[0]);
      if (inFlight(runs[0])) pollTimer = window.setTimeout(() => void poll(), POLL_MS);
    } catch {
      publishState.textContent = 'Publish status unavailable';
      pollTimer = window.setTimeout(() => void poll(), POLL_MS * 3);
    }
  };
  publishButton.addEventListener('click', async () => {
    publishButton.disabled = true;
    try {
      // An edit can land while saving: go on until nothing is pending.
      do await store.flush();
      while (store.saveState === 'dirty' || store.saveState === 'saving');
      if (store.saveState === 'error') throw new Error(`Fix the unsaved change first: ${store.saveError}`);
      await callFunction('publish');
      toast('Publish started');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    await poll();
  });

  // ---- store -> view ---------------------------------------------------------
  const paintBar = () => {
    undo.disabled = !store.canUndo;
    redo.disabled = !store.canRedo;
  };
  const paintSave = () => {
    saveState.textContent = SAVE_LABEL[store.saveState] + (store.saveState === 'error' ? `: ${store.saveError}` : '');
    saveState.dataset['state'] = store.saveState;
  };
  const paintDevice = () => {
    stage.dataset['device'] = store.device;
    for (const b of deviceButtons) b.setAttribute('aria-pressed', String(b.dataset['device'] === store.device));
  };
  const off = store.on((e) => {
    switch (e.kind) {
      case 'content':
        paintBar();
        if (e.source === 'theme') canvas.refreshTheme();
        else if (e.source !== 'inline') canvas.refresh(e.source === 'history' || e.source === 'structure');
        if (e.source === 'history' || e.source === 'structure') panel.render();
        break;
      case 'selection':
        canvas.markSelected();
        panel.render();
        break;
      case 'page':
        fillPages();
        canvas.refresh(true);
        panel.render();
        break;
      case 'device':
        paintDevice();
        break;
      case 'flash':
        clear(flash);
        if (store.flash) flash.append(store.flash, ' ', h('button', { type: 'button', class: 'link', onclick: () => store.undo() }, 'Undo'));
        break;
      case 'save':
        paintSave();
        break;
      case 'notice':
        notice.hidden = !store.notice;
        clear(notice);
        if (store.notice) notice.append(store.notice, ' ', h('button', { type: 'button', class: 'link', onclick: () => store.dismissNotice() }, 'Dismiss'));
        break;
    }
  });

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    if (e.key === 'Escape' && !typing && !document.querySelector('dialog[open]')) {
      store.select(null);
      return;
    }
    if (e.altKey && !typing && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && store.selection) {
      // Keyboard alternative to dragging: Alt+Up / Alt+Down moves the selected block or section.
      e.preventDefault();
      store.nudgeSelection(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      void store.flush();
    } else if (!typing && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (!typing && k === 'y') {
      e.preventDefault();
      store.redo();
    }
  };
  const onUnload = (e: BeforeUnloadEvent) => {
    if (store.saveState === 'saved') return;
    e.preventDefault();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void store.flush();
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onUnload);
  document.addEventListener('visibilitychange', onVisibility);

  fillPages();
  paintBar();
  paintSave();
  paintDevice();
  panel.render();
  void poll();

  active = {
    destroy() {
      gone = true;
      window.clearTimeout(pollTimer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      off();
      el.classList.remove('editor--preview');
      // Leaving the editor must not lose the last edits.
      void store.flush().finally(() => store.destroy());
      canvas.destroy();
    },
  };
}
