import { track } from '../lib/track';
import { initFilter } from './filter';
import { initLightbox } from './lightbox';
import { initMedia } from './media';

function initReveal(): void {
  const items = document.querySelectorAll<HTMLElement>('.reveal');
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  items.forEach((el) => io.observe(el));
}

/** Sticky header hides while scrolling down and returns on scroll up. */
function initHeader(): void {
  const header = document.querySelector<HTMLElement>('[data-site-header]');
  if (!header) return;
  let last = scrollY;
  addEventListener(
    'scroll',
    () => {
      const y = scrollY;
      const hide = y > last && y > 160 && !header.contains(document.activeElement);
      header.classList.toggle('is-hidden', hide);
      last = y;
    },
    { passive: true },
  );
  header.addEventListener('focusin', () => header.classList.remove('is-hidden'));
}

function initTracking(): void {
  track('page_view', { path: location.pathname });
  const slug = document.body.dataset.workSlug;
  if (slug) track('work_open', { slug, source: 'page' });
  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-track="contact_click"]');
    if (el) track('contact_click', { source: el.dataset.trackSource });
  });
}

initReveal();
initHeader();
initMedia();
initFilter();
initLightbox();
initTracking();
