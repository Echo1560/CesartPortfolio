import { pageHref, publishedPages, workHref } from './render-model';
import type { SnapshotV3 } from './schema-v3';

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/**
 * sitemap.xml for the published pages and the work detail pages. Draft and
 * hidden pages are not in the snapshot, so they cannot appear. `origin` is the
 * site origin plus base, ending in `/` (`https://echo1560.github.io/CesartPortfolio/`).
 */
export function buildSitemap(snapshot: Pick<SnapshotV3, 'pages' | 'works'>, origin: string): string {
  const base = '/';
  const rel = (href: string) => href.slice(1);
  const urls = [
    ...publishedPages(snapshot).map((p) => rel(pageHref(base, p))),
    ...snapshot.works.map((w) => rel(workHref(base, w.slug))),
  ].map((path) => `  <url><loc>${escapeXml(new URL(path, origin).href)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
