import type { VNode } from 'preact';
import { featuredWorks } from '../../../lib/render-model';
import { Inline, isEmptyInline } from '../RichText';
import { SectionFrame, titleId } from '../SectionFrame';
import { useRender } from '../context';
import type { SectionOf } from '../types';
import { WorkTile } from '../WorkTile';

/** Variants: `default` (two columns, the v2 look), `large-first` (first work spans the row), `strip` (one scrolling row). */
export function Featured({ section }: { section: SectionOf<'featured'> }): VNode | null {
  const { works, categories } = useRender();
  const picked = featuredWorks(works, section.settings.workIds, section.settings.limit);
  if (picked.length === 0) return null;
  const { heading } = section.content;
  const id = titleId(section);
  const hasHeading = !isEmptyInline(heading);
  return (
    <SectionFrame section={section} class="featured" labelledBy={hasHeading ? id : undefined}>
      <div class="container">
        {hasHeading && (
          <h2 id={id} class="section__title reveal">
            <Inline text={heading} />
          </h2>
        )}
        <ul class="featured__grid" data-tile-group>
          {picked.map((w, i) => (
            <WorkTile key={w.id} work={w} category={categories.find((c) => c.id === w.categoryId)} index={i} sizes="(min-width: 600px) 50vw, 100vw" />
          ))}
        </ul>
      </div>
    </SectionFrame>
  );
}
