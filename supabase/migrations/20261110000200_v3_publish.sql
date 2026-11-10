-- v3 publish: the snapshot gains pages, theme, nav and footer; published
-- versions are listed in `published_snapshots` and can be restored into the draft.
-- Contract: docs/V3-CONTRACTS.md §5-6. Rollback: supabase/rollbacks/20261110000200_v3_publish.down.sql
--
-- Transition: snapshot v3 is a superset of the v2 Content ({site, works}).
-- `site` keeps every v2 field, so the v2 build still validates it until the
-- v3 loader replaces it (TITA-90 stage 2).

-- ---------------------------------------------------------------------------
-- JSON helpers
-- ---------------------------------------------------------------------------

-- Drops top-level keys whose value is JSON null. Unlike jsonb_strip_nulls it
-- does not touch nested values (theme.colors.dark may legitimately be null).
create function public.json_omit_nulls(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from jsonb_each(p)
  where jsonb_typeof(value) <> 'null';
$$;

-- One draft MediaRef ({mediaId, posterId?, alt?, loop?, focal?, width?, height?})
-- as a snapshot Media (the v2 Media fields plus mediaId/posterId/focal).
-- Errors (PT422): unknown file, poster that is not an image, no alt text,
-- no dimensions, video without poster.
create function public.resolve_media_ref(p_ref jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  m public.media;
  pm public.media;
  alt text;
begin
  select * into m from public.media where id = (p_ref ->> 'mediaId')::uuid;
  if not found then
    raise exception 'media % does not exist', p_ref ->> 'mediaId' using errcode = 'PT422';
  end if;
  if p_ref ? 'posterId' then
    select * into pm from public.media where id = (p_ref ->> 'posterId')::uuid;
    if not found or pm.kind <> 'image' then
      raise exception 'poster % for media % is not an image in the library', p_ref ->> 'posterId', m.storage_path using errcode = 'PT422';
    end if;
  end if;
  alt := coalesce(nullif(btrim(p_ref ->> 'alt'), ''), nullif(btrim(m.default_alt), ''));
  if alt is null then
    raise exception 'media % needs alt text', m.storage_path using errcode = 'PT422';
  end if;
  if coalesce((p_ref ->> 'width')::integer, m.width) is null or coalesce((p_ref ->> 'height')::integer, m.height) is null then
    raise exception 'media % has no width/height', m.storage_path using errcode = 'PT422';
  end if;
  if m.kind = 'video' and pm.id is null then
    raise exception 'video % needs a poster image', m.storage_path using errcode = 'PT422';
  end if;
  return public.json_omit_nulls(jsonb_build_object(
    'mediaId', m.id,
    'posterId', pm.id,
    'type', m.kind,
    'src', m.storage_path::text,
    'alt', alt,
    'width', coalesce((p_ref ->> 'width')::integer, m.width),
    'height', coalesce((p_ref ->> 'height')::integer, m.height),
    'poster', pm.storage_path::text,
    'loop', p_ref -> 'loop',
    'focal', p_ref -> 'focal'
  ));
end;
$$;

-- Replaces every MediaRef (an object with "mediaId") inside a JSON value.
create function public.resolve_media_refs(p jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  r jsonb;
begin
  case jsonb_typeof(p)
    when 'object' then
      if p ? 'mediaId' then
        return public.resolve_media_ref(p);
      end if;
      select coalesce(jsonb_object_agg(e.key, public.resolve_media_refs(e.value)), '{}'::jsonb) into r from jsonb_each(p) e;
      return r;
    when 'array' then
      select coalesce(jsonb_agg(public.resolve_media_refs(e.value) order by e.ord), '[]'::jsonb) into r
      from jsonb_array_elements(p) with ordinality as e(value, ord);
      return r;
    else
      return p;
  end case;
end;
$$;

-- The reverse, for restore: a snapshot Media back to a draft MediaRef.
-- Library dimensions are dropped (they come from the media row again) unless the
-- row has none. Errors (PT422): the file was deleted from the library since.
create function public.unresolve_media_refs(p jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  r jsonb;
  m public.media;
begin
  case jsonb_typeof(p)
    when 'object' then
      if p ? 'mediaId' then
        select * into m from public.media where id = (p ->> 'mediaId')::uuid;
        if not found then
          raise exception 'this version uses media % (%), which has been deleted from the library', p ->> 'mediaId', p ->> 'src'
            using errcode = 'PT422';
        end if;
        if p ? 'posterId' and not exists (select 1 from public.media where id = (p ->> 'posterId')::uuid) then
          raise exception 'this version uses poster % (%), which has been deleted from the library', p ->> 'posterId', p ->> 'poster'
            using errcode = 'PT422';
        end if;
        return public.json_omit_nulls(jsonb_build_object(
          'mediaId', p -> 'mediaId',
          'posterId', p -> 'posterId',
          'alt', p -> 'alt',
          'loop', p -> 'loop',
          'focal', p -> 'focal',
          'width', case when m.width is null or m.width <> (p ->> 'width')::integer then p -> 'width' end,
          'height', case when m.height is null or m.height <> (p ->> 'height')::integer then p -> 'height' end
        ));
      end if;
      select coalesce(jsonb_object_agg(e.key, public.unresolve_media_refs(e.value)), '{}'::jsonb) into r from jsonb_each(p) e;
      return r;
    when 'array' then
      select coalesce(jsonb_agg(public.unresolve_media_refs(e.value) order by e.ord), '[]'::jsonb) into r
      from jsonb_array_elements(p) with ordinality as e(value, ord);
      return r;
    else
      return p;
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- Snapshot v3
-- ---------------------------------------------------------------------------

-- Assembles snapshot v3 (SnapshotV3 in schema-v3.ts) from the draft tables.
--   p_published_only = true:  published pages and works (what Publish freezes)
--   p_published_only = false: every page and every non-archived work (preview)
-- Sections and blocks hidden on every device are left out.
-- SECURITY INVOKER: RLS applies, so only editors (or the service role) see rows.
create function public.build_content_v3(p_published_only boolean default true)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  base jsonb := public.build_content(p_published_only);
  s public.site;
  theme_json jsonb;
  pages_json jsonb;
begin
  select * into s from public.site where id = 1;

  select jsonb_build_object('preset', t.preset, 'tokens', t.tokens) into theme_json from public.theme t where t.id = 1;
  if theme_json is null then
    raise exception 'build_content_v3: the theme row is missing' using errcode = 'PT422';
  end if;

  select coalesce(jsonb_agg(
           public.json_omit_nulls(jsonb_build_object(
             'id', p.id,
             'slug', p.slug,
             'title', p.title,
             'status', p.status,
             'isHome', p.is_home,
             'seo', public.json_omit_nulls(jsonb_build_object(
               'title', p.seo_title,
               'description', p.seo_description,
               'ogImage', sm.storage_path::text,
               'ogImageId', sm.id
             )),
             'sections', coalesce((
               select jsonb_agg(
                        public.json_omit_nulls(jsonb_build_object(
                          'id', se.id,
                          'type', se.type,
                          'variant', se.variant,
                          'settings', public.resolve_media_refs(se.settings),
                          'content', public.resolve_media_refs(se.content),
                          'visibility', jsonb_build_object('desktop', se.show_on_desktop, 'tablet', se.show_on_tablet, 'mobile', se.show_on_mobile),
                          'blocks', case when se.type in ('text', 'columns') then coalesce((
                            select jsonb_agg(
                                     jsonb_build_object(
                                       'id', b.id,
                                       'type', b.type,
                                       'column', b.column_index,
                                       'settings', public.resolve_media_refs(b.settings),
                                       'content', public.resolve_media_refs(b.content),
                                       'visibility', jsonb_build_object('desktop', b.show_on_desktop, 'tablet', b.show_on_tablet, 'mobile', b.show_on_mobile)
                                     )
                                     order by b.column_index, b.position)
                            from public.blocks b
                            where b.section_id = se.id and (b.show_on_desktop or b.show_on_tablet or b.show_on_mobile)
                          ), '[]'::jsonb) end
                        ))
                        order by se.position)
               from public.sections se
               where se.page_id = p.id and (se.show_on_desktop or se.show_on_tablet or se.show_on_mobile)
             ), '[]'::jsonb)
           ))
           order by p.position), '[]'::jsonb)
    into pages_json
  from public.pages p
  left join public.media sm on sm.id = p.social_media_id
  where not p_published_only or p.status = 'published';

  return jsonb_build_object(
    'version', 3,
    'site', (base -> 'site') || jsonb_build_object(
      'nav', s.nav,
      'footer', s.footer,
      'socials', base #> '{site,contact,socials}'
    ),
    'theme', theme_json,
    'pages', pages_json,
    'works', base -> 'works'
  );
end;
$$;

-- Bucket object keys referenced by a snapshot (v2 or v3): every src, poster
-- and ogImage. Embed URLs are skipped.
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
    select jsonb_path_query(p_snapshot, 'lax $.**.ogImage') #>> '{}'
  ) x
  where v is not null and v !~* '^[a-z]+:';
$$;

-- Same contract as v2 (errors 42501, PT409, PT422), now freezing snapshot v3.
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
  perform pg_advisory_xact_lock(hashtext('public.publish_runs.create'));
  if exists (
    select 1 from public.publish_runs
    where status in ('pending', 'dispatched', 'building') and requested_at > now() - interval '15 minutes'
  ) then
    raise exception 'a publish is already in progress' using errcode = 'PT409';
  end if;
  -- v2 rules, still needed while the v2 build reads snapshot.site.
  if not exists (select 1 from public.media_placements where slot = 'hero') then
    raise exception 'the hero needs media before publishing' using errcode = 'PT422';
  end if;
  if not exists (select 1 from public.categories) then
    raise exception 'at least one category is required before publishing' using errcode = 'PT422';
  end if;
  if not exists (select 1 from public.pages where is_home) then
    raise exception 'a home page is required before publishing' using errcode = 'PT422';
  end if;

  snap := public.build_content_v3(true);

  insert into public.publish_runs (requested_by, snapshot, media_paths, content_hash)
  values ((select auth.uid()), snap, public.snapshot_media_paths(snap), encode(extensions.digest(snap::text, 'sha256'), 'hex'))
  returning * into run;

  perform public.write_activity('publish', 'publish_runs', run.id::text, jsonb_build_object('content_hash', run.content_hash));
  return run;
end;
$$;

-- ---------------------------------------------------------------------------
-- Version history
-- ---------------------------------------------------------------------------

-- Every succeeded publish, newest first in the UI. `version` counts from 1.
-- security_invoker: the publish_runs/editors RLS of the caller applies.
create view public.published_snapshots
with (security_invoker = true)
as
select
  r.id,
  row_number() over (order by r.requested_at, r.id)::integer as version,
  coalesce((r.snapshot ->> 'version')::integer, 2) as schema_version,
  r.requested_at as published_at,
  r.requested_by as published_by,
  e.display_name as published_by_name,
  r.content_hash,
  r.id = (
    select l.id from public.publish_runs l
    where l.status <> 'failed'
    order by l.requested_at desc, l.id desc
    limit 1
  ) as is_live,
  r.snapshot
from public.publish_runs r
left join public.editors e on e.user_id = r.requested_by
where r.status = 'succeeded';

comment on view public.published_snapshots is 'Version history: succeeded publishes. Restore one with restore_published_snapshot(id).';

alter table public.activity_log drop constraint activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check
  check (action in ('insert', 'update', 'delete', 'publish', 'invite', 'disable', 'enable', 'remove', 'restore'));

-- Copies a published v3 snapshot back into the DRAFT: theme, nav, footer and
-- every page it contains (with their sections and blocks). It does not publish.
--   - Pages in the snapshot get their old id, slug, settings and sections back, as published.
--   - Published pages that are not in it are set to `hidden`, never deleted.
--   - Draft and hidden pages that are not in it are kept; one whose slug the
--     snapshot needs is renamed to <slug>-<6 hex>.
--   - Works, categories, socials and the media library are not touched.
-- Errors: 42501 not an editor, PT404 unknown or unsucceeded run, PT422 not a v3
-- snapshot or it uses media that has been deleted since.
create function public.restore_published_snapshot(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  snap jsonb;
  page_ids uuid[];
  home_id uuid;
begin
  if not public.is_editor() then
    raise exception 'only editors can restore a version' using errcode = '42501';
  end if;
  select r.snapshot into snap from public.publish_runs r where r.id = p_run_id and r.status = 'succeeded';
  if not found then
    raise exception 'published version % not found', p_run_id using errcode = 'PT404';
  end if;
  if coalesce((snap ->> 'version')::integer, 2) <> 3 then
    raise exception 'only v3 versions can be restored' using errcode = 'PT422';
  end if;

  -- Serialise with publishes and other restores.
  perform pg_advisory_xact_lock(hashtext('public.publish_runs.create'));

  update public.theme set preset = snap #>> '{theme,preset}', tokens = snap #> '{theme,tokens}' where id = 1;
  update public.site set nav = snap #> '{site,nav}', footer = snap #> '{site,footer}' where id = 1;

  select coalesce(array_agg((p ->> 'id')::uuid), '{}') into page_ids from jsonb_array_elements(snap -> 'pages') p;
  select (p ->> 'id')::uuid into home_id from jsonb_array_elements(snap -> 'pages') p where (p ->> 'isHome')::boolean;

  -- Free the home flag and the slugs the snapshot needs.
  update public.pages set is_home = false where is_home and id is distinct from home_id;
  update public.pages set status = 'hidden' where status = 'published' and id <> all (page_ids);
  update public.pages pg
     set slug = left(pg.slug::text, 90) || '-' || left(md5(pg.id::text), 6)
   where pg.id <> all (page_ids)
     and pg.slug::text in (select p ->> 'slug' from jsonb_array_elements(snap -> 'pages') p);
  update public.pages set slug = 'restoring-' || left(md5(id::text), 12) where id = any (page_ids);

  insert into public.pages (id, slug, title, seo_title, seo_description, social_media_id, status, is_home, position)
  select (p ->> 'id')::uuid, p ->> 'slug', p ->> 'title', p #>> '{seo,title}', p #>> '{seo,description}',
         (select m.id from public.media m where m.id = (p #>> '{seo,ogImageId}')::uuid),
         'published', coalesce((p ->> 'isHome')::boolean, false), -1000000 + ord::integer
  from jsonb_array_elements(snap -> 'pages') with ordinality as x(p, ord)
  on conflict (id) do update
    set slug = excluded.slug, title = excluded.title, seo_title = excluded.seo_title,
        seo_description = excluded.seo_description, social_media_id = excluded.social_media_id,
        status = excluded.status, is_home = excluded.is_home, position = excluded.position;

  -- Snapshot pages first, in snapshot order, then the others in their old order.
  update public.pages pg set position = o.n
  from (select id, (row_number() over (order by position, id) - 1)::integer as n from public.pages) o
  where pg.id = o.id and pg.position is distinct from o.n;

  delete from public.sections
   where page_id = any (page_ids)
      or id in (select (s ->> 'id')::uuid from jsonb_array_elements(snap -> 'pages') p, jsonb_array_elements(p -> 'sections') s);

  insert into public.sections (id, page_id, type, variant, position, settings, content, show_on_desktop, show_on_tablet, show_on_mobile)
  select (s ->> 'id')::uuid, (p ->> 'id')::uuid, (s ->> 'type')::public.section_type, s ->> 'variant', sord::integer,
         public.unresolve_media_refs(coalesce(s -> 'settings', '{}'::jsonb)),
         public.unresolve_media_refs(coalesce(s -> 'content', '{}'::jsonb)),
         coalesce((s #>> '{visibility,desktop}')::boolean, true),
         coalesce((s #>> '{visibility,tablet}')::boolean, true),
         coalesce((s #>> '{visibility,mobile}')::boolean, true)
  from jsonb_array_elements(snap -> 'pages') p,
       jsonb_array_elements(p -> 'sections') with ordinality as x(s, sord);

  insert into public.blocks (id, section_id, type, column_index, position, settings, content, show_on_desktop, show_on_tablet, show_on_mobile)
  select (b ->> 'id')::uuid, (s ->> 'id')::uuid, (b ->> 'type')::public.block_type, coalesce((b ->> 'column')::smallint, 0), bord::integer,
         public.unresolve_media_refs(coalesce(b -> 'settings', '{}'::jsonb)),
         public.unresolve_media_refs(coalesce(b -> 'content', '{}'::jsonb)),
         coalesce((b #>> '{visibility,desktop}')::boolean, true),
         coalesce((b #>> '{visibility,tablet}')::boolean, true),
         coalesce((b #>> '{visibility,mobile}')::boolean, true)
  from jsonb_array_elements(snap -> 'pages') p,
       jsonb_array_elements(p -> 'sections') s,
       jsonb_array_elements(coalesce(s -> 'blocks', '[]'::jsonb)) with ordinality as x(b, bord);

  perform public.write_activity('restore', 'publish_runs', p_run_id::text,
    jsonb_build_object('content_hash', (select content_hash from public.publish_runs where id = p_run_id)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.json_omit_nulls(jsonb),
  public.resolve_media_ref(jsonb),
  public.resolve_media_refs(jsonb),
  public.unresolve_media_refs(jsonb),
  public.build_content_v3(boolean),
  public.restore_published_snapshot(uuid)
from public, anon, authenticated;

-- build_content_v3 is SECURITY INVOKER, so editors need its helpers too.
grant execute on function
  public.json_omit_nulls(jsonb),
  public.resolve_media_ref(jsonb),
  public.resolve_media_refs(jsonb),
  public.build_content_v3(boolean),
  public.restore_published_snapshot(uuid)
to authenticated;
grant execute on function
  public.json_omit_nulls(jsonb),
  public.resolve_media_ref(jsonb),
  public.resolve_media_refs(jsonb),
  public.unresolve_media_refs(jsonb),
  public.build_content_v3(boolean),
  public.restore_published_snapshot(uuid)
to service_role;

revoke all on public.published_snapshots from anon, authenticated;
grant select on public.published_snapshots to authenticated;
