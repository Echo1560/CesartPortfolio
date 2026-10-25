-- Account management is owner-only and can never remove the last active owner.
-- Publish runs are serialised and finished runs are final. Layout options match zod.
--
-- Seed: Cesart and Echo 1560 are owners; Visitor has no editor row.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- An invited account (role 'editor'). The auth user is created by the Auth admin
-- API in real life; here we insert it directly.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'invited@example.com', '', now(), '{}', '{}', now(), now());

-- ===========================================================================
-- invite (service role, as the invite-editor Edge Function)
-- ===========================================================================
set local role service_role;
select lives_ok(
  $$select public.register_invited_editor('44444444-4444-4444-8444-444444444444', 'invited@example.com', 'Invited', '11111111-1111-4111-8111-111111111111')$$,
  'an owner can invite an editor'
);
select is((select role::text from public.editors where user_id = '44444444-4444-4444-8444-444444444444'), 'editor', 'invited accounts get role editor');
select throws_ok(
  $$select public.register_invited_editor('33333333-3333-4333-8333-333333333333', 'visitor@example.com', 'Visitor', '44444444-4444-4444-8444-444444444444')$$,
  '42501', null, 'a non-owner editor cannot invite'
);
reset role;

-- ===========================================================================
-- a plain editor can edit content but cannot manage accounts
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-8444-444444444444", "role": "authenticated"}', true);
set local role authenticated;

select ok(public.is_editor(), 'the invited editor is an editor');
select ok(not public.is_owner(), 'the invited editor is not an owner');
select lives_ok($$update public.works set title = 'Edited by invitee' where id = 'placeholder-illustration-02'$$, 'an editor can edit content');
select throws_ok($$select public.set_editor_disabled('22222222-2222-4222-8222-222222222222', true)$$, '42501', null, 'an editor cannot disable an owner');
select throws_ok($$select public.remove_editor('11111111-1111-4111-8111-111111111111')$$, '42501', null, 'an editor cannot remove an owner');
select throws_ok($$select public.set_editor_disabled('44444444-4444-4444-8444-444444444444', true)$$, '42501', null, 'an editor cannot manage any account, not even their own');
reset role;

select is((select count(*)::int from public.editors where role = 'owner' and disabled_at is null), 2, 'both owners are still active');

-- ===========================================================================
-- owners manage accounts; the last active owner is protected
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok($$select public.set_editor_disabled('44444444-4444-4444-8444-444444444444', true)$$, 'an owner can disable an editor');
select lives_ok($$select public.set_editor_disabled('44444444-4444-4444-8444-444444444444', false)$$, 'an owner can re-enable an editor');
select lives_ok($$select public.remove_editor('44444444-4444-4444-8444-444444444444')$$, 'an owner can remove an editor');
select lives_ok($$select public.set_editor_disabled('11111111-1111-4111-8111-111111111111', true)$$, 'an owner can disable another owner while one stays active');
-- Echo is now the only active owner.
select throws_ok($$select public.set_editor_disabled('22222222-2222-4222-8222-222222222222', true)$$, 'PT409', 'cannot disable the last active owner', 'the last active owner cannot be disabled');
select throws_ok($$select public.remove_editor('22222222-2222-4222-8222-222222222222')$$, 'PT409', 'cannot remove the last active owner', 'the last active owner cannot be removed');
reset role;

select is(
  (select array_agg(details #>> '{changed,disabled_at,new}' is not null order by id) from public.activity_log
   where table_name = 'editors' and row_id = '11111111-1111-4111-8111-111111111111'),
  array[true],
  'disabling is logged once, by the audit trigger'
);
select is(
  (select actor_id from public.activity_log where table_name = 'editors' and row_id = '11111111-1111-4111-8111-111111111111'),
  '22222222-2222-4222-8222-222222222222'::uuid,
  'the account change is attributed to the owner who made it'
);

-- ===========================================================================
-- publish runs: finished runs are final
-- ===========================================================================
set local role service_role;
select throws_ok(
  $$select public.update_publish_run((select id from public.publish_runs where status = 'succeeded' limit 1), 'pending')$$,
  'PT409', null, 'a succeeded run cannot be reopened'
);
select throws_ok($$select public.update_publish_run(gen_random_uuid(), 'building')$$, 'PT404', null, 'an unknown run is rejected');
reset role;

-- ===========================================================================
-- layout options: grid columns must be complete integers (same as zod)
-- ===========================================================================
select throws_ok($$update public.layout set options = '{"columns": {}}' where section_id = 'grid'$$, '23514', null, 'grid columns must have sm, md and lg');
select throws_ok($$update public.layout set options = '{"columns": {"sm": "2", "md": "3", "lg": "4"}}' where section_id = 'grid'$$, '23514', null, 'grid columns must be numbers, not strings');

select * from finish();
rollback;
