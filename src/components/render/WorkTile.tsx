import type { VNode } from 'preact';
import type { Category, Work } from '../../lib/schema';
import { workHref } from '../../lib/render-model';
import { MediaView } from './MediaView';
import { useRender } from './context';

interface Props {
  work: Work;
  category?: Category;
  index?: number;
  sizes?: string;
}

export function WorkTile({ work, category, index = 0, sizes }: Props): VNode {
  const { base } = useRender();
  return (
    <li class="tile reveal" style={`--i: ${index % 6}`} data-tile data-slug={work.slug} data-category={category?.slug ?? work.categoryId}>
      <a class="tile__link" href={workHref(base, work.slug)} aria-label={`${work.title}${work.year ? `, ${work.year}` : ''}`}>
        <MediaView media={work.media} mode="tile" sizes={sizes} />
        <span class="tile__caption" aria-hidden="true">
          <span class="tile__title">{work.title}</span>
          <span class="tile__meta">{[category?.label, work.year].filter(Boolean).join(' · ')}</span>
        </span>
      </a>
    </li>
  );
}
