// Minimal static server for a built site: node serve-static.mjs <dir> <port>.
// Serves <dir> under /CesartPortfolio/ like GitHub Pages. Used instead of `astro preview`,
// which allows only one instance per checkout.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const [dir, port] = [resolve(process.argv[2]), Number(process.argv[3])];
const BASE = '/CesartPortfolio/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(BASE)) return res.writeHead(404).end();
  let file = normalize(join(dir, path.slice(BASE.length)));
  if (!file.startsWith(dir)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port);
