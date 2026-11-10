import type { VNode } from 'preact';
import { MediaView } from '../MediaView';
import { Inline, isEmptyInline } from '../RichText';
import { ButtonLink } from '../ButtonLink';
import { SectionFrame, titleId } from '../SectionFrame';
import type { SectionOf } from '../types';

/**
 * Variants: `default` (media, then text; the v2 hero), `overlay` (text over the
 * media), `split` (media and text side by side), `text-only`.
 */
export function Hero({ section }: { section: SectionOf<'hero'> }): VNode {
  const { heading, subheading, media, buttons } = section.content;
  const s = section.settings;
  const id = titleId(section);
  const hasHeading = !isEmptyInline(heading);
  const showMedia = media && section.variant !== 'text-only';
  const height = s.height ? `hero--h-${s.height}` : '';
  const side = section.variant === 'split' && s.mediaSide === 'right' ? 'hero--media-right' : '';
  return (
    <SectionFrame section={section} padded={false} class={`hero hero--${section.variant} ${height} ${side}`.trim()} labelledBy={hasHeading ? id : undefined}>
      {showMedia && (
        <div class="hero__media">
          <MediaView media={media} mode="hero" eager sizes={section.variant === 'split' ? '(min-width: 800px) 50vw, 100vw' : '100vw'} />
        </div>
      )}
      <div class="container hero__text reveal">
        {hasHeading && <h1 id={id} class="hero__title"><Inline text={heading} /></h1>}
        {!isEmptyInline(subheading) && <p class="hero__sub"><Inline text={subheading} /></p>}
        {buttons && buttons.length > 0 && (
          <p class="hero__buttons">
            {buttons.map((b, i) => <ButtonLink key={i} button={b} trackSource="hero" />)}
          </p>
        )}
      </div>
    </SectionFrame>
  );
}
