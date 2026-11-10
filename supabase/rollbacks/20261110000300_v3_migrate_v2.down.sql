-- Undo 20261110000300_v3_migrate_v2.sql. Deletes every v3 page, section and
-- block and the theme row (the v2 tables were never changed by the migration),
-- then drops the helper functions. Run before 20261110000200 / 0100 down files.
alter table public.pages disable trigger pages_protect_home;
delete from public.pages;
alter table public.pages enable trigger pages_protect_home;
delete from public.theme;
update public.site set nav = '{"items": []}'::jsonb,
  footer = '{"links": [], "showSocials": false, "showCopyright": true, "showBackToTop": true}'::jsonb;

drop function if exists public.migrate_v2_to_v3();
drop function if exists public.v2_placement_ref(public.media_slot);
drop function if exists public.default_theme_tokens();
drop function if exists public.md_to_richtext(text);
drop function if exists public.md_inline_to_richtext(text);
drop function if exists public.text_to_inline(text);
