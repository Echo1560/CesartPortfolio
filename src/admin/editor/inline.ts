/**
 * Inline text editing: which element of the rendered page edits which field, and the
 * conversion between the edited DOM and the contract's rich-text JSON (V3-CONTRACTS §3.4).
 * Text goes in as JSON nodes only: the DOM is read, never kept, so no HTML is ever stored.
 */
import { SAFE_HREF, type InlineNode, type InlineText, type Mark, type RichBlock, type RichText } from '../../lib/schema-v3';

export type FieldKind = 'inline' | 'rich';

export interface FieldBinding {
  el: HTMLElement;
  kind: FieldKind;
  sectionId: string;
  blockId?: string;
  /** Key in `content` that holds the value. */
  key: string;
  label: string;
}

interface Spec {
  selector: string;
  key: string;
  kind: FieldKind;
  label: string;
}

const SECTION_FIELDS: Record<string, Spec[]> = {
  hero: [
    { selector: '.hero__title', key: 'heading', kind: 'inline', label: 'Heading' },
    { selector: '.hero__sub', key: 'subheading', kind: 'inline', label: 'Subheading' },
  ],
  about: [
    { selector: '.section__title', key: 'heading', kind: 'inline', label: 'Heading' },
    { selector: '.prose', key: 'body', kind: 'rich', label: 'Text' },
  ],
  contact: [
    { selector: '.section__title', key: 'heading', kind: 'inline', label: 'Heading' },
    { selector: '.prose', key: 'body', kind: 'rich', label: 'Text' },
  ],
  cta: [
    { selector: '.cta-band__heading', key: 'heading', kind: 'inline', label: 'Heading' },
    { selector: '.cta-band__text .prose', key: 'body', kind: 'rich', label: 'Text' },
  ],
  gallery: [{ selector: '.section__title', key: 'heading', kind: 'inline', label: 'Heading' }],
  featured: [{ selector: '.section__title', key: 'heading', kind: 'inline', label: 'Heading' }],
  'works-list': [{ selector: '.section__title', key: 'heading', kind: 'inline', label: 'Heading' }],
  image: [{ selector: '.image__caption', key: 'caption', kind: 'inline', label: 'Caption' }],
};

const BLOCK_FIELDS: Record<string, Spec[]> = {
  heading: [{ selector: '.block__heading', key: 'text', kind: 'inline', label: 'Heading' }],
  paragraph: [{ selector: '.prose', key: 'text', kind: 'rich', label: 'Text' }],
  image: [{ selector: 'figcaption', key: 'caption', kind: 'inline', label: 'Caption' }],
  quote: [{ selector: 'blockquote p', key: 'text', kind: 'inline', label: 'Quote' }],
};

/** Finds the editable elements inside the rendered page. Section-level fields skip anything inside a block. */
export function findFields(root: ParentNode): FieldBinding[] {
  const out: FieldBinding[] = [];
  for (const section of root.querySelectorAll<HTMLElement>('[data-section-id]')) {
    const sectionId = section.dataset['sectionId']!;
    for (const spec of SECTION_FIELDS[section.dataset['sectionType']!] ?? []) {
      const el = [...section.querySelectorAll<HTMLElement>(spec.selector)].find((e) => !e.closest('[data-block-id]'));
      if (el) out.push({ el, kind: spec.kind, sectionId, key: spec.key, label: spec.label });
    }
    for (const block of section.querySelectorAll<HTMLElement>('[data-block-id]')) {
      for (const spec of BLOCK_FIELDS[block.dataset['blockType']!] ?? []) {
        const el = block.querySelector<HTMLElement>(spec.selector);
        if (el) out.push({ el, kind: spec.kind, sectionId, blockId: block.dataset['blockId']!, key: spec.key, label: spec.label });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DOM -> JSON
// ---------------------------------------------------------------------------

type MarkKey = 'bold' | 'italic' | `link:${string}`;

function hrefOf(a: HTMLAnchorElement, base: string): string | undefined {
  let href = a.getAttribute('href') ?? '';
  // The renderer prefixes the site base to site paths; the stored value has none.
  if (base !== '/' && href.startsWith(base)) href = `/${href.slice(base.length)}`;
  return SAFE_HREF.test(href) ? href : undefined;
}

function walk(node: Node, marks: MarkKey[], out: { text?: string; marks: MarkKey[]; br?: boolean }[], base: string): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/ /g, ' ').replace(/[\r\n]+/g, ' ');
    if (text) out.push({ text, marks });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return; // not `instanceof`: the page lives in another window
  const el = node as HTMLElement;
  const tag = el.tagName;
  if (tag === 'BR') {
    out.push({ br: true, marks: [] });
    return;
  }
  let next = marks;
  if (tag === 'STRONG' || tag === 'B') next = [...marks, 'bold'];
  else if (tag === 'EM' || tag === 'I') next = [...marks, 'italic'];
  else if (tag === 'A') {
    const href = hrefOf(el as HTMLAnchorElement, base);
    if (href) next = [...marks, `link:${href}`];
  } else if (el.style.fontWeight === 'bold' || Number(el.style.fontWeight) >= 600) next = [...marks, 'bold'];
  else if (el.style.fontStyle === 'italic') next = [...marks, 'italic'];
  for (const child of node.childNodes) walk(child, next, out, base);
}

function toMarks(keys: MarkKey[]): Mark[] {
  const marks: Mark[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k.startsWith('link:') ? 'link' : k)) continue;
    seen.add(k.startsWith('link:') ? 'link' : k);
    marks.push(k === 'bold' ? { type: 'bold' } : k === 'italic' ? { type: 'italic' } : { type: 'link', attrs: { href: k.slice(5) } });
  }
  return marks;
}

