/**
 * Lightbox on the home grid. A native <dialog> (focus trap, Esc) filled from the
 * per-work <template>s. Opening pushes the work URL so back/forward and shares work;
 * the media zooms from the tile (shared-element FLIP).
 */
import { track } from '../lib/track';
import { initMedia } from './media';
import { duration, easing } from './util';

export function initLightbox(): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-lightbox]');
  if (!dialog) return;
  const body = dialog.querySelector<HTMLElement>('[data-lightbox-body]')!;
  const pageLink = dialog.querySelector<HTMLAnchorElement>('[data-lightbox-page]')!;
  const homeUrl = location.pathname + location.search;

  let group: HTMLElement[] = [];
  let index = -1;
  let opener: HTMLElement | null = null;

  const tileFor = (slug: string) => group.find((t) => t.dataset.slug === slug);

  /** Rect of the tile media for the shared-element zoom, if the tile is on screen. */
  function tileRect(tile: HTMLElement | undefined): DOMRect | undefined {
    const media = tile?.querySelector<HTMLElement>('.media');
    if (!media) return undefined;
    const r = media.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width > 0 ? r : undefined;
  }

  function zoom(el: HTMLElement | null, from: DOMRect | undefined, reverse = false): Promise<unknown> {
    const ms = duration('--dur-base');
    if (!el || !from || ms === 0) return Promise.resolve();
    const to = el.getBoundingClientRect();
    const t = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
    const frames = [{ transform: t, opacity: 0.6 }, { transform: 'none', opacity: 1 }];
    if (reverse) frames.reverse();
    el.style.transformOrigin = '0 0';
    return el.animate(frames, { duration: ms, easing: easing('--ease-out'), fill: 'both' }).finished.then(() => {
      el.style.transformOrigin = '';
    });
  }

  function render(slug: string): boolean {
    const tpl = document.querySelector<HTMLTemplateElement>(`template[data-lightbox-template="${CSS.escape(slug)}"]`);
    if (!tpl) return false;
    body.replaceChildren(tpl.content.cloneNode(true));
    body.scrollTop = 0;
    pageLink.href = tileFor(slug)?.querySelector<HTMLAnchorElement>('a')?.href ?? '#';
    initMedia(body);
    body.querySelector<HTMLElement>('.detail__title')?.focus({ preventScroll: true });
    return true;
  }

  function open(tile: HTMLElement): void {
    const container = tile.closest<HTMLElement>('[data-tile-group]');
    group = [...(container?.querySelectorAll<HTMLElement>('[data-tile]') ?? [])].filter((t) => !t.hidden);
    index = group.indexOf(tile);
    const slug = tile.dataset.slug!;
    if (index < 0 || !render(slug)) return;
    opener = tile.querySelector<HTMLElement>('a');
    dialog!.showModal();
    document.documentElement.style.overflow = 'hidden';
    history.pushState({ lb: slug }, '', pageLink.href);
    track('work_open', { slug, source: 'lightbox' });
    void zoom(body.querySelector('.detail__media .media'), tileRect(tile));
  }

  function go(step: number): void {
    if (!group.length) return;
    index = (index + step + group.length) % group.length;
    const slug = group[index].dataset.slug!;
    if (!render(slug)) return;
    history.replaceState({ lb: slug }, '', pageLink.href);
    track('work_open', { slug, source: 'lightbox' });
    const media = body.querySelector<HTMLElement>('.detail__media');
    const ms = duration('--dur-fast');
    if (ms) media?.animate([{ opacity: 0, transform: `translateX(${step * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: ms, easing: easing('--ease-out') });
  }

  async function finishClose(animated: boolean): Promise<void> {
    if (!dialog!.open) return;
    if (animated) await zoom(body.querySelector('.detail__media .media'), tileRect(group[index]), true);
    dialog!.close();
    body.replaceChildren();
    document.documentElement.style.overflow = '';
    opener?.focus({ preventScroll: true });
    opener = null;
  }

  /** Close through history so the URL goes back to the home page. */
  function requestClose(): void {
    if (history.state?.lb) history.back();
    else void finishClose(true);
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element).closest<HTMLAnchorElement>('.tile__link');
    const tile = link?.closest<HTMLElement>('[data-tile]');
    if (!tile) return;
    e.preventDefault();
    open(tile);
  });

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    requestClose();
  });
  dialog.querySelector('[data-lightbox-close]')?.addEventListener('click', requestClose);
  dialog.querySelector('[data-lightbox-prev]')?.addEventListener('click', () => go(-1));
  dialog.querySelector('[data-lightbox-next]')?.addEventListener('click', () => go(1));

  // Click on the empty backdrop area closes.
  body.addEventListener('click', (e) => {
    if (e.target === body) requestClose();
  });

  dialog.addEventListener('keydown', (e) => {
    const typing = (e.target as Element).closest('video, input, textarea');
    if (e.key === 'ArrowLeft' && !typing) go(-1);
    else if (e.key === 'ArrowRight' && !typing) go(1);
    else if (e.key === 'Tab') {
      // Keep focus inside the dialog even if the browser lets it escape.
      const items = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([hidden]), video[controls], iframe, [tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // Swipe left/right on touch.
  let startX = 0;
  let startY = 0;
  body.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  body.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Back/forward: close when leaving the lightbox state, reopen on forward.
  window.addEventListener('popstate', () => {
    const slug = history.state?.lb as string | undefined;
    if (!slug && dialog.open) void finishClose(true);
    else if (slug && !dialog.open) {
      const tile = [...document.querySelectorAll<HTMLElement>('[data-tile]')].find((t) => t.dataset.slug === slug);
      if (tile) {
        history.replaceState(null, '', homeUrl);
        open(tile);
      }
    }
  });
}
