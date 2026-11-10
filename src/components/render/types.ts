import type { BlockContent, BlockSettings, BlockType, SectionContent, SectionSettings, SectionType, SnapshotPage, Visibility } from '../../lib/schema-v3';

/**
 * The zod unions in schema-v3.ts are validated, but typed loosely. These are
 * the shapes the components rely on; `asSection` / `asBlock` narrow them by type.
 */
export interface LooseBlock {
  id: string;
  type: BlockType;
  column: number;
  settings: BlockSettings;
  content: unknown;
  visibility: Visibility;
}

export interface LooseSection {
  id: string;
  type: SectionType;
  variant: string;
  settings: unknown;
  content: unknown;
  visibility: Visibility;
  blocks?: LooseBlock[];
}

/** A page's sections, typed for rendering. */
export function sectionsOf(page: Pick<SnapshotPage, 'sections'>): LooseSection[] {
  return page.sections as unknown as LooseSection[];
}

/** A section with its settings and content typed for `T`. */
export interface SectionOf<T extends SectionType> extends Omit<LooseSection, 'type' | 'settings' | 'content'> {
  type: T;
  settings: SectionSettings<T>;
  content: SectionContent<T>;
}

export function asSection<T extends SectionType>(section: LooseSection): SectionOf<T> {
  return section as unknown as SectionOf<T>;
}

export interface BlockOf<T extends BlockType> extends Omit<LooseBlock, 'type' | 'content'> {
  type: T;
  content: BlockContent<T>;
}

export function asBlock<T extends BlockType>(block: LooseBlock): BlockOf<T> {
  return block as unknown as BlockOf<T>;
}
