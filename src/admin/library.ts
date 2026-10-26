/** Media library operations: validation, upload, replace, delete, usage. Rules mirror the storage policy in docs/V2-CONTRACTS.md §4. */
import { explain, sb } from './supabase';
import { forgetUrl, ok, type Draft, type MediaKind, type MediaRow } from './data';

export const MAX_BYTES = 25 * 1024 * 1024;

const TYPES: Record<string, string> = {
  'image/gif': 'gif',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};
const EXT_TO_MIME: Record<string, string> = { gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm' };

export const ACCEPT = Object.keys(TYPES).join(',');

export interface Probe {
  mime: string;
  ext: string;
  kind: MediaKind;
  width: number;
  height: number;
}

/** Throws with a message for the editor when the file would be rejected by the bucket or the database. */
export async function probe(file: File): Promise<Probe> {
  const fileExt = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type || EXT_TO_MIME[fileExt] || '';
  const ext = TYPES[mime];
  if (!ext) throw new Error(`${file.name}: this file type is not allowed. Use GIF, PNG, JPEG, WebP, MP4 or WebM.`);
  if (fileExt && EXT_TO_MIME[fileExt] !== mime) throw new Error(`${file.name}: the file extension does not match its content type (${mime}).`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: too large (${(file.size / 1024 / 1024).toFixed(1)} MiB). The limit is 25 MiB.`);
  if (file.size === 0) throw new Error(`${file.name}: the file is empty.`);
  if (mime.startsWith('video/')) {
    const { width, height } = await videoSize(file, file.name);
    return { mime, ext, kind: 'video', width, height };
  }
  const { width, height } = await imageSize(file, file.name);
  const animated = (mime === 'image/gif' || mime === 'image/webp') && (await isAnimated(file, mime));
  return { mime, ext, kind: animated ? 'animated' : 'image', width, height };
}

async function imageSize(file: File, name: string): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    throw new Error(`${name}: the browser could not read this image. Is it corrupted?`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function videoSize(file: File, name: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = () => URL.revokeObjectURL(url);
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      done();
      resolve({ width: v.videoWidth, height: v.videoHeight });
    };
    v.onerror = () => {
      done();
      reject(new Error(`${name}: the browser could not read this video.`));
    };
    v.src = url;
  });
}

async function isAnimated(file: File, mime: string): Promise<boolean> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (mime === 'image/webp') {
    const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
    return text.includes('ANIM');
  }
  // GIF: more than one Graphic Control Extension (0x21 0xF9 0x04) means more than one frame.
  let frames = 0;
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && ++frames > 1) return true;
  }
  return false;
}

export async function upload(file: File): Promise<MediaRow> {
  const info = await probe(file);
  const path = `uploads/${crypto.randomUUID()}.${info.ext}`;
  const { error: upErr } = await sb().storage.from('media').upload(path, file, { contentType: info.mime, upsert: false });
  if (upErr) throw new Error(`${file.name}: ${explain(upErr)}`);
  const res = await sb()
    .from('media')
    .insert({ storage_path: path, kind: info.kind, mime_type: info.mime, bytes: file.size, width: info.width, height: info.height, original_name: file.name.slice(0, 255) })
    .select('*')
    .single();
  if (res.error) {
    await sb().storage.from('media').remove([path]);
    throw new Error(`${file.name}: ${explain(res.error)}`);
  }
  return res.data as MediaRow;
}

/** Uploads a new object and repoints the row, so the old URL never serves new content. Same kind only. */
export async function replace(row: MediaRow, file: File): Promise<void> {
  const info = await probe(file);
  if (info.kind !== row.kind) throw new Error(`The new file is ${info.kind}, but this item is ${row.kind}. Upload it as a new item instead.`);
  const path = `uploads/${crypto.randomUUID()}.${info.ext}`;
  const { error: upErr } = await sb().storage.from('media').upload(path, file, { contentType: info.mime, upsert: false });
  if (upErr) throw new Error(explain(upErr));
  const res = await sb()
    .from('media')
    .update({ storage_path: path, mime_type: info.mime, bytes: file.size, width: info.width, height: info.height, original_name: file.name.slice(0, 255) })
    .eq('id', row.id)
    .select('id');
  if (res.error) {
    await sb().storage.from('media').remove([path]);
    throw new Error(explain(res.error));
  }
  // The old object may still be in the live snapshot: its public read is governed by publish_runs.media_paths, so removing it is the editor's call after publishing.
  forgetUrl(row.storage_path);
}

export interface Usage {
  places: string[];
}

/** Everywhere a library file is used by the draft. */
export function usageOf(id: string, draft: Draft): Usage {
  const places: string[] = [];
  const label = (slot: string, workId: string | null) => {
    const work = workId ? draft.works.find((w) => w.id === workId)?.title : null;
    return slot === 'hero' ? 'Hero' : slot === 'about_portrait' ? 'About portrait' : slot === 'work_cover' ? `Cover of "${work}"` : `Gallery of "${work}"`;
  };
  for (const p of draft.placements) {
    if (p.media_id === id) places.push(label(p.slot, p.work_id));
    else if (p.poster_media_id === id) places.push(`${label(p.slot, p.work_id)} (poster)`);
  }
  if (draft.site.og_media_id === id) places.push('Social share image');
  return { places };
}

export async function remove(row: MediaRow): Promise<void> {
  // Row first: it cannot be deleted while in use, and the object must outlive a failed delete.
  ok(await sb().from('media').delete().eq('id', row.id).select('id'));
  const { error } = await sb().storage.from('media').remove([row.storage_path]);
  if (error) throw new Error(`The item was removed, but its file could not be deleted: ${explain(error)}`);
  forgetUrl(row.storage_path);
}

export async function updateAlt(id: string, alt: string): Promise<void> {
  ok(await sb().from('media').update({ default_alt: alt }).eq('id', id).select('id'));
}
