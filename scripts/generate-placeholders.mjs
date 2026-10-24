/**
 * Regenerates the neutral placeholder media in content/media/placeholder/.
 * Only needed if the placeholders change; the generated files are committed.
 *
 *   node scripts/generate-placeholders.mjs
 *
 * Stills and the animated WebP need only `sharp` (already a dependency). The
 * MP4 files need an ffmpeg binary: install it temporarily with
 * `npm install --no-save ffmpeg-static`, or put `ffmpeg` on your PATH.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const OUT = join(process.cwd(), 'content', 'media', 'placeholder');
mkdirSync(OUT, { recursive: true });

// Neutral, low-contrast tones so the placeholders never read as finished art.
const TONES = ['#d9d6d0', '#cfd3d6', '#d6d1cb', '#c9ccc8', '#dcd8d2', '#ced0d4'];

function svgStill(width, height, label, tone) {
  const min = Math.min(width, height);
  const font = Math.round(min * 0.06);
  const small = Math.round(font * 0.55);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${tone}"/>
      <stop offset="1" stop-color="#b9b8b4"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect x="${min * 0.04}" y="${min * 0.04}" width="${width - min * 0.08}" height="${height - min * 0.08}" fill="none" stroke="#8f8e8a" stroke-width="${Math.max(2, min * 0.004)}" stroke-dasharray="${min * 0.02} ${min * 0.015}"/>
  <circle cx="${width * 0.5}" cy="${height * 0.42}" r="${min * 0.12}" fill="none" stroke="#8f8e8a" stroke-width="${Math.max(2, min * 0.006)}"/>
  <path d="M ${width * 0.3} ${height * 0.62} L ${width * 0.45} ${height * 0.5} L ${width * 0.55} ${height * 0.58} L ${width * 0.62} ${height * 0.53} L ${width * 0.7} ${height * 0.62} Z" fill="#a9a8a4"/>
  <text x="50%" y="${height * 0.76}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${font}" fill="#5f5e5a">${label}</text>
  <text x="50%" y="${height * 0.76 + font * 1.2}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${small}" fill="#7a7975">PLACEHOLDER · ${width}×${height}</text>
</svg>`;
}

function svgFrame(width, height, t, label) {
  const min = Math.min(width, height);
  const angle = t * Math.PI * 2;
  const cx = width / 2 + Math.cos(angle) * width * 0.25;
  const cy = height / 2 + Math.sin(angle) * height * 0.2;
  const r = min * (0.1 + 0.03 * Math.sin(angle * 2));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#d6d4cf"/>
  <ellipse cx="${width / 2}" cy="${height / 2}" rx="${width * 0.25}" ry="${height * 0.2}" fill="none" stroke="#b3b2ae" stroke-width="2" stroke-dasharray="6 6"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#8f8e8a"/>
  <text x="50%" y="${height * 0.92}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(min * 0.05)}" fill="#5f5e5a">${label}</text>
</svg>`;
}

async function still(name, width, height, label, i) {
  const svg = Buffer.from(svgStill(width, height, label, TONES[i % TONES.length]));
  await sharp(svg).jpeg({ quality: 78, mozjpeg: true }).toFile(join(OUT, `${name}.jpg`));
  console.log(`  ${name}.jpg ${width}×${height}`);
}

async function frames(width, height, count, label) {
  return Promise.all(
    Array.from({ length: count }, (_, f) => sharp(Buffer.from(svgFrame(width, height, f / count, label))).png().toBuffer()),
  );
}

async function animatedWebp(name, width, height, count, label) {
  const pngs = await frames(width, height, count, label);
  await sharp(pngs, { join: { animated: true } })
    .webp({ quality: 70, loop: 0, delay: Array(count).fill(83) })
    .toFile(join(OUT, `${name}.webp`));
  await sharp(pngs[0]).jpeg({ quality: 80 }).toFile(join(OUT, `${name}-poster.jpg`));
  console.log(`  ${name}.webp + poster ${width}×${height}`);
}

function findFfmpeg() {
  try {
    return createRequire(import.meta.url)('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

async function video(name, width, height, count, fps, label) {
  const dir = mkdtempSync(join(tmpdir(), 'cesart-frames-'));
  try {
    const pngs = await frames(width, height, count, label);
    pngs.forEach((buf, f) => writeFileSync(join(dir, `f${String(f).padStart(4, '0')}.png`), buf));
    execFileSync(findFfmpeg(), [
      '-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'f%04d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', '-an',
      join(OUT, `${name}.mp4`),
    ]);
    await sharp(pngs[0]).jpeg({ quality: 80 }).toFile(join(OUT, `${name}-poster.jpg`));
    console.log(`  ${name}.mp4 + poster ${width}×${height}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const STILLS = [
  ['illustration-01', 1600, 2000, 'Illustration 01'],
  ['illustration-02', 2400, 1600, 'Illustration 02'],
  ['illustration-03', 1800, 1800, 'Illustration 03'],
  ['illustration-04', 1400, 2100, 'Illustration 04'],
  ['illustration-05', 2400, 1350, 'Illustration 05'],
  ['illustration-06', 1500, 2000, 'Illustration 06'],
  ['illustration-06-detail-a', 1600, 1600, 'Detail A'],
  ['illustration-06-detail-b', 2000, 1500, 'Detail B'],
  ['illustration-07', 2000, 1600, 'Illustration 07'],
  ['animation-03', 2000, 1500, 'Storyboard frame'],
  ['animation-04', 1080, 1920, 'Character turnaround'],
  ['portrait', 1200, 1500, 'Portrait'],
  ['og-image', 1200, 630, 'Cesart · Placeholder'],
];

console.log(`Writing placeholders to ${OUT}`);
for (const [i, [name, w, h, label]] of STILLS.entries()) await still(name, w, h, label, i);
await animatedWebp('animation-01', 480, 480, 24, 'Loop placeholder');
await video('animation-02', 960, 540, 48, 24, 'Video placeholder');
await video('hero-reel', 1280, 720, 72, 24, 'Reel placeholder');
