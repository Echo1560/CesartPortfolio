/**
 * Renders any media entry (work media, section media). Modes:
 *  - tile: grid/featured thumbnail. Animated media and videos play on hover/focus (pointer devices) or when visible (touch).
 *  - hero: muted looping reel, plays when visible.
 *  - detail: detail page / lightbox. Videos get controls; embeds load on click.
 *
 * URLs come from the render context (resolved at build time by `lib/media.ts`),
 * so this file builds no media URL itself.
 */
import type { VNode } from 'preact';
import { mediaKey, useRender, type MediaLike } from './context';

interface Props {
  media: MediaLike & { focal?: { x: number; y: number } };
  mode?: 'tile' | 'hero' | 'detail';
  sizes?: string;
  eager?: boolean;
}

export function MediaView({ media, mode = 'detail', sizes, eager = false }: Props): VNode | null {
  const ctx = useRender();
  const found = ctx.media.get(mediaKey(media));
  if (!found) return null;
  const r = sizes && 'sizes' in found ? { ...found, sizes } : found;
  const ratio = `aspect-ratio: ${r.width} / ${r.height}`;
  const loading = eager ? 'eager' : 'lazy';
  const focus = media.focal ? `--focal: ${media.focal.x}% ${media.focal.y}%; ` : '';

  switch (r.type) {
    case 'image':
      return (
        <div class="media" style={focus + ratio}>
          <img src={r.src} srcset={r.srcset} sizes={r.sizes} width={r.width} height={r.height} alt={r.alt} loading={loading} decoding="async" fetchpriority={eager ? 'high' : undefined} />
        </div>
      );
    case 'animated':
      return (
        <div class="media media--animated" data-animated={mode === 'tile' ? 'hover' : 'visible'} style={focus + ratio}>
          {r.sources.length > 0 ? (
            <video class="media__video" poster={r.poster?.src} width={r.width} height={r.height} muted loop={r.loop} playsInline preload={eager ? 'auto' : 'metadata'} aria-label={r.alt}>
              {r.sources.map((s) => (
                <source key={s.src} src={s.src} type={s.mimeType} />
              ))}
            </video>
          ) : (
            <>
              {r.poster && <img class="media__poster" src={r.poster.src} srcset={r.poster.srcset} sizes={r.poster.sizes} width={r.width} height={r.height} alt={r.alt} loading={loading} decoding="async" />}
              <img class="media__anim" data-src={r.src} width={r.width} height={r.height} alt={r.poster ? '' : r.alt} aria-hidden={r.poster ? 'true' : undefined} decoding="async" />
            </>
          )}
          {mode === 'tile' && <span class="media__badge" aria-hidden="true">▶</span>}
          {mode !== 'tile' && (r.poster || r.sources.length > 0) && (
            <button type="button" class="media__toggle" data-anim-toggle hidden>
              Play animation
            </button>
          )}
        </div>
      );
    case 'video':
      return (
        <div class={`media media--video media--${mode}`} style={focus + ratio}>
          <video
            data-video={mode === 'detail' ? 'controlled' : mode === 'hero' ? 'hero' : 'hover'}
            poster={r.poster.src}
            width={r.width}
            height={r.height}
            muted={mode !== 'detail'}
            loop={mode !== 'detail' || r.loop}
            controls={mode === 'detail'}
            playsInline
            preload={mode === 'hero' ? 'metadata' : 'none'}
            aria-label={r.alt}
          >
            <source src={r.src} type={r.mimeType} />
          </video>
          {mode === 'tile' && <span class="media__badge" aria-hidden="true">▶</span>}
        </div>
      );
    case 'embed':
      return (
        <div class="media media--embed" data-embed style={ratio}>
          {r.poster && <img class="media__poster" src={r.poster.src} srcset={r.poster.srcset} sizes={r.poster.sizes} width={r.width} height={r.height} alt={r.alt} loading={loading} decoding="async" />}
          {mode === 'detail' ? (
            <>
              <button type="button" class="media__embed-play" data-embed-url={r.embedUrl} data-embed-title={r.alt}>
                <span aria-hidden="true">▶</span>
                <span class="visually-hidden">Play video ({r.provider})</span>
              </button>
              <a class="media__fallback" href={r.pageUrl} target="_blank" rel="noopener noreferrer">
                Watch on {r.provider === 'youtube' ? 'YouTube' : 'Vimeo'}
              </a>
            </>
          ) : (
            <span class="media__badge" aria-hidden="true">▶</span>
          )}
        </div>
      );
  }
}
