import type { VNode } from 'preact';
import { selectWorks } from '../../../lib/render-model';
import { Inline, isEmptyInline } from '../RichText';
import { SectionFrame, titleId } from '../SectionFrame';
import { useRender } from '../context';
import type { SectionOf } from '../types';
import { WorkTile } from '../WorkTile';

/** Variants: `default` (the v2 masonry grid), `grid` (uniform cells). Filter chips and the lightbox are progressive enhancement (`scripts/`). */
export function Gallery({ section }: { section: SectionOf<'gallery'> }): VNode {
  const { works, categories } = useRender();
  const s = section.settings;
  const { heading, emptyText } = section.content;
  const picked = selectWorks(works, categories, s.source, s.sort, s.limit);
  const present = new Set(picked.map((w) => w.categoryId));
  const chips = categories.filter((c) => present.has(c.id));
  const id = titleId(section);
  const hasHeading = !isEmptyInline(heading);
  const cols = s.columns;
  const masonry = section.variant === 'default';
  return (
    <SectionFrame section={section} class="grid-section" labelledBy={hasHeading ? id : undefined}>
      <div class="container">
        {hasHeading && (
          <h2 id={id} class="section__title reveal">
            <Inline text={heading} />
          </h2>
        )}
        {s.showFilters && chips.length > 0 && (
          <div class="filters reveal" role="group" aria-label="Filter work by category" data-filters>
            <button type="button" class="chip" data-filter="all" aria-pressed="true">
              All
            </button>
            {chips.map((c) => (
              <button key={c.id} type="button" class="chip" data-filter={c.slug} aria-pressed="false">
                {c.label}
              </button>
            ))}
          </div>
        )}
        <p class="visually-hidden" role="status" aria-live="polite" data-filter-status></p>
        <ul
          class={`work-grid${masonry ? ' work-grid--masonry' : ''}`}
          style={`--cols-sm: ${cols.sm}; --cols-md: ${cols.md}; --cols-lg: ${cols.lg}`}
          data-tile-group
          data-work-grid
        >
          {picked.map((w, i) => (
            <WorkTile key={w.id} work={w} category={categories.find((c) => c.id === w.categoryId)} index={i} />
          ))}
        </ul>
        <p class="empty" data-empty hidden={picked.length > 0}>
          {isEmptyInline(emptyText) ? 'No work in this category yet.' : <Inline text={emptyText} />}
        </p>
      </div>
    </SectionFrame>
  );
}
