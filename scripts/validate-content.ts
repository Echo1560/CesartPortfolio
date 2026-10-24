/**
 * `npm run validate:content`: checks content/site.json, content/works.json and
 * the files they reference in content/media/. Exits 1 with a list of problems.
 * Also runs before every `npm run build`.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ContentError, validateContent } from '../src/lib/validate.ts';

const root = process.cwd();
const contentDir = join(root, 'content');
const mediaDir = join(contentDir, 'media');

function readJson(file: string): unknown {
  const path = join(contentDir, file);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`✗ content/${file} could not be read as JSON: ${reason}`);
    process.exit(1);
  }
}

const mediaExists = (path: string) => {
  const full = join(mediaDir, path);
  return existsSync(full) && statSync(full).isFile();
};

try {
  const { site, works } = validateContent(readJson('site.json'), readJson('works.json'), mediaExists);
  const placeholders = works.filter((w) => w.placeholder).length;
  console.log(
    `✓ content is valid: ${works.length} works, ${site.categories.length} categories` +
      (placeholders ? ` (${placeholders} marked placeholder)` : ''),
  );
} catch (error) {
  if (error instanceof ContentError) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
  throw error;
}
