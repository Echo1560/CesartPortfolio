/**
 * Editing chrome drawn over the canvas page: "+" between sections, a toolbar on the hovered or
 * selected section and block, "add block" buttons in columns, and pointer-based drag reordering.
 * It lives in its own layer next to <body>, so the Preact tree never sees these nodes. Every action is a
 * button with a label (and the panel offers the same actions), so dragging is never the only way.
 */
import { isFlexible } from './defaults';
import type { EditorStore } from './store';

export interface OverlayHooks {
  /** Open the section picker; the new section goes to `index` of the page. */
  onInsert(index: number): void;
  /** Open the block picker for a column of a section. */
  onAddBlock(sectionId: string, column: number): void;
}

export interface Overlay {
  /** Rebuilds the controls from the current DOM (after every render). */
  rebuild(): void;
  /** Only repositions (selection or layout changed). */
  refresh(): void;
  destroy(): void;
}

export const OVERLAY_CSS = `
#ed-layer{position:absolute;top:0;left:0;width:100%;height:0;z-index:50;pointer-events:none;font:600 12px/1 system-ui,sans-serif}
#ed-layer button{pointer-events:auto;font:inherit;cursor:pointer;border:0;color:#fff;background:#2563eb;border-radius:4px;padding:6px 8px;min-width:28px;min-height:28px;line-height:1}
#ed-layer button:hover,#ed-layer button:focus-visible{background:#1d4ed8;outline:2px solid #fff;outline-offset:-4px}
#ed-layer button:disabled{opacity:.4;cursor:default}
.ed-tb{position:absolute;display:none;gap:2px;padding:2px;background:#2563eb;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:auto}
.ed-tb.is-on,.ed-tb:focus-within{display:flex}
.ed-tb button{background:transparent}
.ed-tb--block{background:#7c3aed}
.ed-tb--block button:hover,.ed-tb--block button:focus-visible{background:#6d28d9}
.ed-tb [data-ed=drag]{cursor:grab;touch-action:none}
.ed-plus{position:absolute;left:50%;transform:translate(-50%,-50%);width:28px;height:28px;padding:0!important;border-radius:50%!important;font-size:18px!important;opacity:.35;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.ed-plus:hover,.ed-plus:focus-visible,.ed-plus.is-on{opacity:1}
.ed-add{position:absolute;display:none}
.ed-add.is-on,.ed-add:focus-within{display:block}
.ed-add button{background:#7c3aed}
.ed-line{position:absolute;height:4px;background:#2563eb;border-radius:2px;pointer-events:none}
.ed-line--block{background:#7c3aed}
html.is-dragging,html.is-dragging *{cursor:grabbing!important;user-select:none!important}
`;

type Rect = { top: number; left: number; width: number; height: number };

