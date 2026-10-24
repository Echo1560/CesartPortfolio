export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
export const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');

let probe: HTMLElement | undefined;

/** Resolves a duration token (for example `--dur-base`) to milliseconds. 0 under reduced motion. */
export function duration(token: string): number {
  probe ??= Object.assign(document.createElement('div'), { hidden: true });
  document.body.append(probe);
  probe.style.transitionDuration = `var(${token})`;
  const value = getComputedStyle(probe).transitionDuration;
  probe.remove();
  return value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
}

export function easing(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || 'ease';
}
