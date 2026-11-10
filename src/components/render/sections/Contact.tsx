import type { VNode } from 'preact';
import { Inline, RichTextView } from '../RichText';
import { SectionFrame, titleId } from '../SectionFrame';
import { useRender } from '../context';
import type { SectionOf } from '../types';

/** Variants: `default`, `centered`, `split` (text left, links right). Socials come from `site.socials`. */
export function Contact({ section }: { section: SectionOf<'contact'> }): VNode {
  const { site } = useRender();
  const { heading, body, email, ctaLabel } = section.content;
  const { showEmail, showSocials } = section.settings;
  const id = titleId(section);
  const mail = `mailto:${email}`;
  return (
    <SectionFrame section={section} class="contact" labelledBy={id}>
      <div class="container contact__inner reveal">
        <div class="contact__main">
          <h2 id={id} class="section__title">
            <Inline text={heading} />
          </h2>
          <RichTextView doc={body} />
        </div>
        <div class="contact__links">
          {showEmail && (
            <p class="contact__email">
              <a href={mail} data-track="contact_click" data-track-source="email">
                {email}
              </a>
            </p>
          )}
          <p>
            <a class="btn" href={mail} data-track="contact_click" data-track-source="contact-cta">
              {ctaLabel}
            </a>
          </p>
          {showSocials && site.socials.length > 0 && (
            <ul class="contact__socials" aria-label="Social links">
              {site.socials.map((s) => (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" data-track="contact_click" data-track-source={s.id}>
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionFrame>
  );
}
