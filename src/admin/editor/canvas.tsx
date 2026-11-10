/**
 * The editor canvas: the shared Preact section components rendered with the draft
 * data and the theme CSS into an isolated iframe, so the page looks exactly as it
 * will publish. It adds hover outlines, click-to-select and inline text editing.
 */
import { render } from 'preact';
import globalCss from '../../styles/global.css?inline';
import siteCss from '../../styles/site.css?inline';
import tokensCss from '../../styles/tokens.css?inline';
import { PageView, createRenderContext, FooterRoot, HeaderRoot } from '../../components/render/Shell';
import { RenderCtx, mediaKey, type RenderContext } from '../../components/render/context';

import type { ResolvedImage, ResolvedMedia } from '../../lib/media';
import { fontFaceCss, themeToCss } from '../../lib/theme-css';
import { signedUrls } from '../data';
import { isResolvedMedia } from './model';
import { findFields, inlineOf, richOf, type FieldBinding } from './inline';
import type { EditorStore, Selection } from './store';

const BASE = import.meta.env.BASE_URL.replace(/\/*$/, '/');

const EDITOR_CSS = `
html{scroll-behavior:auto}
[data-section-id]{position:relative}
[data-section-id]:hover{outline:2px solid rgba(37,99,235,.55);outline-offset:-2px}
[data-section-id].is-selected{outline:3px solid #2563eb;outline-offset:-3px}
[data-section-id]:hover::before,[data-section-id].is-selected::before{content:attr(data-section-type);position:absolute;top:0;left:0;z-index:20;background:#2563eb;color:#fff;font:600 11px/1 system-ui,sans-serif;padding:4px 7px;text-transform:capitalize;pointer-events:none}
[data-block-id]:hover{outline:1px dashed #7c3aed;outline-offset:2px}
[data-block-id].is-selected{outline:2px solid #7c3aed;outline-offset:2px}
[contenteditable]{cursor:text}
[contenteditable]:hover{outline:1px dotted #2563eb;outline-offset:3px}
[contenteditable]:focus{outline:2px solid #2563eb;outline-offset:3px}
.media{cursor:pointer}
.reveal{opacity:1!important;transform:none!important}
.hide-desktop.hide-tablet.hide-mobile{display:block!important;opacity:.35}
a{cursor:default}
.site-header{position:static}
`;

export interface CanvasHooks {
  /** An editable text element gained (binding) or lost (null) focus. */
  onEditable(binding: FieldBinding | null): void;
  /** An image or GIF was clicked (`open` on double click). */
  onMedia(sel: Selection, slot: string, open: boolean): void;
}

export interface Canvas {
  frame: HTMLIFrameElement;
  /** Re-render the page. `fresh` throws the old DOM away first (needed after inline typing). */
  refresh(fresh?: boolean): void;
  /** Updates the selection outline without re-rendering. */
  markSelected(): void;
  /** Runs an editing command in the page (bold, italic, createLink, formatBlock…). */
  exec(command: string, value?: string): boolean;
  /** The saved selection range inside the page, for the link prompt. */
  selectionRange(): Range | null;
  restoreRange(range: Range): void;
  activeField(): FieldBinding | null;
  /** Commits and leaves the focused text. */
  blur(): void;
  destroy(): void;
}

const isMediaLike = (v: unknown): v is Record<string, any> => isResolvedMedia(v);

/** Every resolved media in a JSON tree. */
function collectMedia(value: unknown, out: Record<string, any>[]): void {
  if (Array.isArray(value)) value.forEach((v) => collectMedia(v, out));
  else if (typeof value === 'object' && value !== null) {
    if (isMediaLike(value)) out.push(value);
    else Object.values(value).forEach((v) => collectMedia(v, out));
  }
}

function still(url: string, m: Record<string, any>): ResolvedImage {
  return { type: 'image', src: url, srcset: '', sizes: '100vw', width: m['width'], height: m['height'], alt: m['alt'] ?? '' };
}

