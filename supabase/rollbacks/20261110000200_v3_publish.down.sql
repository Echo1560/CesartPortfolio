-- Undo 20261110000200_v3_publish.sql: back to v2 snapshots. Existing v3
-- snapshots stay in publish_runs (they are a superset of v2 Content, so the v2
-- build still reads them). Restore entries in activity_log are deleted.
drop function if exists public.restore_published_snapshot(uuid);
delete from public.activity_log where action = 'restore';
alter table public.activity_log drop constraint activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check
  check (action in ('insert', 'update', 'delete', 'publish', 'invite', 'disable', 'enable', 'remove'));
drop view if exists public.published_snapshots;

-- v2 definitions, from 20261025000300_publish.sql.
create or replace function public.snapshot_media_paths(p_snapshot jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct v order by v), '{}')
  from (
    select jsonb_path_query(p_snapshot, 'lax $.**.src') #>> '{}' as v
    union all
    select jsonb_path_query(p_snapshot, 'lax $.**.poster') #>> '{}'
    union all
    select p_snapshot #>> '{site,meta,ogImage}'
  ) x
  where v is not null and v !~* '^[a-z]+:';
$$;

create or replace function public.create_publish_run()
returns public.publish_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  snap jsonb;
  run public.publish_runs;
begin
  if not public.is_editor() then
    raise exception 'only editors can publish' using errcode = '42501';
  end if;
  -- Serialise publishes so two simultaneous clicks cannot both pass the check below.
  perform pg_advisory_xact_lock(hashtext('public.publish_runs.create'));
  if exists (
    select 1 from public.publish_runs
    where status in ('pending', 'dispatched', 'building') and requested_at > now() - interval '15 minutes'
  ) then
    raise exception 'a publish is already in progress' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.media_placements where slot = 'hero') then
    raise exception 'the hero needs media before publishing' using errcode = 'PT422';
  end if;
  if not exists (select 1 from public.categories) then
    raise exception 'at least one category is required before publishing' using errcode = 'PT422';
  end if;

  snap := public.build_content(true);

  insert into public.publish_runs (requested_by, snapshot, media_paths, content_hash)
  values ((select auth.uid()), snap, public.snapshot_media_paths(snap), encode(extensions.digest(snap::text, 'sha256'), 'hex'))
  returning * into run;

  perform public.write_activity('publish', 'publish_runs', run.id::text, jsonb_build_object('content_hash', run.content_hash));
  return run;
end;
$$;

drop function if exists public.build_content_v3(boolean);
drop function if exists public.unresolve_media_refs(jsonb);
drop function if exists public.resolve_media_refs(jsonb);
drop function if exists public.resolve_media_ref(jsonb);
drop function if exists public.json_omit_nulls(jsonb);
