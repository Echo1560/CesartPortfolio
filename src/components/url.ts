/** Builds an internal URL under the site base. Never hard-code '/'. */
const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

export function url(path = ''): string {
  return base + path.replace(/^\//, '');
}

export function workUrl(slug: string): string {
  return url(`work/${slug}/`);
}
