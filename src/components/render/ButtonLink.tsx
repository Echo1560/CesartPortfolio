import type { VNode } from 'preact';
import type { Button, Link } from '../../lib/schema-v3';
import { useLink } from './context';
import { Inline } from './RichText';

/** `target`/`rel` for a resolved link. */
function linkAttrs(newTab: boolean) {
  return newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

interface ButtonProps {
  button: Pick<Button, 'label' | 'link'> & { style?: 'primary' | 'secondary' };
  /** Source name for the `contact_click` event when the button leads to the contact section or an email. */
  trackSource?: string;
  class?: string;
}

/** A button-styled link. Renders nothing when its target is not in the snapshot (contract §5). */
export function ButtonLink({ button, trackSource, class: className }: ButtonProps): VNode | null {
  const resolve = useLink();
  const target = resolve(button.link);
  if (!target) return null;
  const track = trackSource && (target.href.startsWith('mailto:') || target.href.endsWith('#contact'));
  return (
    <a
      class={['btn', button.style === 'secondary' && 'btn--ghost', className].filter(Boolean).join(' ')}
      href={target.href}
      {...linkAttrs(target.newTab)}
      data-track={track ? 'contact_click' : undefined}
      data-track-source={track ? trackSource : undefined}
    >
      {button.label}
    </a>
  );
}

/** A plain text link to a `Link` target, with inline-formatted children. Renders just the children when unresolved. */
export function LinkWrap({ link, children, class: className }: { link: Link | undefined; children: VNode | VNode[]; class?: string }): VNode {
  const resolve = useLink();
  const target = link ? resolve(link) : undefined;
  if (!target) return <>{children}</>;
  return (
    <a class={className} href={target.href} {...linkAttrs(target.newTab)}>
      {children}
    </a>
  );
}

export { Inline };
