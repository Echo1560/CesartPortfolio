# Design spec (v1)

Direction: **quiet gallery**. Neutral, art-first, large media, little chrome. All values below are tokens so the look can be swapped later without touching components.

## Stack

Astro (static output, `base: '/CesartPortfolio/'`) + TypeScript. Content in `content/` (`site.json`, `works.json`, `media/`), validated with zod through one data-access module (`getSite()`, `getWorks()`). Client JS limited to the filter, lightbox, hover-to-play and `track()`. Deployed with a GitHub Actions Pages workflow.

## Home sections (order and visibility come from the layout config in `site.json`)

1. **Header**: wordmark, anchor links (Work, About, Contact), "Commissions" CTA. Sticky, hides on scroll down.
2. **Hero**: reel-first. Muted looping reel (poster first, video lazy) with name and one-line role. Placeholder loop until real reel exists.
3. **Featured**: 3-6 pieces chosen by id, larger tiles.
4. **Work grid**: filter bar (All / Illustration / Animation, plus tags) and the grid.
5. **About**: portrait, short bio, services, social links.
6. **Contact**: email, socials, commission CTA. Repeated as a slim CTA band after the grid.
7. **Footer**.

## Grid behaviour

- Masonry-style columns that keep each piece's own aspect ratio (illustration is not cropped). Columns: 1 (<600px), 2 (<1024px), 3-4 above; configurable in layout config.
- Every tile has a fixed `aspect-ratio` from data to avoid layout shift; images use responsive `srcset`, `loading="lazy"`, `decoding="async"`.
- Animation tiles show a poster and a small play badge. On hover/focus (pointer devices) the loop plays; on touch it plays when scrolled into view. Everything pauses when off-screen (IntersectionObserver).
- Filtering is a button group (`aria-pressed`), updates the URL hash/query, and animates tiles with FLIP. Empty state message included.

## Detail view / lightbox

- Each work has a clean URL `/work/<slug>/`. Clicking a tile opens an in-page lightbox (native `<dialog>`) that updates the URL; direct load renders the full page.
- Contents: media (image, looping animation, or video with controls; YouTube/Vimeo embed loaded on click), title, year, tags, description, prev/next.
- Keyboard: Esc closes, Left/Right navigate, focus trapped and returned to the tile. Swipe on touch. Alt text and captions from data.

## Motion list

| Motion | Duration token | Reduced-motion fallback |
|---|---|---|
| Section/scroll reveals (fade + 16px rise, staggered) | `--dur-reveal` | Shown immediately, no movement |
| Tile hover (slight scale 1.02, caption fade) | `--dur-fast` | Caption fade only |
| Hover-to-play thumbnails | n/a | Poster only; play via lightbox |
| Filter re-layout (FLIP) | `--dur-base` | Instant swap |
| Lightbox open/close (shared-element zoom from tile) | `--dur-base` | Plain fade, then instant |
| Page transitions (View Transitions API) | `--dur-base` | Disabled |
| Hero reel | n/a | Poster image, no autoplay |

All gated by `@media (prefers-reduced-motion: reduce)` and a single `--motion-scale` token.

## Tokens (CSS custom properties, one `tokens.css`)

- Color: `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-accent`, `--color-border`, `--color-overlay` (light and dark sets via `prefers-color-scheme`).
- Type: `--font-display`, `--font-body`, `--text-xs..4xl` (fluid `clamp`), `--leading-*`, `--weight-*`.
- Space: `--space-1..9`, `--gutter`, `--container-max`, `--grid-gap`.
- Shape: `--radius-sm/md/lg`, `--shadow-1/2`.
- Motion: `--dur-fast`, `--dur-base`, `--dur-reveal`, `--ease-out`, `--ease-in-out`, `--motion-scale`.
- Layers: `--z-header`, `--z-lightbox`.

## Quality bar

Mobile first, semantic landmarks, visible focus rings, AA contrast, no cookies or third-party trackers, Lighthouse performance and accessibility >= 90, OG/Twitter meta from `site.json`.
