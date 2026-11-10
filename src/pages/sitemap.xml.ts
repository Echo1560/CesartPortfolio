import type { APIRoute } from 'astro';
import { getSnapshot } from '../lib/content';
import { buildSitemap } from '../lib/sitemap';

export const GET: APIRoute = async ({ site }) => {
  const snapshot = await getSnapshot();
  const origin = new URL(import.meta.env.BASE_URL, site).href;
  return new Response(buildSitemap(snapshot, origin), { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
