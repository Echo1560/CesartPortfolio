-- Undo 20261110000100_v3_content_model.sql. Deletes all v3 draft content
-- (pages, sections, blocks, theme, nav, footer). Run the 0300 and 0200 down files first.
drop trigger if exists media_protect_in_use on public.media;
drop table if exists public.blocks;
drop table if exists public.sections;
drop table if exists public.pages;
drop table if exists public.theme;
drop function if exists public.protect_media_in_use();
drop function if exists public.check_json_media_refs();
drop function if exists public.json_media_ids(jsonb);
drop function if exists public.check_section_blocks();
drop function if exists public.check_block_parent();
drop function if exists public.section_block_columns(public.section_type, jsonb);
drop function if exists public.set_home_page(uuid);
drop function if exists public.assert_one_home_page();
drop function if exists public.protect_home_page();
alter table public.site drop column if exists nav, drop column if exists footer;
drop type if exists public.block_type;
drop type if exists public.section_type;
drop type if exists public.page_status;
