import type { VNode } from 'preact';
import { BlockList } from '../blocks/Blocks';
import { SectionFrame } from '../SectionFrame';
import type { SectionOf } from '../types';

/** Variants: `default`, `lead` (larger intro text), `boxed` (on a surface card). */
export function Text({ section }: { section: SectionOf<'text'> }): VNode {
  return (
    <SectionFrame section={section}>
      <div class="container text__inner reveal">
        <BlockList blocks={section.blocks} column={0} />
      </div>
    </SectionFrame>
  );
}
