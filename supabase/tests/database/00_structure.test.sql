-- Structural guards: RLS everywhere, nothing exposed to anon, audit columns and
-- triggers on every editable table. Fails if a later migration forgets one.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select is(
  (select coalesce(array_agg(c.relname::text order by c.relname), '{}')
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  '{}'::text[],
  'every table in public has row level security enabled'
);

select is(
  (select coalesce(array_agg(distinct table_name::text order by table_name::text), '{}')
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'),
  '{}'::text[],
  'anon has no privilege on any public table or view'
);

select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
     and p.prokind = 'f'),
  array['get_published_content', 'is_published_media'],
  'anon can execute only get_published_content() and is_published_media()'
);

select is(
  (select coalesce(array_agg(t order by t), '{}') from unnest(array['editors', 'media', 'site', 'socials', 'categories', 'works',
     'media_placements', 'layout', 'layout_featured_works']) t
   where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = 'updated_by')
      or not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = 'updated_at')),
  '{}'::text[],
  'every editable table has updated_by and updated_at'
);

select is(
  (select coalesce(array_agg(t order by t), '{}') from unnest(array['editors', 'media', 'site', 'socials', 'categories', 'works',
     'media_placements', 'layout', 'layout_featured_works']) t
   where not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t)::regclass and g.tgname = t || '_set_audit_fields')
      or not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t)::regclass and g.tgname = t || '_log_activity')),
  '{}'::text[],
  'every editable table has the audit and activity triggers'
);

select ok(
  (select not public from storage.buckets where id = 'media'),
  'the media bucket is private (reads go through RLS)'
);

select is(
  (select file_size_limit from storage.buckets where id = 'media'),
  26214400::bigint,
  'the media bucket limits uploads to 25 MiB'
);

select is(
  (select array(select unnest(allowed_mime_types) order by 1) from storage.buckets where id = 'media'),
  array['image/gif', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'],
  'the media bucket allows only gif/png/jpg/webp/mp4/webm'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'storage.objects has row level security enabled'
);

select * from finish();
rollback;
