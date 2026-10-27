/** Shared admin widgets: media thumbnails, library picker, placement (media) field, reorder buttons. */
import { applyIssues, checkbox, clear, field, formatBytes, h, textArea, textInput, toast, type Field } from './dom';
import { mediaSchema } from '../lib/schema';
import { signedUrls, valueToMedia, type Draft, type MediaKind, type MediaRow, type PlacementValue } from './data';
import { ACCEPT, upload } from './library';

/** A preview of a library file. GIFs animate because they render as a plain <img>. */
export function thumb(row: MediaRow | undefined, draftAlt = ''): HTMLElement {
  const box = h('div', { class: 'thumb' });
  if (!row) {
    box.appendChild(h('span', { class: 'thumb__empty' }, 'No file'));
    return box;
  }
  const kind = row.kind;
  signedUrls([row.storage_path])
    .then((urls) => {
      const src = urls.get(row.storage_path);
      if (!src) return;
      clear(box);
      if (kind === 'video') box.appendChild(h('video', { src, muted: true, preload: 'metadata', 'aria-label': draftAlt || row.original_name || 'video' }));
      else box.appendChild(h('img', { src, alt: draftAlt || row.default_alt || row.original_name || '', loading: 'lazy' }));
    })
    .catch(() => box.appendChild(h('span', { class: 'thumb__empty' }, 'Preview unavailable')));
  return box;
}

/** Small up/down buttons. Keyboard-friendly reordering that works without drag and drop. */
export function moveButtons(index: number, length: number, label: string, onMove: (from: number, to: number) => void): HTMLElement {
  return h(
    'span',
    { class: 'move' },
    h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Move ${label} up`, disabled: index === 0, onclick: () => onMove(index, index - 1) }, '↑'),
    h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Move ${label} down`, disabled: index === length - 1, onclick: () => onMove(index, index + 1) }, '↓'),
  );
}

export function arrayMove<T>(arr: T[], from: number, to: number): void {
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item!);
}

/** Modal library picker. Resolves with the chosen row, or null when cancelled. */
export function pickMedia(draft: Draft, kinds: MediaKind[], onUploaded: (row: MediaRow) => void): Promise<MediaRow | null> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'picker', 'aria-labelledby': 'picker-title' });
    const list = h('ul', { class: 'picker__list' });
    const status = h('p', { class: 'field__hint', role: 'status' });
    let result: MediaRow | null = null;

    const render = () => {
      clear(list);
      const rows = draft.media.filter((m) => kinds.includes(m.kind));
      if (rows.length === 0) list.appendChild(h('li', { class: 'empty' }, 'Nothing here yet. Upload a file.'));
      for (const m of rows) {
        list.appendChild(
          h(
            'li',
            {},
            h(
              'button',
              {
                type: 'button',
                class: 'picker__item',
                onclick: () => {
                  result = m;
                  dialog.close();
                },
              },
              thumb(m),
              h('span', { class: 'picker__name' }, m.original_name ?? m.storage_path),
              h('span', { class: 'field__hint' }, `${m.kind} · ${formatBytes(m.bytes)}`),
            ),
          ),
        );
      }
    };
    const input = h('input', {
      type: 'file',
      accept: ACCEPT,
      class: 'visually-hidden',
      'aria-label': 'Upload a new file',
      onchange: async () => {
        const file = input.files?.[0];
        if (!file) return;
        status.textContent = 'Uploading…';
        try {
          const row = await upload(file);
          if (!kinds.includes(row.kind)) throw new Error(`That file is ${row.kind}; this field needs ${kinds.join(' or ')}. It was added to the library.`);
          draft.media.unshift(row);
          onUploaded(row);
          result = row;
          dialog.close();
        } catch (e) {
          status.textContent = (e as Error).message;
        }
        input.value = '';
      },
    });
    dialog.append(
      h('h2', { id: 'picker-title' }, 'Choose from the media library'),
      h('p', { class: 'field__hint' }, `Allowed here: ${kinds.join(', ')}.`),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => input.click() }, 'Upload new file'), input, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => dialog.close() }, 'Cancel')),
      status,
      list,
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    render();
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

function providerOf(url: string): 'youtube' | 'vimeo' | '' {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') return 'youtube';
    if (host === 'vimeo.com' || host === 'player.vimeo.com') return 'vimeo';
  } catch {
    /* not a URL yet */
  }
  return '';
}

export interface MediaField {
  el: HTMLElement;
  get(): PlacementValue;
  /** Validates against `mediaSchema`. Shows errors and returns false when invalid. */
  validate(): boolean;
  /** Show issues whose paths are relative to this media object (as produced by a parent schema). */
  showIssues(issues: { path: PropertyKey[]; message: string }[]): void;
}

/**
 * Edits one placement: a library file (image, GIF, video) or a YouTube/Vimeo embed.
 * Alt text is required and checked with the same zod schema the build uses.
 */
