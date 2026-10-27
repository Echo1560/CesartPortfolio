/** Media library: upload, preview, replace, delete (with a usage warning). */
import { clear, formatBytes, h, textInput, toast } from '../dom';
import { stampText, type MediaRow } from '../data';
import { ACCEPT, isLive, remove, replace, updateAlt, upload, usageOf } from '../library';
import { thumb } from '../widgets';
import type { ViewContext } from '../main';

export function renderMedia(el: HTMLElement, ctx: ViewContext): void {
  const { draft } = ctx;
  const status = h('p', { role: 'status', class: 'field__hint' });
  const grid = h('ul', { class: 'media-grid' });

  const handle = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      status.textContent = `Uploading ${file.name}…`;
      try {
        await upload(file);
        toast(`Uploaded ${file.name}`);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    }
    status.textContent = '';
    await ctx.refresh();
  };

  const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, class: 'visually-hidden', 'aria-label': 'Upload files', onchange: () => input.files && void handle(input.files) });
  const zone = h(
    'div',
    { class: 'dropzone' },
    h('p', {}, 'Drop files here, or ', h('button', { type: 'button', class: 'link', onclick: () => input.click() }, 'choose files')),
    h('p', { class: 'field__hint' }, 'GIF, PNG, JPEG, WebP, MP4 or WebM, up to 25 MiB each.'),
    input,
  );
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('is-over'); if (e.dataTransfer?.files.length) void handle(e.dataTransfer.files); });

  const card = (m: MediaRow): HTMLElement => {
    const usage = usageOf(m.id, draft);
    const alt = textInput(m.default_alt, { 'aria-label': `Default alt text for ${m.original_name ?? m.storage_path}`, placeholder: 'Default alt text' });
    alt.onchange = () => void updateAlt(m.id, alt.value).then(() => toast('Alt text saved'), (e: Error) => toast(e.message, 'error'));
    const replaceInput = h('input', {
      type: 'file',
      accept: ACCEPT,
      class: 'visually-hidden',
      'aria-label': `Replace file for ${m.original_name ?? m.storage_path}`,
      onchange: async () => {
        const file = replaceInput.files?.[0];
        if (!file) return;
        try {
          await replace(m, file);
          toast('File replaced');
          await ctx.refresh();
        } catch (e) {
          toast((e as Error).message, 'error');
        }
      },
    });
    const del = async () => {
      const name = m.original_name ?? m.storage_path;
      if (usage.places.length > 0) {
        alert(`"${name}" is still used in the draft:\n\n- ${usage.places.join('\n- ')}\n\nReplace it in those places, or use "Replace file" to swap the picture everywhere. It cannot be deleted while it is in use.`);
        return;
      }
      let live = false;
      try {
        live = await isLive(m);
      } catch (e) {
        toast((e as Error).message, 'error');
        return;
      }
      const message = live
        ? `Delete "${name}" from the library?

Used by the live site (until the next publish). The library entry is removed, but the file stays online until a publish drops it.`
        : `Delete "${name}" permanently? The draft does not use it, and the live site does not either.`;
      if (!confirm(message)) return;
      try {
        const { keptObject } = await remove(m);
        toast(keptObject ? 'Removed from the library. The file stays online until the next publish.' : 'Deleted');
      } catch (e) {
        toast((e as Error).message, 'error');
      }
      await ctx.refresh();
    };
    return h(
      'li',
      { class: 'media-card' },
      thumb(m),
      h('strong', {}, m.original_name ?? m.storage_path),
      h('p', { class: 'field__hint' }, `${m.kind} · ${m.width ?? '?'}×${m.height ?? '?'} · ${formatBytes(m.bytes)}`),
      h('p', { class: 'field__hint' }, usage.places.length ? `Used in: ${usage.places.join(', ')}` : 'Not used'),
      alt,
      h('p', { class: 'stamp' }, stampText(m, draft)),
      h('div', { class: 'media-card__actions' }, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => replaceInput.click() }, 'Replace file'), replaceInput, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => void del() }, 'Delete')),
    );
  };

  clear(grid);
  if (draft.media.length === 0) grid.appendChild(h('li', { class: 'empty' }, 'The library is empty.'));
  for (const m of draft.media) grid.appendChild(card(m));
  el.append(h('h1', {}, 'Media library'), zone, status, grid);
}
