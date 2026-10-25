-- Undo 20261025000600_storage.sql. Objects in the bucket must be deleted through
-- the Storage API first (the bucket cannot be dropped while it has objects).
begin;
drop policy if exists media_published_select on storage.objects;
drop policy if exists media_editors_delete on storage.objects;
drop policy if exists media_editors_update on storage.objects;
drop policy if exists media_editors_insert on storage.objects;
drop policy if exists media_editors_select on storage.objects;
drop function if exists public.is_valid_media_key(text);
-- storage.protect_delete() blocks direct deletes unless this is set.
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.buckets where id = 'media';
commit;
