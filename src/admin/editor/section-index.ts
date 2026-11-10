/**
 * Maps positions among the sections drawn on the canvas to positions in `page.sections`.
 * The canvas leaves out sections hidden on the current device, so the two lists can differ.
 */

/** Index in `sectionIds` for a new section placed before the drawn section `drawnIndex` (`drawnIds.length` = at the end). */
export function insertIndex(sectionIds: string[], drawnIds: string[], drawnIndex: number): number {
  const ref = drawnIds[drawnIndex];
  if (ref === undefined) return sectionIds.length;
  const at = sectionIds.indexOf(ref);
  return at < 0 ? sectionIds.length : at;
}

/**
 * Target index for moving section `id` one step up or down past the next drawn neighbour,
 * so the move is visible. Returns `null` when no drawn neighbour lies in that direction.
 */
export function stepIndex(sectionIds: string[], drawnIds: string[], id: string, step: -1 | 1): number | null {
  const at = sectionIds.indexOf(id);
  if (at < 0) return null;
  const drawn = new Set(drawnIds);
  for (let i = at + step; i >= 0 && i < sectionIds.length; i += step) if (drawn.has(sectionIds[i]!)) return i;
  return null;
}