/** Signed-URL version of what `lib/media.ts` resolves at build time. Only media not seen before is fetched. */
async function resolveInto(cache: Map<string, ResolvedMedia>, list: Record<string, any>[]): Promise<void> {
  const fresh = list.filter((m) => !cache.has(mediaKey(m as never)));
  if (fresh.length === 0) return;
  const paths = fresh.flatMap((m) => (m['type'] === 'embed' ? [] : [m['src'] as string, ...(m['poster'] ? [m['poster'] as string] : [])]));
  let urls = new Map<string, string>();
  try {
    urls = await signedUrls(paths);
  } catch {
    /* previews fall back to nothing; the panel still works */
  }
  for (const m of fresh) {
    const key = mediaKey(m as never);
    const poster = m['poster'] && urls.get(m['poster']) ? still(urls.get(m['poster'])!, m) : undefined;
    if (m['type'] === 'embed') {
      cache.set(key, { type: 'embed', provider: m['provider'] ?? 'youtube', embedUrl: '', pageUrl: m['src'], width: m['width'], height: m['height'], alt: m['alt'] ?? '', poster });
      continue;
    }
    const url = urls.get(m['src']);
    if (!url) continue;
    if (m['type'] === 'image') cache.set(key, still(url, m));
    else if (m['type'] === 'animated') cache.set(key, { type: 'animated', src: url, sources: [], width: m['width'], height: m['height'], alt: m['alt'] ?? '', loop: m['loop'] !== false, poster });
    else if (poster) cache.set(key, { type: 'video', src: url, mimeType: /\.webm$/i.test(m['src']) ? 'video/webm' : 'video/mp4', width: m['width'], height: m['height'], alt: m['alt'] ?? '', loop: m['loop'] === true, poster });
  }
}

