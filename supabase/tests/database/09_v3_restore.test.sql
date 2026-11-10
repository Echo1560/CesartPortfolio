-- v3 publish snapshot and restore (TITA-93): hidden-everywhere sections stay in
-- the snapshot, snapshot_media_paths() lists only library files of what the
-- build renders, and restore_published_snapshot() brings a version back into
-- the draft (pages, slugs, home flag, sections and blocks with their ids,
-- including blocks moved to another section since).
--
-- Users come from seed.sql: Cesart (editor).
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- ids used below
--   pages:    c1 commissions (in the version), c2 news (published later), c3 notes (draft), c4 draft taking the slug
--   sections: d1 text (visible), d2 text (hidden everywhere), d3 text on the notes page
--   blocks:   e1 heading (moved to d3 later), e2 paragraph, e3 hidden everywhere, e4 inside d2

select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

-- ===========================================================================
-- Version A: a commissions page with a visible and a hidden-everywhere section
-- ===========================================================================
insert into public.pages (id, slug, title, status, position)
values ('00000000-0000-4000-8000-0000000000c1', 'commissions', 'Commissions', 'published', 10);
insert into public.sections (id, page_id, type, position) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c1', 'text', 0);
insert into public.sections (id, page_id, type, position, show_on_desktop, show_on_tablet, show_on_mobile) values
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c1', 'text', 1, false, false, false);
insert into public.blocks (id, section_id, type, position, content) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', 'heading', 0, '{"text": [{"type": "text", "text": "Rates"}], "level": 2}'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d1', 'paragraph', 1, '{"text": {"type": "doc", "content": []}}'),
  ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000d2', 'divider', 0, '{}');
insert into public.blocks (id, section_id, type, position, content, show_on_desktop, show_on_tablet, show_on_mobile) values
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000d1', 'divider', 2, '{}', false, false, false);

select lives_ok($$select public.create_publish_run()$$, 'publish version A');
reset role;
update public.publish_runs set status = 'succeeded', finished_at = now() where status = 'pending';
create temp table version_a on commit drop as select id from public.publish_runs order by requested_at desc, id desc limit 1;
grant select on version_a to authenticated;

