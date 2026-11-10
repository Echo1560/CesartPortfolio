import type { VNode } from 'preact';
import { LinkWrap } from '../ButtonLink';
import { MediaView } from '../MediaView';
import { Inline, isEmptyInline } from '../RichText';
import { SectionFrame } from '../SectionFrame';
import type { SectionOf } from '../types';

/**
 * Variants: `default` (contained), `full-bleed` (edge to edge), `caption-side`.
 * `settings.lightbox` is reserved for the work lightbox and has no effect on a plain image.
 */
export function Image({ section }: { section: SectionOf<'image'> }): VNode {
  const { media, caption, link } = section.content;
  const aspect = section.settings.aspect && section.settings.aspect !== 'original' ? `image--${section.settings.aspect}` : '';
  const hasCaption = !isEmptyInline(caption);
  const sizes = section.variant === 'full-bleed' ? '100vw' : '(min-width: 1024px) 70vw, 100vw';
  return (
    <SectionFrame section={section}>
      <figure class={`${section.variant === 'full-bleed' ? 'image__full' : 'container'} image__figure reveal ${aspect}`.trim()}>
        <div class="image__media">
          <LinkWrap link={link}>
            <MediaView media={media} mode="detail" sizes={sizes} />
          </LinkWrap>
        </div>
        {hasCaption && <figcaption class="image__caption"><Inline text={caption} /></figcaption>}
      </figure>
    </SectionFrame>
  );
}
