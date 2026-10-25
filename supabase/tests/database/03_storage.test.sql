-- Storage policies on the `media` bucket. Objects are inserted as metadata rows
-- (what the Storage API does under the caller's JWT), so RLS is what decides.
-- The MIME allow-list and size limit live in the bucket config (00_structure).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- A published file (referenced by the seeded live snapshot) and a draft upload.
insert into storage.objects (bucket_id, name) values
  ('media', 'placeholder/illustration-01.jpg'),
  ('media', 'uploads/8d3c2f4e-0d2b-4a37-9d7e-6f1d8f7c1a11.gif');

-- ===========================================================================
-- anon
-- ===========================================================================
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;

select is(
  (select array_agg(name order by name) from storage.objects where bucket_id = 'media'),
  array['placeholder/illustration-01.jpg'],
  'anon can read published media only, not draft uploads'
);
select throws_ok($$insert into storage.objects (bucket_id, name) values ('media', 'uploads/anon.png')$$, '42501', null, 'anon cannot upload');
select lives_ok($$update storage.objects set name = 'uploads/moved.png' where bucket_id = 'media'$$, 'anon update runs');

reset role;
select is((select count(*)::int from storage.objects where name = 'uploads/moved.png'), 0, 'the anon update changed no object');

-- ===========================================================================
-- signed-in non-editor
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub": "33333333-3333-4333-8333-333333333333", "role": "authenticated"}', true);
set local role authenticated;

select is(
  (select array_agg(name order by name) from storage.objects where bucket_id = 'media'),
  array['placeholder/illustration-01.jpg'],
  'non-editor can read published media only'
);
select throws_ok($$insert into storage.objects (bucket_id, name) values ('media', 'uploads/visitor.png')$$, '42501', null, 'non-editor cannot upload');

reset role;

-- ===========================================================================
-- editor
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from storage.objects where bucket_id = 'media'), 2, 'editor sees draft uploads too');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('media', 'uploads/0b9e7c64-1f4a-4f0e-9a43-2c8d5e6f7a80.webm')$$, 'editor can upload an allowed file');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('media', 'uploads/still.JPG')$$, 'extension check is case-insensitive');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('media', 'uploads/vector.svg')$$, '42501', null, 'editor cannot upload a disallowed extension');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('media', 'uploads/../escape.png')$$, '42501', null, 'editor cannot upload with ".." in the key');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('media', '/uploads/abs.png')$$, '42501', null, 'editor cannot upload with a leading slash');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('media', 'uploads/.hidden.png')$$, '42501', null, 'editor cannot upload a hidden file');
select throws_ok($$update storage.objects set name = 'uploads/renamed.exe' where name = 'uploads/still.JPG'$$, '42501', null, 'editor cannot rename to a disallowed extension');

select lives_ok($$
  select set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where name = 'uploads/still.JPG'
$$, 'editor can delete an object');

reset role;
select is((select count(*)::int from storage.objects where name = 'uploads/still.JPG'), 0, 'the object is gone');

select * from finish();
rollback;
