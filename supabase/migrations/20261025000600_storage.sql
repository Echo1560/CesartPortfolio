-- Storage: one private bucket `media` for every uploaded file.
--   - MIME allow-list and 25 MiB size limit enforced by the Storage API (bucket config).
--   - Object keys must follow the path convention and use an allowed extension (RLS).
--   - Editors: full CRUD. Anon/others: read only objects referenced by the live
--     snapshot (the build downloads these). Draft uploads stay private.
-- Rollback: supabase/rollbacks/20261025000600_storage.down.sql

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  26214400, -- 25 MiB, same as media.bytes check
  array['image/gif', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path convention: "<folder>/<segments...>/<name>.<ext>", e.g.
--   uploads/2f6c0a8e-....gif          (dashboard uploads: uploads/<uuid>.<ext>)
--   placeholder/illustration-01.jpg   (imported from content/media/, same path)
-- No leading slash, no "..", no hidden segments, allowed extensions only.
create function public.is_valid_media_key(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name ~ '^[a-z0-9][a-z0-9-]*(/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$'
     and p_name ~* '\.(gif|png|jpe?g|webp|mp4|webm)$'
     and length(p_name) <= 300
     and not ('..' = any (string_to_array(p_name, '/')));
$$;

revoke execute on function public.is_valid_media_key(text) from public;
grant execute on function public.is_valid_media_key(text) to authenticated, service_role;

create policy media_editors_select on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (select public.is_editor()));

create policy media_editors_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (select public.is_editor()) and public.is_valid_media_key(name));

create policy media_editors_update on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and (select public.is_editor()))
  with check (bucket_id = 'media' and (select public.is_editor()) and public.is_valid_media_key(name));

create policy media_editors_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (select public.is_editor()));

-- Public read of published media only (used by the build with the anon key).
create policy media_published_select on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'media' and public.is_published_media(name));
