import type { VNode } from 'preact';
import { visibilityClasses } from '../../../lib/render-model';
import { ButtonLink, LinkWrap } from '../ButtonLink';
import { MediaView } from '../MediaView';
import { Inline, isEmptyInline, RichTextView } from '../RichText';
import { asBlock, type LooseBlock } from '../types';

export function BlockView({ block }: { block: LooseBlock }): VNode | null {
  const classes = [
    'block',
    `block--${block.type}`,
    block.settings.align && `align-${block.settings.align}`,
    block.settings.marginTop && `mt-${block.settings.marginTop}`,
    block.settings.marginBottom && `mb-${block.settings.marginBottom}`,
    block.settings.width === 'full' && 'block--full',
    ...visibilityClasses(block.visibility),
  ]
    .filter(Boolean)
    .join(' ');
  const body = renderBody(block);
  if (!body) return null;
  return (
    <div class={classes} data-block-id={block.id} data-block-type={block.type}>
      {body}
    </div>
  );
}

function renderBody(block: LooseBlock): VNode | null {
  switch (block.type) {
    case 'heading': {
      const { text, level } = asBlock<'heading'>(block).content;
      if (isEmptyInline(text)) return null;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
      return <Tag class="block__heading"><Inline text={text} /></Tag>;
    }
    case 'paragraph':
      return <RichTextView doc={asBlock<'paragraph'>(block).content.text} />;
    case 'image': {
      const { media, caption, link } = asBlock<'image'>(block).content;
      return (
        <figure class="figure">
          <LinkWrap link={link}>
            <MediaView media={media} mode="detail" sizes="(min-width: 1024px) 50vw, 100vw" />
          </LinkWrap>
          {!isEmptyInline(caption) && <figcaption><Inline text={caption} /></figcaption>}
        </figure>
      );
    }
    case 'button':
      return <p class="block__buttons"><ButtonLink button={asBlock<'button'>(block).content} /></p>;
    case 'divider':
      return <hr class="block__rule" />;
    case 'spacer':
      return <div class={`block__spacer sp-${asBlock<'spacer'>(block).content.size}`} aria-hidden="true" />;
    case 'quote': {
      const { text, attribution } = asBlock<'quote'>(block).content;
      return (
        <blockquote class="quote">
          <p><Inline text={text} /></p>
          {attribution && <footer>— {attribution}</footer>}
        </blockquote>
      );
    }
    case 'video': {
      const { media, autoplay } = asBlock<'video'>(block).content;
      return <MediaView media={media} mode={autoplay ? 'hero' : 'detail'} sizes="(min-width: 1024px) 50vw, 100vw" />;
    }
  }
}

/** The blocks of one column, in order. */
export function BlockList({ blocks, column = 0 }: { blocks: LooseBlock[] | undefined; column?: number }): VNode {
  return (
    <>
      {(blocks ?? [])
        .filter((b) => b.column === column)
        .map((b) => (
          <BlockView key={b.id} block={b} />
        ))}
    </>
  );
}
