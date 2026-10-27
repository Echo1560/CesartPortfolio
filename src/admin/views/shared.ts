import { h, toast } from '../dom';

/** Runs a save, shows the result and disables the button meanwhile. Returns true on success. */
export async function runSave(button: HTMLButtonElement, action: () => Promise<void>, message = 'Saved as draft'): Promise<boolean> {
  button.disabled = true;
  try {
    await action();
    toast(message);
    return true;
  } catch (e) {
    toast((e as Error).message, 'error');
    return false;
  } finally {
    button.disabled = false;
  }
}

export function card(title: string, stamp: string | null, ...body: (Node | null)[]): HTMLElement {
  return h('section', { class: 'card', 'aria-label': title }, h('div', { class: 'card__head' }, h('h2', {}, title), stamp ? h('p', { class: 'stamp' }, stamp) : null), ...body);
}
