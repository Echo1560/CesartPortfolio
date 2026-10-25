-- RLS on content: anon reads published content only and cannot write; signed-in
-- non-editors cannot read drafts or write; editors can do everything; every
-- change is attributed in updated_by and activity_log.
--
-- Users come from seed.sql: Cesart (editor), Echo 1560 (editor), Visitor (no editor row).
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

-- ===========================================================================
-- anon
-- ===========================================================================
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;

select throws_ok('select * from public.works', '42501', null, 'anon cannot select draft works');
select throws_ok('select * from public.site', '42501', null, 'anon cannot select the draft site');
select throws_ok('select * from public.categories', '42501', null, 'anon cannot select draft categories');
select throws_ok('select * from public.media', '42501', null, 'anon cannot select the media library');
select throws_ok('select * from public.media_placements', '42501', null, 'anon cannot select media placements');
select throws_ok('select * from public.layout', '42501', null, 'anon cannot select the draft layout');
select throws_ok('select * from public.editors', '42501', null, 'anon cannot select editors');
select throws_ok('select * from public.activity_log', '42501', null, 'anon cannot select the activity log');
select throws_ok('select * from public.events', '42501', null, 'anon cannot select events');
select throws_ok('select * from public.publish_runs', '42501', null, 'anon cannot select publish runs');

select ok(public.get_published_content() is not null, 'anon can read the published content');
select is(jsonb_array_length(public.get_published_content() -> 'works'), 11, 'published content has the 11 seeded works');

select throws_ok($$insert into public.categories (id, slug, label) values ('x', 'x', 'X')$$, '42501', null, 'anon cannot insert');
select throws_ok($$update public.works set title = 'hacked'$$, '42501', null, 'anon cannot update');
select throws_ok($$delete from public.works$$, '42501', null, 'anon cannot delete');
select throws_ok($$insert into public.events (name, path) values ('page_view', '/')$$, '42501', null, 'anon cannot insert events directly');
select throws_ok($$select public.record_event('page_view', '/')$$, '42501', null, 'anon cannot call record_event()');
select throws_ok($$select public.build_content(false)$$, '42501', null, 'anon cannot preview drafts');
select throws_ok($$select public.create_publish_run()$$, '42501', null, 'anon cannot publish');

reset role;

-- ===========================================================================
-- signed-in non-editor (Visitor)
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub": "33333333-3333-4333-8333-333333333333", "role": "authenticated"}', true);
set local role authenticated;

select is_empty('select * from public.works', 'non-editor sees no draft works');
select is_empty('select * from public.site', 'non-editor sees no draft site');
select is_empty('select * from public.activity_log', 'non-editor sees no activity log');
select is_empty('select * from public.events', 'non-editor sees no events');
select is((select count(*)::int from public.editors), 0, 'non-editor sees no editor rows (has none of their own)');

select throws_ok($$insert into public.categories (id, slug, label) values ('x', 'x', 'X')$$, '42501', null, 'non-editor cannot insert');
-- UPDATE/DELETE under RLS silently match zero rows; checked as postgres below.
select lives_ok($$update public.works set title = 'hacked'$$, 'non-editor update runs');
select lives_ok($$delete from public.categories$$, 'non-editor delete runs');
select throws_ok($$select public.create_publish_run()$$, '42501', null, 'non-editor cannot publish');
select throws_ok($$select * from public.stats_overview(now() - interval '7 days', now())$$, '42501', null, 'non-editor cannot read stats');
select throws_ok($$select public.set_editor_disabled('11111111-1111-4111-8111-111111111111', true)$$, '42501', null, 'non-editor cannot disable an editor');

reset role;
select is((select count(*)::int from public.works where title = 'hacked'), 0, 'the non-editor update changed no row');
select is((select count(*)::int from public.categories), 2, 'the non-editor delete removed no row');

-- ===========================================================================
-- editor (Cesart)
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.works), 11, 'editor sees all draft works');
select is((select count(*)::int from public.editors), 2, 'editor sees both editors');

select lives_ok($$insert into public.categories (id, slug, label, position) values ('sketches', 'sketches', 'Sketches', 9)$$, 'editor can insert a category');
select lives_ok($$update public.works set title = 'Renamed by Cesart', updated_by = '22222222-2222-4222-8222-222222222222' where id = 'placeholder-illustration-01'$$, 'editor can update a work');
select lives_ok($$delete from public.categories where id = 'sketches'$$, 'editor can delete a category');

select is(
  (select updated_by from public.works where id = 'placeholder-illustration-01'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'updated_by is the real caller, even when the client sends another id'
);

select results_eq(
  $$select actor_id, actor_name, action, details #>> '{changed,title,new}'
    from public.activity_log where table_name = 'works' and row_id = 'placeholder-illustration-01'$$,
  $$values ('11111111-1111-4111-8111-111111111111'::uuid, 'Cesart'::text, 'update'::text, 'Renamed by Cesart'::text)$$,
  'activity_log records the actor, action and changed field'
);
select is(
  (select array_agg(action order by id) from public.activity_log where table_name = 'categories' and row_id = 'sketches'),
  array['insert', 'delete'],
  'activity_log records inserts and deletes'
);
select throws_ok($$insert into public.activity_log (action, table_name) values ('update', 'works')$$, '42501', null, 'editors cannot forge activity_log rows');
select throws_ok($$update public.editors set role = 'owner' where user_id = '11111111-1111-4111-8111-111111111111'$$, '42501', null, 'editors cannot change roles directly');

-- Drafts stay private until Publish.
select is(public.get_published_content() #>> '{works,0,title}', 'Placeholder Illustration 01', 'an unpublished edit is not live');
select is(public.build_content(false) #>> '{works,0,title}', 'Renamed by Cesart', 'the preview shows the draft edit');

select lives_ok($$select public.create_publish_run()$$, 'editor can publish');
select is(public.get_published_content() #>> '{works,0,title}', 'Renamed by Cesart', 'after Publish the edit is live');
select throws_ok($$select public.create_publish_run()$$, 'PT409', null, 'a second publish while one is in flight is rejected');
select is(
  (select actor_id from public.activity_log where action = 'publish'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'the publish is attributed to the editor'
);

reset role;

-- The anon view of the live content follows the publish.
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select is(public.get_published_content() #>> '{works,0,title}', 'Renamed by Cesart', 'anon sees the newly published content');
reset role;

-- ===========================================================================
-- disabled editor: Echo disables Cesart, who then loses all access
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.set_editor_disabled('22222222-2222-4222-8222-222222222222', true)$$, 'PT409', null, 'an editor cannot disable themself');
select lives_ok($$select public.set_editor_disabled('11111111-1111-4111-8111-111111111111', true)$$, 'an editor can disable another editor');
reset role;

select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.works), 0, 'a disabled editor sees no drafts');
reset role;

select * from finish();
rollback;
