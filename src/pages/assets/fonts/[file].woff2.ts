import type { APIRoute, GetStaticPaths } from 'astro';
import { getSnapshot } from '../../../lib/content';
import { fontRouteFiles, parseFontFile, readFontFile } from '../../../lib/fonts';

// Only the font files the active theme uses are emitted.
export const getStaticPaths = (async () => {
  const { theme } = await getSnapshot();
  return fontRouteFiles(theme.tokens).map((file) => ({ params: { file } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) => {
  const parsed = parseFontFile(params.file ?? '');
  if (!parsed) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(readFontFile(parsed.font, parsed.weight)), { headers: { 'content-type': 'font/woff2' } });
};
