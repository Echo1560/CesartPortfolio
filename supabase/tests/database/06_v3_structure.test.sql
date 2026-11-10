-- v3 structure and integrity: pages/sections/blocks/theme constraints and the
-- triggers that stand in for foreign keys inside JSON. Runs as postgres.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

select has_table('public', t, 'table public.' || t || ' exists') from unnest(array['pages', 'sections', 'blocks', 'theme']) t;
select has_view('public', 'published_snapshots', 'view public.published_snapshots exists');

select is(
  enum_range(null::public.section_type)::text[],
  array['hero', 'text', 'image', 'gallery', 'featured', 'about', 'contact', 'columns', 'spacer', 'cta', 'works-list'],
  'section types match SECTION_TYPES in schema-v3.ts'
);
select is(
  enum_range(null::public.block_type)::text[],
  array['heading', 'paragraph', 'image', 'button', 'divider', 'spacer', 'quote', 'video'],
  'block types match BLOCK_TYPES in schema-v3.ts'
);

-- Pages ----------------------------------------------------------------------
select throws_ok($$delete from public.pages where is_home$$, 'PT409', 'the home page cannot be deleted', 'the home page cannot be deleted');
select throws_ok(
  $$insert into public.pages (slug, title, status, is_home, position) values ('second-home', 'Second', 'published', true, 50)$$,
  '23505', null, 'there is only one home page'
);
select throws_ok(
  $$insert into public.pages (slug, title, position) values ('admin', 'Admin', 50)$$,
  '23514', null, 'reserved slugs are rejected'
);
select throws_ok(
  $$insert into public.pages (slug, title, position) values ('Not A Slug', 'X', 50)$$,
  '23514', null, 'slugs must be kebab-case'
);
select throws_ok(
  $$insert into public.pages (slug, title, position) values ('home', 'Duplicate', 50)$$,
  '23505', null, 'slugs are unique'
);
select throws_ok(
  $$update public.pages set status = 'draft' where is_home$$,
  '23514', null, 'the home page stays published'
);

-- Moving the home flag works in one transaction; ending with no home does not.
insert into public.pages (slug, title, status, position) values ('process', 'Process', 'published', 60);
select lives_ok(
  $$update public.pages set is_home = false where is_home; update public.pages set is_home = true where slug = 'process'$$,
  'the home flag can move to another page'
);
select throws_ok(
  $$update public.pages set is_home = false where is_home; set constraints pages_one_home_at_commit immediate$$,
  'PT409', 'exactly one page must be the home page', 'a site without a home page is rejected at commit'
);

-- Sections -------------------------------------------------------------------
select throws_ok(
  $$insert into public.sections (page_id, type, variant, position) select id, 'hero', 'masonry', 99 from public.pages where slug = 'process'$$,
  '23514', null, 'an unknown variant for the type is rejected'
);
select throws_ok(
  $$insert into public.sections (page_id, type, position, settings) select id, 'columns', 99, '{"columns": 7}' from public.pages where slug = 'process'$$,
  '23514', null, 'a columns section has 2-4 columns'
);

insert into public.sections (id, page_id, type, position, settings)
select '00000000-0000-4000-8000-0000000000c1', id, 'columns', 98, '{"columns": 3}' from public.pages where slug = 'process';
insert into public.sections (id, page_id, type, position)
select '00000000-0000-4000-8000-0000000000a1', id, 'about', 97 from public.pages where slug = 'process';

-- Blocks ---------------------------------------------------------------------
select lives_ok(
  $$insert into public.blocks (section_id, type, column_index, position) values ('00000000-0000-4000-8000-0000000000c1', 'divider', 2, 0)$$,
  'a block can go in the third column of a 3-column section'
);
select throws_ok(
  $$insert into public.blocks (section_id, type, column_index, position) values ('00000000-0000-4000-8000-0000000000c1', 'divider', 3, 0)$$,
  '23514', null, 'a block cannot use a column the section does not have'
);
select throws_ok(
  $$insert into public.blocks (section_id, type, position) values ('00000000-0000-4000-8000-0000000000a1', 'divider', 0)$$,
  '23514', null, 'blocks only go in text and columns sections'
);
select throws_ok(
  $$update public.sections set settings = '{"columns": 2}' where id = '00000000-0000-4000-8000-0000000000c1'$$,
  '23514', null, 'a section cannot drop a column its blocks still use'
);

-- Media references inside JSON -----------------------------------------------
select throws_ok(
  $$update public.sections set content = '{"portrait": {"mediaId": "00000000-0000-4000-8000-00000000dead"}}' where id = '00000000-0000-4000-8000-0000000000a1'$$,
  '23503', null, 'a mediaId that is not in the library is rejected'
);
-- A file no v2 placement uses, so only the JSON reference can block the delete.
insert into public.media (id, storage_path, kind, mime_type, bytes, width, height)
values ('00000000-0000-4000-8000-0000000000f1', 'uploads/test-only.jpg', 'image', 'image/jpeg', 1, 10, 10);
update public.sections
   set content = '{"portrait": {"mediaId": "00000000-0000-4000-8000-0000000000f1"}}'
 where id = '00000000-0000-4000-8000-0000000000a1';
select throws_ok(
  $$delete from public.media where id = '00000000-0000-4000-8000-0000000000f1'$$,
  '23503', null, 'a library file used by a section cannot be deleted'
);

select * from finish();
rollback;
