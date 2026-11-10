import type { VNode } from 'preact';
import { ButtonLink } from '../ButtonLink';
import { Inline, RichTextView } from '../RichText';
import { SectionFrame } from '../SectionFrame';
import type { SectionOf } from '../types';

/** Variants: `default` (the v2 "Have a project in mind?" band), `centered`, `banner` (full-width accent band). */
export function Cta({ section }: { section: SectionOf<'cta'> }): VNode {
  const { heading, body, buttons } = section.content;
  return (
    <SectionFrame section={section} class="cta">
      <div class="container">
        <aside class="cta-band reveal" aria-label="Call to action">
          <div class="cta-band__text">
            <p class="cta-band__heading">
              <Inline text={heading} />
            </p>
            <RichTextView doc={body} />
          </div>
          <div class="cta-band__buttons">
            {buttons.map((b, i) => (
              <ButtonLink key={i} button={b} trackSource="cta-band" />
            ))}
          </div>
        </aside>
      </div>
    </SectionFrame>
  );
}