export function mountCanvas(host: HTMLElement, store: EditorStore, hooks: CanvasHooks): Canvas {
  const media = new Map<string, ResolvedMedia>();
  let token = 0;
  let active: FieldBinding | null = null;
  let bindings: FieldBinding[] = [];
  let typed = new Set<HTMLElement>();
  let doc: Document | null = null;
  let body: HTMLElement | null = null;
  let pending: { fresh: boolean } | null = null;
  let ready = false;
  let destroyed = false;

  const frame = document.createElement('iframe');
  frame.className = 'canvas__frame';
  frame.title = 'Page canvas';
  // Same-origin so this code can edit the page; no scripts run inside it.
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${tokensCss}${globalCss}${siteCss}</style><style id="theme"></style><style>${EDITOR_CSS}</style></head><body id="top"></body></html>`;
  host.appendChild(frame);

  const themeCss = (): string => {
    const tokens = store.data.snapshot.theme.tokens;
    try {
      return fontFaceCss(tokens, (font, weight) => `${location.origin}${BASE}assets/fonts/${font}-${weight}.woff2`) + themeToCss(tokens);
    } catch {
      return '';
    }
  };

  const context = (page: EditorPageLike): RenderContext => {
    const base = createRenderContext(store.data.snapshot, BASE, media, page as never);
    return { ...base, pages: store.pages as never, page: page as never };
  };

  type EditorPageLike = NonNullable<EditorStore['page']>;

  const paint = async (fresh: boolean): Promise<void> => {
    if (!ready || !doc || !body) {
      pending = { fresh: fresh || (pending?.fresh ?? false) };
      return;
    }
    const mine = ++token;
    const page = store.page;
    const list: Record<string, any>[] = [];
    collectMedia(page?.sections, list);
    for (const w of store.data.works) collectMedia([w.media, ...(w.gallery ?? [])], list);
    await resolveInto(media, list);
    if (mine !== token || destroyed || !body || !doc) return;
    doc.getElementById('theme')!.textContent = themeCss();
    const scroll = frame.contentWindow?.scrollY ?? 0;
    if (fresh) render(null, body);
    if (page) {
      const ctx = context(page);
      render(
        <>
          <HeaderRoot ctx={ctx} />
          <main id="main">
            <RenderCtx.Provider value={ctx}>
              <PageView sections={page.sections} />
            </RenderCtx.Provider>
          </main>
          <FooterRoot ctx={ctx} year={new Date().getFullYear()} />
        </>,
        body,
      );
    } else render(null, body);
    frame.contentWindow?.scrollTo(0, scroll);
    decorate();
  };

  const markSelected = (): void => {
    if (!doc) return;
    const sel = store.selection;
    for (const el of doc.querySelectorAll('.is-selected')) el.classList.remove('is-selected');
    if (!sel) return;
    const target = sel.blockId ? doc.querySelector(`[data-block-id="${sel.blockId}"]`) : doc.querySelector(`[data-section-id="${sel.sectionId}"]`);
    target?.classList.add('is-selected');
  };

  /** After every render: selection classes and editable text. */
  const decorate = (): void => {
    if (!doc) return;
    typed = new Set();
    markSelected();
    bindings = findFields(doc);
    for (const b of bindings) {
      b.el.setAttribute('contenteditable', 'true');
      b.el.setAttribute('role', 'textbox');
      b.el.setAttribute('aria-label', `Edit ${b.label.toLowerCase()}`);
      if (b.kind === 'inline') b.el.setAttribute('aria-multiline', 'false');
      else b.el.setAttribute('aria-multiline', 'true');
      b.el.addEventListener('focus', () => {
        active = b;
        store.select(b.blockId ? { sectionId: b.sectionId, blockId: b.blockId } : { sectionId: b.sectionId });
        hooks.onEditable(b);
      });
      b.el.addEventListener('input', () => {
        typed.add(b.el);
        commit(b);
      });
      b.el.addEventListener('keydown', (e) => {
        if (b.kind === 'inline' && e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          b.el.blur();
        }
      });
      b.el.addEventListener('paste', (e) => {
        // Plain text only: pasted markup never reaches the model.
        e.preventDefault();
        const text = e.clipboardData?.getData('text/plain') ?? '';
        doc!.execCommand('insertText', false, b.kind === 'inline' ? text.replace(/\s*\n\s*/g, ' ') : text);
      });
      b.el.addEventListener('blur', () => {
        if (active?.el === b.el) active = null;
        hooks.onEditable(null);
        if (typed.has(b.el)) {
          commit(b);
          void paint(true);
        }
      });
    }
  };

  const commit = (b: FieldBinding): void => {
    const value = b.kind === 'inline' ? inlineOf(b.el, BASE) : richOf(b.el, BASE);
    const key = `${b.sectionId}:${b.blockId ?? ''}:${b.key}`;
    const apply = (content: Record<string, unknown>) => {
      if (JSON.stringify(content[b.key]) !== JSON.stringify(value)) content[b.key] = value;
    };
    const current = b.blockId ? store.findBlock(b.sectionId, b.blockId)?.content : store.findSection(b.sectionId)?.content;
    if (JSON.stringify((current as Record<string, unknown> | undefined)?.[b.key]) === JSON.stringify(value)) return;
    if (b.blockId) store.editBlock(b.sectionId, b.blockId, (x) => apply(x.content as Record<string, unknown>), 'inline', key);
    else store.editSection(b.sectionId, (x) => apply(x.content as Record<string, unknown>), 'inline', key);
  };

  const mediaSlot = (el: Element): string => {
    if (el.closest('.sec__bg')) return 'backgroundImage';
    if (el.closest('.about__portrait')) return 'portrait';
    return 'media';
  };

  const attach = (d: Document): void => {
    d.addEventListener('click', (e) => {
      const target = e.target as Element | null;
      if (!target) return;
      // Links never navigate inside the editor.
      if (target.closest('a')) e.preventDefault();
      if (target.closest('.site-header, .site-footer')) return;
      const blockEl = target.closest<HTMLElement>('[data-block-id]');
      const sectionEl = target.closest<HTMLElement>('[data-section-id]');
      if (!sectionEl) {
        store.select(null);
        return;
      }
      const sel: Selection = blockEl ? { sectionId: sectionEl.dataset['sectionId']!, blockId: blockEl.dataset['blockId']! } : { sectionId: sectionEl.dataset['sectionId']! };
      store.select(sel);
      const m = target.closest('.media');
      if (m) hooks.onMedia(sel, mediaSlot(m), false);
    });
    d.addEventListener('dblclick', (e) => {
      const m = (e.target as Element | null)?.closest('.media');
      const sectionEl = m?.closest<HTMLElement>('[data-section-id]');
      if (!m || !sectionEl) return;
      const blockEl = m.closest<HTMLElement>('[data-block-id]');
      hooks.onMedia({ sectionId: sectionEl.dataset['sectionId']!, ...(blockEl ? { blockId: blockEl.dataset['blockId']! } : {}) }, mediaSlot(m), true);
    });
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (active) active.el.blur();
        else store.select(null);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void store.flush();
      } else if (!active && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (!active && k === 'y') {
        e.preventDefault();
        store.redo();
      }
    });
  };

  frame.addEventListener('load', () => {
    doc = frame.contentDocument;
    body = doc?.body ?? null;
    if (!doc || !body) return;
    ready = true;
    attach(doc);
    void paint(pending?.fresh ?? true);
    pending = null;
  });

  return {
    frame,
    refresh: (fresh = false) => void paint(fresh),
    markSelected,
    exec: (command, value) => doc?.execCommand(command, false, value) ?? false,
    selectionRange: () => {
      const s = frame.contentWindow?.getSelection();
      return s && s.rangeCount > 0 ? s.getRangeAt(0).cloneRange() : null;
    },
    restoreRange: (range) => {
      const s = frame.contentWindow?.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    },
    activeField: () => active,
    blur: () => active?.el.blur(),
    destroy: () => {
      destroyed = true;
      if (body) render(null, body);
      frame.remove();
    },
  };
}
