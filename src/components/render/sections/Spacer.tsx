import type { VNode } from 'preact';
import { SectionFrame } from '../SectionFrame';
import type { SectionOf } from '../types';

export function Spacer({ section }: { section: SectionOf<'spacer'> }): VNode {
  return (
    <SectionFrame section={section} padded={false} class={`sp-${section.settings.size}`}>
      {section.settings.divider && <hr class="spacer__rule container" />}
    </SectionFrame>
  );
}
