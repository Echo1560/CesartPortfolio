// @ts-check
import { defineConfig } from 'astro/config';

// Shared build contract (TITA-63): static output served from the GitHub Pages
// project path. Every internal link and asset URL goes through
// import.meta.env.BASE_URL, never a hard-coded '/'.
export default defineConfig({
  output: 'static',
  site: 'https://echo1560.github.io',
  base: '/CesartPortfolio/',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
});
