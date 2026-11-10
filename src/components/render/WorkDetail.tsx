import type { VNode } from 'preact';
import type { Category, Work } from '../../lib/schema';
import { MediaView } from './MediaView';

interface Props {
  work: Work;
  category?: Category;
  /** `page` renders the main heading as h1; `lightbox` uses h2. */
  variant?: 'page' | 'lightbox';
}

export function WorkDetail({ work, category, variant = 'page' }: Props): VNode {
  const Heading = variant === 'page' ? 'h1' : 'h2';
  return (
    <article class="detail" data-work-slug={work.slug}>
      <div class="detail__media">
        <MediaView media={work.media} mode="detail" eager={variant === 'page'} sizes="(min-width: 1024px) 60vw, 100vw" />
      </div>
      <div class="detail__info">
        <Heading class="detail__title" id={variant === 'lightbox' ? 'lightbox-title' : undefined} tabIndex={variant === 'lightbox' ? -1 : undefined}>
          {work.title}
        </Heading>
        <p class="eyebrow">{[category?.label, work.year].filter(Boolean).join(' · ')}</p>
        {work.description && <p class="detail__desc">{work.description}</p>}
        {work.tags.length > 0 && (
          <ul class="detail__tags" aria-label="Tags">
            {work.tags.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </div>
      {work.gallery && work.gallery.length > 0 && (
        <div class="detail__gallery">
          {work.gallery.map((m) => (
            <MediaView key={m.src} media={m} mode="detail" sizes="(min-width: 1024px) 60vw, 100vw" />
          ))}
        </div>
      )}
    </article>
  );
}
