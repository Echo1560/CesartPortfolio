// @ts-check
import { existsSync } from 'node:fs';
import { defineConfig } from 'astro/config';

// CONTENT_SOURCE and PUBLIC_SUPABASE_* for src/lib/content.ts. Real env vars win over .env.
if (existsSync('.env')) process.loadEnvFile('.env');

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