select is(
  (select jsonb_array_length(p -> 'sections') from public.publish_runs r, jsonb_array_elements(r.snapshot -> 'pages') p
    where r.id = (select id from version_a) and p ->> 'slug' = 'commissions'),
  2,
  'a section hidden on every device stays in the snapshot'
);
select is(
  (select s -> 'visibility' from public.publish_runs r, jsonb_array_elements(r.snapshot -> 'pages') p, jsonb_array_elements(p -> 'sections') s
    where r.id = (select id from version_a) and s ->> 'id' = '00000000-0000-4000-8000-0000000000d2'),
  '{"desktop": false, "tablet": false, "mobile": false}'::jsonb,
  'with its visibility flags'
);
select is(
  (select jsonb_array_length(s -> 'blocks') from public.publish_runs r, jsonb_array_elements(r.snapshot -> 'pages') p, jsonb_array_elements(p -> 'sections') s
    where r.id = (select id from version_a) and s ->> 'id' = '00000000-0000-4000-8000-0000000000d1'),
  3,
  'a block hidden on every device stays in the snapshot too'
);
select is(
  jsonb_array_length(public.snapshot_strip_hidden((select snapshot from public.publish_runs where id = (select id from version_a))) #> '{pages,1,sections}'),
  1,
  'snapshot_strip_hidden() drops it, as the build does'
);

-- Hidden means private: anon never gets hidden-everywhere items, editors keep them for restore.
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select ok(public.get_published_content()::text like '%00000000-0000-4000-8000-0000000000d1%', 'anon reads version A (visible section)');
select ok(public.get_published_content()::text not like '%00000000-0000-4000-8000-0000000000d2%', 'anon does not get the section hidden on every device');
select ok(public.get_published_content()::text not like '%00000000-0000-4000-8000-0000000000e3%', 'anon does not get the block hidden on every device');
select ok(public.get_published_content()::text not like '%00000000-0000-4000-8000-0000000000e4%', 'anon does not get the blocks of a hidden section');
reset role;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;
select ok(
  (select snapshot::text from public.published_snapshots where id = (select id from version_a)) like '%00000000-0000-4000-8000-0000000000d2%'
  and (select snapshot::text from public.published_snapshots where id = (select id from version_a)) like '%00000000-0000-4000-8000-0000000000e3%',
  'editors still see hidden items in the stored version (for restore)'
);
reset role;

-- ===========================================================================
-- snapshot_media_paths(): library files of what the build renders
-- ===========================================================================
select is_empty(
  $$select unnest(media_paths) from public.publish_runs where id = (select id from version_a)
    except select storage_path::text from public.media$$,
  'the run''s media_paths are all library files'
);
select is(
  public.snapshot_media_paths(jsonb_build_object(
    'site', jsonb_build_object('meta', jsonb_build_object('ogImage', 'not/in-library.jpg')),
    'works', jsonb_build_array(jsonb_build_object('media', jsonb_build_object('src', (select storage_path::text from public.media order by storage_path limit 1)))),
    'notes', jsonb_build_object('src', 'evil/../../secret.jpg', 'poster', 'https://example.com/x.jpg')
  )),
  array[(select storage_path::text from public.media order by storage_path limit 1)],
  'keys that are not library files are dropped'
);
select is(
  public.snapshot_media_paths(jsonb_build_object('pages', jsonb_build_array(jsonb_build_object('sections', jsonb_build_array(
    jsonb_build_object('visibility', '{"desktop": false, "tablet": false, "mobile": false}'::jsonb,
                       'content', jsonb_build_object('media', jsonb_build_object('src', (select storage_path::text from public.media order by storage_path limit 1))))
  ))))),
  '{}'::text[],
  'media of a section hidden on every device is not made public'
);

-- ===========================================================================
-- Change the draft after version A
-- ===========================================================================
set local role authenticated;

-- A published page that is not in version A, made the home page.
insert into public.pages (id, slug, title, status, position)
values ('00000000-0000-4000-8000-0000000000c2', 'news', 'News', 'published', 11);
select lives_ok($$select public.set_home_page('00000000-0000-4000-8000-0000000000c2')$$, 'news becomes the home page');

-- Block e1 moves to a section on another page.
insert into public.pages (id, slug, title, status, position)
values ('00000000-0000-4000-8000-0000000000c3', 'notes', 'Notes', 'draft', 12);
insert into public.sections (id, page_id, type, position)
values ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000c3', 'text', 0);
update public.blocks set section_id = '00000000-0000-4000-8000-0000000000d3', position = 5 where id = '00000000-0000-4000-8000-0000000000e1';

-- The commissions page is renamed and its slug taken by a new draft page.
update public.pages set slug = 'old-commissions', title = 'Old' where id = '00000000-0000-4000-8000-0000000000c1';
insert into public.pages (id, slug, title, status, position)
values ('00000000-0000-4000-8000-0000000000c4', 'commissions', 'Commissions draft', 'draft', 13);

-- The hidden section is deleted, and the visible one changed.
delete from public.sections where id = '00000000-0000-4000-8000-0000000000d2';
update public.sections set variant = 'boxed' where id = '00000000-0000-4000-8000-0000000000d1';

-- ===========================================================================
-- Restore version A
-- ===========================================================================
select lives_ok($$select public.restore_published_snapshot((select id from version_a))$$, 'restore version A (with a moved block) succeeds');

select is((select status::text from public.pages where id = '00000000-0000-4000-8000-0000000000c2'), 'hidden', 'a published page that is not in the version becomes hidden');
select is((select slug::text from public.pages where id = '00000000-0000-4000-8000-0000000000c2'), 'news', 'and keeps its slug');
select matches(
  (select slug::text from public.pages where id = '00000000-0000-4000-8000-0000000000c4'),
  '^commissions-[0-9a-f]{6}$',
  'a draft page holding a slug the version needs is renamed <slug>-<hex>'
);
select is((select status::text from public.pages where id = '00000000-0000-4000-8000-0000000000c4'), 'draft', 'and stays a draft');
select is((select status::text from public.pages where id = '00000000-0000-4000-8000-0000000000c3'), 'draft', 'other draft pages are kept');

select results_eq(
  $$select slug::text, title, status::text from public.pages where id = '00000000-0000-4000-8000-0000000000c1'$$,
  $$values ('commissions', 'Commissions', 'published')$$,
  'the version''s page comes back with its id, slug and title, published'
);
select is((select slug::text from public.pages where is_home), 'home', 'the home flag moves back to the version''s home page');
select is((select count(*)::int from public.pages where is_home), 1, 'there is exactly one home page');

select results_eq(
  $$select id, variant from public.sections where page_id = '00000000-0000-4000-8000-0000000000c1' order by position$$,
  $$values ('00000000-0000-4000-8000-0000000000d1'::uuid, 'default'::text), ('00000000-0000-4000-8000-0000000000d2'::uuid, 'default'::text)$$,
  'sections come back with their ids, order and settings'
);
select results_eq(
  $$select show_on_desktop, show_on_tablet, show_on_mobile from public.sections where id = '00000000-0000-4000-8000-0000000000d2'$$,
  $$values (false, false, false)$$,
  'the hidden-everywhere section comes back hidden'
);
select results_eq(
  $$select id, section_id from public.blocks where section_id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2') order by section_id, position$$,
  $$values ('00000000-0000-4000-8000-0000000000e1'::uuid, '00000000-0000-4000-8000-0000000000d1'::uuid),
           ('00000000-0000-4000-8000-0000000000e2'::uuid, '00000000-0000-4000-8000-0000000000d1'::uuid),
           ('00000000-0000-4000-8000-0000000000e3'::uuid, '00000000-0000-4000-8000-0000000000d1'::uuid),
           ('00000000-0000-4000-8000-0000000000e4'::uuid, '00000000-0000-4000-8000-0000000000d2'::uuid)$$,
  'blocks come back with their ids, in their sections'
);
select is_empty(
  $$select 1 from public.blocks where section_id = '00000000-0000-4000-8000-0000000000d3'$$,
  'the moved block left the section it was moved to'
);
select results_eq(
  $$select show_on_desktop, show_on_tablet, show_on_mobile from public.blocks where id = '00000000-0000-4000-8000-0000000000e3'$$,
  $$values (false, false, false)$$,
  'the hidden-everywhere block comes back hidden'
);

select lives_ok($$select public.restore_published_snapshot((select id from version_a))$$, 'restoring the same version again works');
select is((select count(*)::int from public.blocks where id::text like '00000000-0000-4000-8000-0000000000e%'), 4, 'and changes nothing');

-- ===========================================================================
-- Versions that cannot be restored
-- ===========================================================================
reset role;
insert into public.publish_runs (id, status, snapshot, media_paths, content_hash, finished_at)
select '00000000-0000-4000-8000-0000000000f2', 'succeeded', public.build_content(true), '{}', repeat('0', 64), now();
set local role authenticated;

select throws_ok(
  $$select public.restore_published_snapshot('00000000-0000-4000-8000-0000000000f2')$$,
  'PT422', 'only v3 versions can be restored',
  'restoring a v2 version fails with PT422'
);
select throws_ok(
  $$select public.restore_published_snapshot(gen_random_uuid())$$,
  'PT404', null,
  'an unknown version is PT404'
);

reset role;
select is(
  (select count(*)::int from public.activity_log where action = 'restore' and actor_id = '11111111-1111-4111-8111-111111111111'),
  2,
  'each restore is in the activity log'
);

select * from finish();
rollback;
