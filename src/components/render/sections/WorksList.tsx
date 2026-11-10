import type { VNode } from 'preact';
import { selectWorks, workHref } from '../../../lib/render-model';
import { MediaView } from '../MediaView';
import { Inline, isEmptyInline } from '../RichText';
import { SectionFrame, titleId } from '../SectionFrame';
import { useRender } from '../context';
import type { SectionOf } from '../types';

/** Variants: `default` (rows), `compact` (one line each), `cards`. Items link to the work page (no lightbox). */
export function WorksList({ section }: { section: SectionOf<'works-list'> }): VNode {
  const { works, categories, base } = useRender();
  const s = section.settings;
  const picked = selectWorks(works, categories, s.source, s.sort, s.limit);
  const { heading } = section.content;
  const id = titleId(section);
  const hasHeading = !isEmptyInline(heading);
  return (
    <SectionFrame section={section} class="works-list" labelledBy={hasHeading ? id : undefined}>
      <div class="container">
        {hasHeading && (
          <h2 id={id} class="section__title reveal">
            <Inline text={heading} />
          </h2>
        )}
        <ul class="works-list__items">
          {picked.map((w) => {
            const category = categories.find((c) => c.id === w.categoryId);
            return (
              <li key={w.id} class="works-list__item reveal">
                <a class="works-list__link" href={workHref(base, w.slug)}>
                  {s.showThumbnail && (
                    <span class="works-list__thumb" aria-hidden="true">
                      <MediaView media={w.media} mode="tile" sizes="12rem" />
                    </span>
                  )}
                  <span class="works-list__title">{w.title}</span>
                  <span class="works-list__meta">{[s.showCategory && category?.label, s.showYear && w.year].filter(Boolean).join(' · ')}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </SectionFrame>
  );
}
