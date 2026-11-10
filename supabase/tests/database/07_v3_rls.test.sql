-- v3 RLS: anon reads only the published snapshot and writes nothing; signed-in
-- non-editors see and change nothing; editors edit drafts (attributed), publish
-- snapshot v3, list versions and restore one into the draft.
--
-- Users come from seed.sql: Cesart (editor), Echo 1560 (editor), Visitor (no editor row).
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- ===========================================================================
-- anon
-- ===========================================================================
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;

select throws_ok('select * from public.' || t, '42501', null, 'anon cannot select draft ' || t)
from unnest(array['pages', 'sections', 'blocks', 'theme', 'published_snapshots']) t;

select throws_ok($$insert into public.pages (slug, title, position) values ('x', 'X', 9)$$, '42501', null, 'anon cannot create pages');
select throws_ok($$update public.sections set variant = 'overlay'$$, '42501', null, 'anon cannot update sections');
select throws_ok($$delete from public.blocks$$, '42501', null, 'anon cannot delete blocks');
select throws_ok($$update public.theme set preset = 'hacked'$$, '42501', null, 'anon cannot change the theme');
select throws_ok($$select public.build_content_v3(false)$$, '42501', null, 'anon cannot preview v3 drafts');
select throws_ok($$select public.restore_published_snapshot(gen_random_uuid())$$, '42501', null, 'anon cannot restore a version');

select is((public.get_published_content() ->> 'version')::int, 3, 'anon reads the live snapshot v3');
select is(jsonb_array_length(public.get_published_content() -> 'pages'), 1, 'the live snapshot has the home page');

reset role;

-- ===========================================================================
-- signed-in non-editor (Visitor)
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub": "33333333-3333-4333-8333-333333333333", "role": "authenticated"}', true);
set local role authenticated;

select is_empty('select * from public.' || t, 'non-editor sees no ' || t)
from unnest(array['pages', 'sections', 'blocks', 'theme', 'published_snapshots']) t;

select throws_ok($$insert into public.pages (slug, title, position) values ('x', 'X', 9)$$, '42501', null, 'non-editor cannot create pages');
select lives_ok($$update public.sections set variant = 'overlay' where type = 'hero'$$, 'non-editor section update runs');
select lives_ok($$update public.theme set preset = 'hacked'$$, 'non-editor theme update runs');
select lives_ok($$delete from public.blocks$$, 'non-editor block delete runs');
select throws_ok($$select public.restore_published_snapshot((select id from public.publish_runs limit 1))$$, '42501', null, 'non-editor cannot restore a version');

reset role;
select is((select variant from public.sections where type = 'hero'), 'default', 'the non-editor section update changed nothing');
select is((select preset::text from public.theme), 'classic', 'the non-editor theme update changed nothing');

-- ===========================================================================
-- editor (Cesart)
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.sections), 6, 'editor sees the draft sections');

select lives_ok(
  $$insert into public.pages (id, slug, title, status, position, updated_by)
    values ('00000000-0000-4000-8000-0000000000b1', 'commissions', 'Commissions', 'published', 1, '22222222-2222-4222-8222-222222222222')$$,
  'editor can create a page'
);
select lives_ok(
  $$insert into public.sections (id, page_id, type, position) values ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b1', 'text', 0)$$,
  'editor can add a section'
);
select lives_ok(
  $$insert into public.blocks (section_id, type, position, content)
    values ('00000000-0000-4000-8000-0000000000b2', 'paragraph', 0, '{"text": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Open for commissions"}]}]}}')$$,
  'editor can add a block'
);
select lives_ok($$update public.theme set tokens = jsonb_set(tokens, '{colors,light,accent}', '"#224488"')$$, 'editor can change the theme');

select is(
  (select updated_by from public.pages where slug = 'commissions'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'updated_by is the real caller, even when the client sends another id'
);
select results_eq(
  $$select actor_id, action from public.activity_log where table_name = 'theme'$$,
  $$values ('11111111-1111-4111-8111-111111111111'::uuid, 'update'::text)$$,
  'the theme change is in the activity log with its actor'
);

-- Drafts stay private until Publish.
select is(jsonb_array_length(public.get_published_content() -> 'pages'), 1, 'a new page is not live before Publish');
select is(jsonb_array_length(public.build_content_v3(false) -> 'pages'), 2, 'the v3 preview shows the new page');

select lives_ok($$select public.create_publish_run()$$, 'editor can publish');
select is(
  (select array_agg(p ->> 'slug' order by p ->> 'slug') from jsonb_array_elements(public.get_published_content() -> 'pages') p),
  array['commissions', 'home'],
  'after Publish the new page is live'
);
select is(public.get_published_content() #>> '{theme,tokens,colors,light,accent}', '#224488', 'after Publish the theme change is live');

reset role;
update public.publish_runs set status = 'succeeded', finished_at = now() where status = 'pending';
set local role authenticated;

select is((select count(*)::int from public.published_snapshots), 2, 'editor sees both published versions');

-- Restore the seeded version: the new page goes hidden, the theme comes back.
select lives_ok(
  $$select public.restore_published_snapshot((select id from public.published_snapshots where version = 1))$$,
  'editor can restore a version'
);
select is((select status::text from public.pages where slug = 'commissions'), 'hidden', 'a page that was not in the version is hidden, not deleted');
select is((select tokens #>> '{colors,light,accent}' from public.theme), '#8a3b2a', 'the theme is restored');
select is(
  (select actor_id from public.activity_log where action = 'restore'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'the restore is attributed to the editor'
);
select is(public.get_published_content() #>> '{theme,tokens,colors,light,accent}', '#224488', 'restoring does not publish');

reset role;

select * from finish();
rollback;
