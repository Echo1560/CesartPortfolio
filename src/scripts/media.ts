/**
 * Media behaviour: hover-to-play on pointer devices, play-on-visible on touch,
 * pause when off-screen, click-to-load embeds. Reduced motion shows posters only.
 */
import { track } from '../lib/track';
import { canHover, reducedMotion } from './util';

const visible = new WeakSet<Element>();
const hovering = new WeakSet<Element>();

function slugOf(el: Element): string | undefined {
  const host = el.closest<HTMLElement>('[data-slug], [data-work-slug]');
  return host?.dataset.slug ?? host?.dataset.workSlug;
}

/** Whether a given media element should be playing right now. */
function shouldPlay(el: HTMLElement): boolean {
  if (reducedMotion.matches && !el.classList.contains('is-forced')) return false;
  if (!visible.has(el)) return false;
  const mode = el.dataset.animated ?? el.dataset.video;
  if (mode === 'hover') return canHover.matches ? hovering.has(el) : true;
  return mode === 'visible' || mode === 'hero';
}

function setAnimated(box: HTMLElement, play: boolean): void {
  const img = box.querySelector<HTMLImageElement>('.media__anim');
  if (!img) return;
  if (play && !img.hasAttribute('src')) img.src = img.dataset.src ?? '';
  if (!play) img.removeAttribute('src');
  box.classList.toggle('is-playing', play);
}

function setVideo(video: HTMLVideoElement, play: boolean): void {
  const box = video.closest<HTMLElement>('.media');
  if (play) {
    if (video.preload === 'none') video.preload = 'metadata';
    void video.play().catch(() => {});
  } else {
    video.pause();
  }
  box?.classList.toggle('is-playing', play);
}

function sync(el: HTMLElement): void {
  const play = shouldPlay(el);
  if (el instanceof HTMLVideoElement) {
    // Controlled videos are driven by the user; only pause them when scrolled away.
    if (el.dataset.video === 'controlled') {
      if (!visible.has(el)) el.pause();
      return;
    }
    setVideo(el, play);
  } else {
    setAnimated(el, play);
  }
}

export function initMedia(root: ParentNode = document): void {
  const targets = root.querySelectorAll<HTMLElement>('[data-animated], [data-video]');

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        if (entry.isIntersecting) visible.add(el);
        else visible.delete(el);
        sync(el);
      }
    },
    { rootMargin: '80px' },
  );

  targets.forEach((el) => {
    io.observe(el);
    // Hover/focus on the tile (or the media itself) starts playback on pointer devices.
    const host = el.closest<HTMLElement>('.tile__link') ?? el;
    const on = () => {
      hovering.add(el);
      sync(el);
    };
    const off = () => {
      hovering.delete(el);
      sync(el);
    };
    host.addEventListener('pointerenter', on);
    host.addEventListener('pointerleave', off);
    host.addEventListener('focusin', on);
    host.addEventListener('focusout', off);
  });

  // Reduced motion: animated media in detail views get an explicit play toggle.
  root.querySelectorAll<HTMLElement>('[data-animated="visible"]').forEach((box) => {
    const toggle = box.querySelector<HTMLButtonElement>('[data-anim-toggle]');
    if (!toggle) return;
    toggle.hidden = !reducedMotion.matches;
    toggle.addEventListener('click', () => {
      const on = !box.classList.contains('is-forced');
      box.classList.toggle('is-forced', on);
      toggle.textContent = on ? 'Pause animation' : 'Play animation';
      sync(box);
    });
  });

  reducedMotion.addEventListener('change', () => targets.forEach(sync));

  // Embeds load only after a click (privacy and performance).
  root.querySelectorAll<HTMLButtonElement>('[data-embed-url]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const box = btn.closest<HTMLElement>('.media');
      if (!box) return;
      const frame = document.createElement('iframe');
      frame.src = `${btn.dataset.embedUrl}${btn.dataset.embedUrl?.includes('?') ? '&' : '?'}autoplay=1`;
      frame.title = btn.dataset.embedTitle ?? 'Video';
      frame.allow = 'autoplay; fullscreen; picture-in-picture';
      frame.allowFullscreen = true;
      box.append(frame);
      box.querySelectorAll('.media__poster, .media__fallback').forEach((n) => n.remove());
      btn.remove();
      frame.focus();
      track('video_play', { slug: slugOf(box), provider: 'embed' });
    });
  });

  // `play` does not bubble, so listen in the capture phase for controlled videos.
  if (root === document) {
    document.addEventListener(
      'play',
      (e) => {
        const v = e.target;
        if (v instanceof HTMLVideoElement && v.dataset.video === 'controlled') track('video_play', { slug: slugOf(v) });
      },
      true,
    );
  }
}
