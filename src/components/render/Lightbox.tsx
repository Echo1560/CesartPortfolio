import type { VNode } from 'preact';
import type { Work } from '../../lib/schema';
import { WorkDetail } from './WorkDetail';
import { useRender } from './context';

/**
 * The work lightbox shell plus one `<template>` per work. `scripts/lightbox.ts`
 * (vanilla, already on the page) opens it; this renders no JS of its own.
 * Rendered once on any page that has work tiles.
 */
export function Lightbox({ works }: { works: Work[] }): VNode {
  const { categories } = useRender();
  return (
    <>
      <dialog class="lightbox" id="lightbox" aria-labelledby="lightbox-title" data-lightbox>
        <div class="lightbox__bar">
          <a class="lightbox__page" href="#" data-lightbox-page>Open full page</a>
          <button type="button" class="lightbox__btn" data-lightbox-close aria-label="Close">✕</button>
        </div>
        <button type="button" class="lightbox__btn lightbox__nav lightbox__nav--prev" data-lightbox-prev aria-label="Previous work">←</button>
        <button type="button" class="lightbox__btn lightbox__nav lightbox__nav--next" data-lightbox-next aria-label="Next work">→</button>
        <div class="lightbox__body" data-lightbox-body></div>
      </dialog>
      {works.map((w) => (
        <template key={w.id} data-lightbox-template={w.slug}>
          <WorkDetail work={w} category={categories.find((c) => c.id === w.categoryId)} variant="lightbox" />
        </template>
      ))}
    </>
  );
}
