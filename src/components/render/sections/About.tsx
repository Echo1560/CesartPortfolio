import type { VNode } from 'preact';
import { MediaView } from '../MediaView';
import { Inline, RichTextView } from '../RichText';
import { SectionFrame, titleId } from '../SectionFrame';
import type { SectionOf } from '../types';

/** Variants: `default` (portrait left), `portrait-right`, `stacked` (portrait above the text). */
export function About({ section }: { section: SectionOf<'about'> }): VNode {
  const { heading, body, portrait } = section.content;
  const id = titleId(section);
  return (
    <SectionFrame section={section} class="about" labelledBy={id}>
      <div class="container about__inner">
        {portrait && (
          <div class="about__portrait reveal">
            <MediaView media={portrait} mode="detail" sizes="(min-width: 800px) 30vw, 80vw" />
          </div>
        )}
        <div class="about__text reveal">
          <h2 id={id} class="section__title">
            <Inline text={heading} />
          </h2>
          <RichTextView doc={body} />
        </div>
      </div>
    </SectionFrame>
  );
}
