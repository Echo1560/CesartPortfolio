/** The section picker (the "+" between sections) and the block picker (inside text and columns sections). */
import type { BlockType, SectionType } from '../../lib/schema-v3';
import { h, toast } from '../dom';
import type { Draft } from '../data';
import { pickMedia } from '../widgets';
import { ALL_BLOCK_TYPES, ALL_SECTION_TYPES, BLOCK_INFO, NEEDS_MEDIA, SECTION_INFO, newBlock, newSection, sectionThumb } from './defaults';
import { resolvedFromRow } from './model';
import type { EditorStore } from './store';

interface Choice {
  key: string;
  label: string;
  description: string;
  preview?: Node;
}

/** A modal grid of choices. Resolves with the chosen key, or null when closed. */
function choose(title: string, choices: Choice[], opener: Element | null): Promise<string | null> {
  return new Promise((resolve) => {
    let picked: string | null = null;
    const dialog = h('dialog', { class: 'picker picker--grid', 'aria-labelledby': 'choose-title' });
    const grid = h('ul', { class: 'choices' });
    for (const c of choices) {
      grid.appendChild(
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'choice',
              'data-choice': c.key,
              onclick: () => {
                picked = c.key;
                dialog.close();
              },
            },
            c.preview ?? null,
            h('strong', {}, c.label),
            h('span', { class: 'field__hint' }, c.description),
          ),
        ),
      );
    }
    dialog.append(
      h('h2', { id: 'choose-title', class: 'panel__title' }, title),
      grid,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => dialog.close() }, 'Cancel')),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      (opener as HTMLElement | null)?.focus?.();
      resolve(picked);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector<HTMLElement>('.choice')?.focus();
  });
}

const draftOf = (store: EditorStore) => ({ media: store.data.media }) as Draft;

async function mediaFor(store: EditorStore, kinds: ('image' | 'animated' | 'video')[], what: string): Promise<Record<string, unknown> | null> {
  if (!store.data.media.some((m) => kinds.includes(m.kind))) {
    toast(`There is no ${what} in the media library yet. Upload one in the Media library first.`, 'error');
    return null;
  }
  const row = await pickMedia(draftOf(store), kinds, () => undefined);
  if (!row) return null;
  const media = resolvedFromRow(row);
  if (row.kind === 'video') {
    const poster = await pickMedia(draftOf(store), ['image'], () => undefined);
    if (!poster) return null;
    media['posterId'] = poster.id;
    media['poster'] = poster.storage_path;
  }
  return media;
}

/** Asks which section to add, then inserts it at `index` of the current page. */
export async function pickSection(store: EditorStore, index: number, opener: Element | null = null): Promise<void> {
  const type = (await choose(
    'Add a section',
    ALL_SECTION_TYPES.map((t) => ({ key: t, label: SECTION_INFO[t].label, description: SECTION_INFO[t].description, preview: sectionThumb(t) })),
    opener,
  )) as SectionType | null;
  if (!type) return;
  let media: Record<string, unknown> | undefined;
  if (NEEDS_MEDIA.section.includes(type)) {
    const picked = await mediaFor(store, ['image', 'animated'], 'image');
    if (!picked) return;
    media = picked;
  }
  const email = (store.data.snapshot.site as { contact?: { email?: string } }).contact?.email;
  store.insertSection(index, newSection(type, { works: store.data.works, email, media }));
}

/** Asks which block to add to a column of a section. */
export async function pickBlock(store: EditorStore, sectionId: string, column: number, opener: Element | null = null): Promise<void> {
  const type = (await choose(
    'Add a block',
    ALL_BLOCK_TYPES.map((t) => ({ key: t, label: BLOCK_INFO[t].label, description: BLOCK_INFO[t].description })),
    opener,
  )) as BlockType | null;
  if (!type) return;
  let media: Record<string, unknown> | undefined;
  if (NEEDS_MEDIA.block.includes(type)) {
    const picked = await mediaFor(store, type === 'video' ? ['video'] : ['image', 'animated'], type === 'video' ? 'video' : 'image');
    if (!picked) return;
    media = picked;
  }
  store.addBlock(sectionId, column, newBlock(type, column, media));
}