export function mountOverlay(doc: Document, store: EditorStore, hooks: OverlayHooks): Overlay {
  const win = doc.defaultView!;
  const layer = doc.createElement('div');
  layer.id = 'ed-layer';
  doc.documentElement.appendChild(layer);

  let hoverSection = '';
  let hoverBlock = '';
  let raf = 0;
  let dragging = false;
  const placers: (() => void)[] = [];

  const rectOf = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return { top: r.top + win.scrollY, left: r.left + win.scrollX, width: r.width, height: r.height };
  };
  const place = (el: HTMLElement, r: { top?: number; left?: number; right?: number; width?: number }) => {
    if (r.top !== undefined) el.style.top = `${r.top}px`;
    if (r.left !== undefined) el.style.left = `${r.left}px`;
    if (r.right !== undefined) {
      el.style.right = `${r.right}px`;
      el.style.left = 'auto';
    }
    if (r.width !== undefined) el.style.width = `${r.width}px`;
  };
  const button = (key: string, label: string, text: string, onClick: () => void, disabled = false): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.dataset['ed'] = key;
    b.disabled = disabled;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  };
  const sectionEls = (): HTMLElement[] => {
    const wanted = store.page?.sections.map((s) => s.id) ?? [];
    return wanted.map((id) => doc.querySelector<HTMLElement>(`main [data-section-id="${id}"]`)).filter((e): e is HTMLElement => Boolean(e));
  };

  // ---- drag ------------------------------------------------------------------
  const autoScroll = (clientY: number) => {
    if (clientY < 70) win.scrollBy(0, -24);
    else if (clientY > win.innerHeight - 70) win.scrollBy(0, 24);
  };

  const startDrag = (handle: HTMLElement, e: PointerEvent, kind: 'section' | 'block', sectionId: string, blockId = '') => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    dragging = true;
    doc.documentElement.classList.add('is-dragging');
    const line = doc.createElement('div');
    line.className = `ed-line${kind === 'block' ? ' ed-line--block' : ''}`;
    layer.appendChild(line);
    let drop: { index: number; column: number } | null = null;

    const targetSection = (y: number): number => {
      const els = sectionEls().filter((el) => el.dataset['sectionId'] !== sectionId);
      let k = 0;
      for (const el of els) {
        const r = rectOf(el);
        if (y > r.top + r.height / 2) k += 1;
      }
      const ref = els[k];
      const edge = ref ? rectOf(ref).top : els.length ? rectOf(els[els.length - 1]!).top + rectOf(els[els.length - 1]!).height : 0;
      line.style.top = `${edge - 2}px`;
      line.style.left = '0px';
      line.style.width = '100%';
      return k;
    };

    const targetBlock = (x: number, y: number): { index: number; column: number } | null => {
      const host = doc.querySelector<HTMLElement>(`main [data-section-id="${sectionId}"]`);
      if (!host) return null;
      const cols = [...host.querySelectorAll<HTMLElement>('.columns__col, .text__inner')];
      if (!cols.length) return null;
      let best = 0;
      let bestDist = Infinity;
      cols.forEach((c, i) => {
        const r = rectOf(c);
        const dx = x < r.left ? r.left - x : x > r.left + r.width ? x - r.left - r.width : 0;
        if (dx < bestDist) {
          bestDist = dx;
          best = i;
        }
      });
      const col = cols[best]!;
      const items = [...col.querySelectorAll<HTMLElement>(':scope > [data-block-id]')].filter((el) => el.dataset['blockId'] !== blockId);
      let k = 0;
      for (const el of items) if (y > rectOf(el).top + rectOf(el).height / 2) k += 1;
      const c = rectOf(col);
      const ref = items[k];
      const edge = ref ? rectOf(ref).top : items.length ? rectOf(items[items.length - 1]!).top + rectOf(items[items.length - 1]!).height : c.top;
      line.style.top = `${edge - 2}px`;
      line.style.left = `${c.left}px`;
      line.style.width = `${c.width}px`;
      return { index: k, column: best };
    };

    const move = (ev: PointerEvent) => {
      autoScroll(ev.clientY);
      const y = ev.clientY + win.scrollY;
      const x = ev.clientX + win.scrollX;
      if (kind === 'section') {
        const index = targetSection(y);
        drop = { index, column: 0 };
      } else drop = targetBlock(x, y);
    };
    const finish = (apply: boolean) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      doc.removeEventListener('keydown', key, true);
      line.remove();
      doc.documentElement.classList.remove('is-dragging');
      dragging = false;
      if (apply && drop) {
        if (kind === 'section') store.moveSection(sectionId, drop.index);
        else store.moveBlock(sectionId, blockId, drop.column, drop.index);
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        finish(false);
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
    doc.addEventListener('keydown', key, true);
    move(e);
  };

  // ---- build -------------------------------------------------------------------
  const build = (): void => {
    const focused = (doc.activeElement as HTMLElement | null)?.closest?.('#ed-layer') ? (doc.activeElement as HTMLElement) : null;
    const focusKey = focused ? `${focused.dataset['ed']}|${focused.closest<HTMLElement>('[data-for]')?.dataset['for'] ?? ''}` : '';
    layer.replaceChildren();
    placers.length = 0;
    const page = store.page;
    if (!page) return;
    const els = sectionEls();

    // "+" between sections
    const plusAt = (index: number, y: () => number, label: string) => {
      const b = button('insert', label, '+', () => hooks.onInsert(index));
      b.className = 'ed-plus';
      b.dataset['index'] = String(index);
      layer.appendChild(b);
      placers.push(() => place(b, { top: y() }));
    };
    if (els.length === 0) plusAt(0, () => 120, 'Add a section');
    els.forEach((el, i) => plusAt(i, () => rectOf(el).top, `Add a section before ${el.dataset['sectionType']} section`));
    if (els.length) {
      const last = els[els.length - 1]!;
      plusAt(els.length, () => rectOf(last).top + rectOf(last).height, 'Add a section at the end');
    }

    els.forEach((el, i) => {
      const id = el.dataset['sectionId']!;
      const section = store.findSection(id);
      if (!section) return;
      const label = (section.type as string).replace('-', ' ');
      const tb = doc.createElement('div');
      tb.className = 'ed-tb ed-tb--section';
      tb.dataset['for'] = id;
      tb.setAttribute('role', 'toolbar');
      tb.setAttribute('aria-label', `${label} section`);
      const drag = button('drag', `Drag ${label} section (or use the arrow keys)`, '⠿', () => undefined);
      drag.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
      drag.addEventListener('pointerdown', (e) => startDrag(drag, e, 'section', id));
      drag.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        e.stopPropagation();
        store.moveSection(id, i + (e.key === 'ArrowUp' ? -1 : 1));
      });
      tb.append(
        drag,
        button('up', `Move ${label} section up`, '↑', () => store.moveSection(id, i - 1), i === 0),
        button('down', `Move ${label} section down`, '↓', () => store.moveSection(id, i + 1), i === els.length - 1),
        button('duplicate', `Duplicate ${label} section`, '⧉', () => store.duplicateSection(id)),
        button('settings', `Settings of ${label} section`, '⚙', () => store.select({ sectionId: id })),
        button('delete', `Delete ${label} section`, '🗑', () => store.deleteSection(id)),
      );
      layer.appendChild(tb);
      placers.push(() => {
        const r = rectOf(el);
        place(tb, { top: r.top + 8, right: Math.max(8, win.innerWidth - (r.left + r.width) + 8) });
      });

      // Blocks: a toolbar each, plus "add block" under every column.
      if (isFlexible(section.type)) {
        const cols = [...el.querySelectorAll<HTMLElement>('.columns__col, .text__inner')];
        cols.forEach((col, ci) => {
          const add = doc.createElement('div');
          add.className = 'ed-add';
          add.dataset['forSection'] = id;
          add.dataset['for'] = id;
          const b = button('add-block', cols.length > 1 ? `Add a block to column ${ci + 1}` : 'Add a block', '+ Block', () => hooks.onAddBlock(id, ci));
          add.appendChild(b);
          layer.appendChild(add);
          placers.push(() => {
            const r = rectOf(col);
            place(add, { top: r.top + r.height + 6, left: r.left });
          });
        });
        for (const block of section.blocks ?? []) {
          const bel = el.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`);
          if (!bel) continue;
          const column = block.column;
          const siblings = (section.blocks ?? []).filter((x) => x.column === column);
          const at = siblings.findIndex((x) => x.id === block.id);
          const bl = `${block.type} block`;
          const btb = doc.createElement('div');
          btb.className = 'ed-tb ed-tb--block';
          btb.dataset['for'] = id;
          btb.dataset['forBlock'] = block.id;
          btb.setAttribute('role', 'toolbar');
          btb.setAttribute('aria-label', bl);
          const bdrag = button('drag', `Drag ${bl} (or use the arrow keys)`, '⠿', () => undefined);
          bdrag.addEventListener('pointerdown', (e) => startDrag(bdrag, e, 'block', id, block.id));
          bdrag.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            e.stopPropagation();
            store.moveBlock(id, block.id, column, at + (e.key === 'ArrowUp' ? -1 : 1));
          });
          btb.append(
            bdrag,
            button('up', `Move ${bl} up`, '↑', () => store.moveBlock(id, block.id, column, at - 1), at === 0),
            button('down', `Move ${bl} down`, '↓', () => store.moveBlock(id, block.id, column, at + 1), at === siblings.length - 1),
            button('duplicate', `Duplicate ${bl}`, '⧉', () => store.duplicateBlock(id, block.id)),
            button('delete', `Delete ${bl}`, '🗑', () => store.deleteBlock(id, block.id)),
          );
          layer.appendChild(btb);
          placers.push(() => {
            const r = rectOf(bel);
            place(btb, { top: r.top - 30 < 0 ? r.top + 2 : r.top - 30, left: r.left });
          });
        }
      }
    });
    position();
    if (focusKey) {
      const [ed, forId] = focusKey.split('|');
      const again = [...layer.querySelectorAll<HTMLElement>(`[data-ed="${ed}"]`)].find((b) => (b.closest<HTMLElement>('[data-for]')?.dataset['for'] ?? '') === forId);
      again?.focus({ preventScroll: true });
    }
  };

  const position = (): void => {
    for (const p of placers) p();
    paintOn();
  };

  /** Which controls show: those of the hovered or selected section and block. */
  const paintOn = (): void => {
    const sel = store.selection;
    for (const el of layer.querySelectorAll<HTMLElement>('[data-for]')) {
      const section = el.dataset['for']!;
      const block = el.dataset['forBlock'];
      const on = block ? block === hoverBlock || block === sel?.blockId : section === hoverSection || (section === sel?.sectionId && !sel.blockId);
      el.classList.toggle('is-on', on || (el.classList.contains('ed-add') && (section === hoverSection || section === sel?.sectionId)));
    }
    for (const el of layer.querySelectorAll<HTMLElement>('.ed-plus')) el.classList.toggle('is-on', false);
  };

  const schedule = (): void => {
    if (raf) return;
    raf = win.requestAnimationFrame(() => {
      raf = 0;
      if (!dragging) position();
    });
  };

  const onMove = (e: PointerEvent): void => {
    if (dragging) return;
    const t = e.target as Element | null;
    const section = t?.closest?.('main [data-section-id]')?.getAttribute('data-section-id') ?? (t?.closest?.('#ed-layer [data-for]') as HTMLElement | null)?.dataset['for'] ?? '';
    const block = t?.closest?.('[data-block-id]')?.getAttribute('data-block-id') ?? (t?.closest?.('#ed-layer [data-for-block]') as HTMLElement | null)?.dataset['forBlock'] ?? '';
    if (section !== hoverSection || block !== hoverBlock) {
      hoverSection = section;
      hoverBlock = block;
      paintOn();
    }
  };
  doc.addEventListener('pointermove', onMove);
  win.addEventListener('resize', schedule);
  doc.addEventListener('load', schedule, true);
  const ro = new win.ResizeObserver(schedule);
  ro.observe(doc.body);

  return {
    rebuild: build,
    refresh: position,
    destroy() {
      doc.removeEventListener('pointermove', onMove);
      win.removeEventListener('resize', schedule);
      doc.removeEventListener('load', schedule, true);
      ro.disconnect();
      layer.remove();
    },
  };
}
