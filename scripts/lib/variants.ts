/**
 * Build-time video variants for animated media (docs/V2-CONTRACTS.md §4).
 *
 * Each animated GIF / WebP becomes a muted, looping WebM (VP9) and MP4 (H.264,
 * yuv420p, +faststart), plus a first-frame JPEG poster. Outputs are cached by a
 * hash of the source bytes and the encoder settings, so a rebuild only encodes
 * new or changed files. Naming lives in `src/lib/media-variants.ts`.
 *
 * GIFs are decoded by ffmpeg itself (it handles frame disposal and per-frame
 * delays). ffmpeg cannot decode animated WebP, so those frames come from sharp
 * and are piped in as raw video. Transparent pixels are flattened onto the
 * light page background, because H.264 has no alpha channel.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { variantKeys } from '../../src/lib/media-variants.ts';

/** Bump when the encoder settings change, so cached outputs are rebuilt. */
export const PIPELINE_VERSION = 1;

/** `--color-bg` (light theme) from src/styles/tokens.css. */
const BACKGROUND = { hex: '0xf6f5f2', rgb: { r: 0xf6, g: 0xf5, b: 0xf2 } };

/** Frame rate cap for animated WebP input (GIF timing is passed through as is). */
const MAX_FPS = 50;

const MP4_ARGS = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart', '-an'];
const WEBM_ARGS = ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', '34', '-b:v', '0', '-row-mt', '1', '-an'];

// Flatten alpha onto the background, force even dimensions (yuv420p needs them), then feed both encoders.
const FILTER =
  `[0:v]format=rgba,split[ref][fg];[ref]drawbox=x=0:y=0:w=iw:h=ih:color=${BACKGROUND.hex}@1:t=fill[bg];` +
  '[bg][fg]overlay=format=auto:shortest=1,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p,split=2[mp4][webm]';

export class VariantError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VariantError';
  }
}

/** ffmpeg binary: `ffmpeg-static` (a dev dependency), else `ffmpeg` on PATH. Undefined when neither runs. */
export function findFfmpeg(): string | undefined {
  const candidates: string[] = [];
  try {
    const bundled = createRequire(import.meta.url)('ffmpeg-static') as string | null;
    if (bundled) candidates.push(bundled);
  } catch {
    // not installed
  }
  candidates.push('ffmpeg');
  return candidates.find((bin) => spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0);
}

/** Cache key: pipeline version + source bytes. */
export function variantHash(bytes: Buffer): string {
  return createHash('sha256').update(`v${PIPELINE_VERSION}\0`).update(bytes).digest('hex');
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile() && s.size > 0,
    () => false,
  );
}

function runFfmpeg(ffmpeg: string, args: string[], stdin?: Buffer): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolvePromise() : reject(new VariantError(`ffmpeg exited with ${code}: ${stderr.trim().slice(-800)}`))));
    if (stdin && child.stdin) {
      child.stdin.on('error', () => {}); // ffmpeg may close early on bad input; the exit code reports it
      child.stdin.end(stdin);
    }
  });
}

/** Browsers show GIF/WebP frames of 0–10 ms as 100 ms; do the same. */
function frameDelay(ms: number | undefined): number {
  return ms === undefined || ms <= 10 ? 100 : ms;
}

/** Animated WebP → raw RGBA frames at a constant rate, each frame repeated to match its delay. */
async function webpAsRawVideo(bytes: Buffer): Promise<{ input: string[]; stdin: Buffer }> {
  const { data, info } = await sharp(bytes, { animated: true, limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const meta = await sharp(bytes, { animated: true }).metadata();
  const pages = meta.pages ?? 1;
  const width = info.width;
  const height = meta.pageHeight ?? info.height / pages;
  const frameBytes = width * height * 4;
  const delays = Array.from({ length: pages }, (_, i) => frameDelay(meta.delay?.[i]));
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const fps = Math.min(MAX_FPS, 1000 / delays.reduce(gcd));
  const frames: Buffer[] = [];
  delays.forEach((delay, i) => {
    const frame = data.subarray(i * frameBytes, (i + 1) * frameBytes);
    for (let n = Math.max(1, Math.round((delay * fps) / 1000)); n > 0; n--) frames.push(frame);
  });
  return {
    input: ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0'],
    stdin: Buffer.concat(frames),
  };
}

async function encode(ffmpeg: string, source: string, bytes: Buffer, outDir: string): Promise<void> {
  const isWebp = source.toLowerCase().endsWith('.webp');
  const { input, stdin } = isWebp ? await webpAsRawVideo(bytes) : { input: ['-i', source], stdin: undefined };
  await runFfmpeg(
    ffmpeg,
    [...input, '-filter_complex', FILTER, '-map', '[mp4]', ...MP4_ARGS, join(outDir, 'video.mp4'), '-map', '[webm]', ...WEBM_ARGS, join(outDir, 'video.webm')],
    stdin,
  );
  await sharp(bytes, { page: 0 }).flatten({ background: BACKGROUND.rgb }).jpeg({ quality: 90, mozjpeg: true }).toFile(join(outDir, 'poster.jpg'));
}

export interface VariantOptions {
  ffmpeg: string;
  /** Hash-keyed cache, for example `node_modules/.cache/cesart-media-variants`. */
  cacheDir: string;
}

export interface VariantResult {
  hash: string;
  cached: boolean;
  /** Absolute paths of the three outputs under `variantsDir`. */
  files: { webm: string; mp4: string; poster: string };
}

/**
 * Generates (or reuses from the cache) the variants of `mediaRoot/<key>` and
 * copies them to `variantsDir/<key>.{webm,mp4,poster.jpg}`.
 */
export async function generateVariants(mediaRoot: string, key: string, variantsDir: string, options: VariantOptions): Promise<VariantResult> {
  const source = join(mediaRoot, key);
  const bytes = await readFile(source);
  const hash = variantHash(bytes);
  const entry = join(options.cacheDir, hash);
  const cachedFiles = { webm: join(entry, 'video.webm'), mp4: join(entry, 'video.mp4'), poster: join(entry, 'poster.jpg') };

  const cached = (await Promise.all(Object.values(cachedFiles).map(exists))).every(Boolean);
  if (!cached) {
    const work = `${entry}.tmp-${process.pid}`;
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    try {
      await encode(options.ffmpeg, source, bytes, work);
      await rm(entry, { recursive: true, force: true });
      await rename(work, entry);
    } catch (error) {
      await rm(work, { recursive: true, force: true });
      throw new VariantError(`Could not convert ${key}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  const keys = variantKeys(key);
  const files = { webm: join(variantsDir, keys.webm), mp4: join(variantsDir, keys.mp4), poster: join(variantsDir, keys.poster) };
  await mkdir(dirname(files.webm), { recursive: true });
  await Promise.all([copyFile(cachedFiles.webm, files.webm), copyFile(cachedFiles.mp4, files.mp4), copyFile(cachedFiles.poster, files.poster)]);
  return { hash, cached, files };
}
