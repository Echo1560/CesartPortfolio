import type { VNode } from 'preact';
import { BlockList } from '../blocks/Blocks';
import { SectionFrame } from '../SectionFrame';
import type { SectionOf } from '../types';

/** Variants: `default` (equal columns), `wide-left`, `wide-right`. Blocks are placed by `column`. */
export function Columns({ section }: { section: SectionOf<'columns'> }): VNode {
  const s = section.settings;
  const count = s.columns ?? 2;
  const classes = ['container', 'columns__grid', 'reveal', `cols-${count}`, s.gap && `gap-${s.gap}`, s.stackBelow && `stack-${s.stackBelow}`, s.verticalAlign && `va-${s.verticalAlign}`]
    .filter(Boolean)
    .join(' ');
  return (
    <SectionFrame section={section}>
      <div class={classes}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} class="columns__col">
            <BlockList blocks={section.blocks} column={i} />
          </div>
        ))}
      </div>
    </SectionFrame>
  );
}
