import type { ComponentChildren, VNode } from 'preact';
import { visibilityClasses } from '../../lib/render-model';
import type { MediaRef, SectionType, SnapshotMedia } from '../../lib/schema-v3';
import type { SectionOf } from './types';
import { MediaView } from './MediaView';

/** Settings every section type accepts (docs/V3-CONTRACTS.md §3.1), with the media resolved. */
type Space = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface BaseSettings {
  anchor?: string;
  align?: 'left' | 'center' | 'right';
  width?: 'narrow' | 'normal' | 'wide' | 'full';
  paddingTop?: Space;
  paddingBottom?: Space;
  colorScheme?: 'default' | 'surface' | 'inverse' | 'accent';
  backgroundImage?: { image: SnapshotMedia | MediaRef; overlay: number };
}

interface Props {
  section: SectionOf<SectionType>;
  /** Extra classes, for example `hero` or `featured`. */
  class?: string;
  /** v2 sections have the default vertical padding; the hero has none. */
  padded?: boolean;
  /** Id of the heading that names the region (`aria-labelledby`). */
  labelledBy?: string;
  children: ComponentChildren;
}

/** Id for a section's heading: `<anchor>-title`, or one derived from the section id. */
export function titleId(section: SectionOf<SectionType>): string {
  const anchor = (section.settings as BaseSettings).anchor;
  return anchor ? `${anchor}-title` : `s-${section.id.slice(0, 8)}-title`;
}

/**
 * The wrapper every section shares: anchor, spacing, colour scheme, background
 * image and per-device visibility. The look of each setting lives in `site.css`.
 */
export function SectionFrame({ section, class: className, padded = true, labelledBy, children }: Props): VNode {
  const s = section.settings as BaseSettings;
  const bg = s.backgroundImage;
  const classes = [
    padded && 'section',
    `sec sec--${section.type} sec--${section.type}-${section.variant}`,
    className,
    s.align && `align-${s.align}`,
    s.width && `w-${s.width}`,
    s.paddingTop && `pt-${s.paddingTop}`,
    s.paddingBottom && `pb-${s.paddingBottom}`,
    s.colorScheme && s.colorScheme !== 'default' && `scheme-${s.colorScheme}`,
    bg && 'has-bg',
    bg && bg.overlay > 0 && 'has-overlay',
    ...visibilityClasses(section.visibility),
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section class={classes} id={s.anchor} aria-labelledby={labelledBy} data-section-id={section.id} data-section-type={section.type}>
      {bg && (
        <div class="sec__bg" aria-hidden="true" style={bg.overlay > 0 ? `--overlay: ${bg.overlay}%` : undefined}>
          <MediaView media={bg.image as SnapshotMedia} mode="hero" sizes="100vw" />
        </div>
      )}
      {children}
    </section>
  );
}