/** Inline nodes of the children of `parent`. Adjacent runs with the same marks are merged. */
export function inlineOf(parent: Node, base: string): InlineText {
  const runs: { text?: string; marks: MarkKey[]; br?: boolean }[] = [];
  for (const child of parent.childNodes) walk(child, [], runs, base);
  const out: InlineNode[] = [];
  for (const r of runs) {
    if (r.br) {
      if (out.length > 0 && out[out.length - 1]!.type !== 'hardBreak') out.push({ type: 'hardBreak' });
      continue;
    }
    const marks = toMarks(r.marks);
    const last = out[out.length - 1];
    if (last && last.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(marks) && last.text.length + r.text!.length <= 5000) last.text += r.text!;
    else out.push({ type: 'text', text: r.text!.slice(0, 5000), ...(marks.length ? { marks } : {}) });
  }
  while (out.length > 0 && out[out.length - 1]!.type === 'hardBreak') out.pop();
  return out;
}

function paragraphOf(el: Node, base: string) {
  const content = inlineOf(el, base);
  return content.length > 0 ? { type: 'paragraph' as const, content } : { type: 'paragraph' as const };
}

/** Block structure of an edited rich-text container: paragraphs, h2-h4 and lists. */
export function richOf(root: HTMLElement, base: string): RichText {
  const content: RichBlock[] = [];
  let loose: Node[] = [];
  const flush = () => {
    if (loose.length === 0) return;
    const holder = document.createElement('p');
    for (const n of loose) holder.appendChild(n.cloneNode(true));
    const p = paragraphOf(holder, base);
    if (p.content) content.push(p);
    loose = [];
  };
  for (const child of root.childNodes) {
    const tag = child.nodeType === Node.ELEMENT_NODE ? (child as HTMLElement).tagName : '';
    if (/^H[1-6]$/.test(tag)) {
      flush();
      const level = Math.min(4, Math.max(2, Number(tag[1]))) as 2 | 3 | 4;
      const inline = inlineOf(child, base);
      if (inline.length) content.push({ type: 'heading', attrs: { level }, content: inline });
    } else if (tag === 'P' || tag === 'DIV') {
      flush();
      const p = paragraphOf(child, base);
      if (p.content) content.push(p);
    } else if (tag === 'UL' || tag === 'OL') {
      flush();
      const items = [...(child as HTMLElement).children]
        .filter((li) => li.tagName === 'LI')
        .map((li) => ({ type: 'listItem' as const, content: [paragraphOf(li, base)] }))
        .filter((li) => li.content[0]!.content);
      if (items.length) content.push({ type: tag === 'UL' ? 'bulletList' : 'orderedList', content: items });
    } else loose.push(child);
  }
  flush();
  return { type: 'doc', content };
}
