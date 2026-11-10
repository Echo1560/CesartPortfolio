/**
 * Rich text renderer (docs/V3-CONTRACTS.md §3.4). Builds elements from the JSON
 * nodes; Preact escapes every `text`. There is no raw-HTML path: never
 * `dangerouslySetInnerHTML`, and every href is re-checked here even though the
 * schema checked it already.
 */
import type { ComponentChildren, VNode } from 'preact';
import { isExternalUrl, safeUrl } from '../../lib/render-model';
import type { InlineNode, InlineText, Mark, RichBlock, RichText } from '../../lib/schema-v3';
import { useRender } from './context';

function wrap(node: InlineNode, base: string, key: number): ComponentChildren {
  if (node.type === 'hardBreak') return <br key={key} />;
  let out: ComponentChildren = node.text;
  for (const mark of (node.marks ?? []) as Mark[]) {
    if (mark.type === 'bold') out = <strong>{out}</strong>;
    else if (mark.type === 'italic') out = <em>{out}</em>;
    else {
      const href = safeUrl(base, mark.attrs.href);
      if (href) out = <a href={href} rel={isExternalUrl(href) ? 'noopener noreferrer' : undefined}>{out}</a>;
    }
  }
  return <>{out}</>;
}

/** One line of formatted text. Renders a fragment, so the caller picks the element. */
export function Inline({ text }: { text: InlineText | undefined }): VNode {
  const { base } = useRender();
  return <>{(text ?? []).map((n, i) => wrap(n, base, i))}</>;
}

/** Plain text of an inline run (labels, alt text, `<title>`). */
export function inlineToPlain(text: InlineText | undefined): string {
  return (text ?? []).map((n) => (n.type === 'text' ? n.text : ' ')).join('');
}

export function isEmptyInline(text: InlineText | undefined): boolean {
  return !text || text.length === 0;
}

function Block({ node }: { node: RichBlock }): VNode {
  switch (node.type) {
    case 'paragraph':
      return <p><Inline text={node.content} /></p>;
    case 'heading': {
      const Tag = `h${node.attrs.level}` as 'h2' | 'h3' | 'h4';
      return <Tag><Inline text={node.content} /></Tag>;
    }
    case 'bulletList':
    case 'orderedList': {
      const Tag = node.type === 'bulletList' ? 'ul' : 'ol';
      return (
        <Tag>
          {node.content.map((item, i) => (
            <li key={i}>
              {item.content.map((p, j) => <Inline key={j} text={p.content} />)}
            </li>
          ))}
        </Tag>
      );
    }
  }
}

export function RichTextView({ doc, class: className = 'prose' }: { doc: RichText | undefined; class?: string }): VNode | null {
  if (!doc || doc.content.length === 0) return null;
  return (
    <div class={className}>
      {doc.content.map((node, i) => <Block key={i} node={node} />)}
    </div>
  );
}