export function mediaField(draft: Draft, legend: string, initial: PlacementValue, opts: { allowEmbed?: boolean } = {}): MediaField {
  const v: PlacementValue = { ...initial };
  const allowEmbed = opts.allowEmbed ?? true;
  const fields: Record<string, Field> = {};
  const root = h('fieldset', { class: 'media-field' }, h('legend', {}, legend));
  const issuesBox = h('p', { class: 'field__error', role: 'alert', hidden: true });

  const byId = (id: string | null) => draft.media.find((m) => m.id === id);

  const render = () => {
    clear(root);
    root.appendChild(h('legend', {}, legend));
    if (allowEmbed) {
      const src = h('select', { 'aria-label': `${legend}: source` }) as HTMLSelectElement;
      src.append(h('option', { value: 'file', selected: v.type !== 'embed' }, 'File from the library'), h('option', { value: 'embed', selected: v.type === 'embed' }, 'YouTube or Vimeo embed'));
      src.onchange = () => {
        v.type = src.value === 'embed' ? 'embed' : (byId(v.mediaId)?.kind ?? 'image');
        render();
      };
      root.appendChild(h('div', { class: 'field' }, h('label', {}, 'Source'), src));
    }
    if (v.type === 'embed') {
      const url = textInput(v.embedUrl, { type: 'url', placeholder: 'https://www.youtube.com/watch?v=…' });
      url.oninput = () => {
        v.embedUrl = url.value.trim();
        v.provider = providerOf(v.embedUrl);
      };
      fields.src = field('Video page URL', url, 'The page URL on YouTube or Vimeo. It loads only after a visitor clicks play.');
      const w = textInput(v.width ?? 1280, { type: 'number', min: 1 });
      const hh = textInput(v.height ?? 720, { type: 'number', min: 1 });
      v.width ??= 1280;
      v.height ??= 720;
      w.oninput = () => (v.width = Number(w.value) || null);
      hh.oninput = () => (v.height = Number(hh.value) || null);
      fields.width = field('Width (px, sets the aspect ratio)', w);
      fields.height = field('Height (px)', hh);
      root.append(fields.src.el, h('div', { class: 'row' }, fields.width.el, fields.height.el));
    } else {
      const file = byId(v.mediaId);
      fields.src = field('File', h('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': `${legend}: choose file` }, file ? 'Change file' : 'Choose file'));
      const btn = fields.src.control;
      btn.onclick = async () => {
        const row = await pickMedia(draft, ['image', 'animated', 'video'], () => {});
        if (!row) return;
        v.mediaId = row.id;
        v.type = row.kind;
        if (!v.alt.trim()) v.alt = row.default_alt;
        render();
      };
      root.append(h('div', { class: 'media-field__file' }, thumb(file, v.alt), h('div', {}, file ? h('p', {}, file.original_name ?? file.storage_path, h('br'), h('span', { class: 'field__hint' }, `${file.kind} · ${file.width}×${file.height} · ${formatBytes(file.bytes)}`)) : h('p', { class: 'field__hint' }, 'No file chosen'), fields.src.el)));
    }
    if (v.type === 'video' || v.type === 'embed') {
      const poster = byId(v.posterId);
      fields.poster = field(v.type === 'video' ? 'Poster image (required)' : 'Poster image (optional)', h('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': `${legend}: choose poster` }, poster ? 'Change poster' : 'Choose poster'));
      fields.poster.control.onclick = async () => {
        const row = await pickMedia(draft, ['image'], () => {});
        if (row) {
          v.posterId = row.id;
          render();
        }
      };
      root.append(h('div', { class: 'media-field__file' }, thumb(poster, 'poster'), fields.poster.el));
    }
    const alt = textArea(v.alt, 2, { maxlength: 1000 });
    alt.oninput = () => (v.alt = alt.value);
    fields.alt = field('Alt text (required)', alt, 'Describe the image for people who cannot see it.');
    root.appendChild(fields.alt.el);
    if (v.type === 'animated' || v.type === 'video') {
      const loop = checkbox('Loop', v.loop);
      loop.input.onchange = () => (v.loop = loop.input.checked);
      root.appendChild(loop.el);
    }
    root.appendChild(issuesBox);
  };
  render();

  const showIssues = (issues: { path: PropertyKey[]; message: string }[]) => {
    const rest = applyIssues(fields, issues);
    issuesBox.hidden = rest.length === 0;
    issuesBox.textContent = rest.join('; ');
  };

  return {
    el: root,
    get: () => ({ ...v }),
    validate() {
      const parsed = mediaSchema.safeParse(valueToMedia(v, draft.media));
      if (parsed.success) {
        showIssues([]);
        return true;
      }
      showIssues(parsed.error.issues);
      return false;
    },
    showIssues,
  };
}

export function note(message: string): void {
  toast(message);
}
