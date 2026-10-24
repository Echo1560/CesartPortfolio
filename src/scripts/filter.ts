/** Category filter: aria-pressed button group, ?category= in the URL, FLIP re-layout. */
import { duration, easing, reducedMotion } from './util';

export function initFilter(): void {
  const bar = document.querySelector<HTMLElement>('[data-filters]');
  const grid = document.querySelector<HTMLElement>('[data-work-grid]');
  if (!grid) return;
  const tiles = [...grid.querySelectorAll<HTMLElement>('[data-tile]')];
  const empty = document.querySelector<HTMLElement>('[data-empty]');
  const status = document.querySelector<HTMLElement>('[data-filter-status]');
  const buttons = bar ? [...bar.querySelectorAll<HTMLButtonElement>('[data-filter]')] : [];
  const known = new Set(buttons.map((b) => b.dataset.filter));

  function apply(category: string, animate: boolean): void {
    const before = new Map<HTMLElement, DOMRect>();
    if (animate) tiles.forEach((t) => !t.hidden && before.set(t, t.getBoundingClientRect()));

    let shown = 0;
    for (const tile of tiles) {
      const match = category === 'all' || tile.dataset.category === category;
      tile.hidden = !match;
      if (match) shown++;
    }
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === category)));
    if (empty) empty.hidden = shown > 0;
    if (status) status.textContent = `${shown} ${shown === 1 ? 'work' : 'works'} shown`;

    const ms = duration('--dur-base');
    if (!animate || reducedMotion.matches || ms === 0) return;
    const ease = easing('--ease-out');
    for (const tile of tiles) {
      if (tile.hidden) continue;
      const from = before.get(tile);
      const to = tile.getBoundingClientRect();
      if (!from) {
        tile.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: ms, easing: ease });
        continue;
      }
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (dx || dy) tile.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: ms, easing: ease });
    }
  }

  function write(category: string): void {
    const u = new URL(location.href);
    if (category === 'all') u.searchParams.delete('category');
    else u.searchParams.set('category', category);
    history.replaceState(history.state, '', u);
  }

  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      const category = b.dataset.filter ?? 'all';
      apply(category, true);
      write(category);
    }),
  );

  const initial = new URL(location.href).searchParams.get('category');
  if (initial && known.has(initial)) apply(initial, false);
}
