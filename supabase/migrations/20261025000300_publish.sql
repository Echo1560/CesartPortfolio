-- Draft -> published. build_content() assembles the zod `Content` shape
-- ({site, works}, see src/lib/schema.ts) from the draft tables. Publishing
-- freezes that JSON into publish_runs.snapshot; the public build reads only the
-- latest live snapshot via get_published_content().
-- Rollback: supabase/rollbacks/20261025000300_publish.down.sql

create type public.publish_status as enum ('pending', 'dispatched', 'building', 'succeeded', 'failed');

create table public.publish_runs (
  id             uuid primary key default gen_random_uuid(),
  requested_by   uuid references auth.users (id) on delete set null,
  requested_at   timestamptz not null default now(),
  status         public.publish_status not null default 'pending',
  -- Frozen Content: {"site": Site, "works": Work[]}. Exactly what the build validates.
  snapshot       jsonb not null check (jsonb_typeof(snapshot) = 'object' and snapshot ? 'site' and snapshot ? 'works'),
  -- Bucket object keys referenced by the snapshot. Drives the anon storage read policy.
  media_paths    text[] not null default '{}',
  content_hash   text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  github_run_url text check (github_run_url ~ '^https://github\.com/' and length(github_run_url) <= 500),
  error          text check (length(error) <= 2000),
  dispatched_at  timestamptz,
  finished_at    timestamptz,
  updated_at     timestamptz not null default now(),
  constraint publish_runs_finished check ((status in ('succeeded', 'failed')) = (finished_at is not null))
);

create index publish_runs_requested_at_idx on public.publish_runs (requested_at desc);
create index publish_runs_live_idx on public.publish_runs (requested_at desc) where status <> 'failed';
create index publish_runs_requested_by_idx on public.publish_runs (requested_by);

comment on table public.publish_runs is 'One row per Publish click. The latest row whose status is not failed is the live content.';

-- ---------------------------------------------------------------------------
-- Content assembly
-- ---------------------------------------------------------------------------

-- One placement as a Content `Media` object. Optional fields are omitted when null.
create function public.placement_json(p public.media_placements)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'type', p.type,
    'src', case when p.type = 'embed' then p.embed_url else m.storage_path::text end,
    'alt', p.alt,
    'width', coalesce(p.width, m.width),
    'height', coalesce(p.height, m.height),
    'poster', pm.storage_path::text,
    'loop', p.loop,
    'provider', p.provider
  ))
  from (select 1) _
  left join public.media m on m.id = p.media_id
  left join public.media pm on pm.id = p.poster_media_id;
$$;

-- Assembles Content from the draft tables.
--   p_published_only = true:  only works with status 'published' (what Publish freezes)
--   p_published_only = false: every non-archived work (dashboard preview)
-- SECURITY INVOKER: RLS applies, so only editors (or the service role) see rows.
create function public.build_content(p_published_only boolean default true)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  s public.site;
  works_json jsonb;
  site_json jsonb;
begin
  select * into s from public.site where id = 1;
  if not found then
    raise exception 'build_content: the site row is missing' using errcode = 'PT422';
  end if;

  with visible_works as (
    select w.* from public.works w
    where case when p_published_only then w.status = 'published' else w.status <> 'archived' end
  )
  select coalesce(jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'id', w.id,
             'slug', w.slug,
             'title', w.title,
             'year', w.year,
             'categoryId', w.category_id,
             'tags', to_jsonb(w.tags),
             'description', w.description,
             'featured', case when w.featured then true end,
             'order', w.sort_order,
             'placeholder', case when w.placeholder then true end,
             'media', (select public.placement_json(p) from public.media_placements p where p.work_id = w.id and p.slot = 'work_cover'),
             'gallery', (select jsonb_agg(public.placement_json(p) order by p.position)
                         from public.media_placements p where p.work_id = w.id and p.slot = 'work_gallery')
           ))
           order by w.sort_order asc nulls last, w.year desc nulls last, w.title collate "C", w.id
         ), '[]'::jsonb)
    into works_json
  from visible_works w;

  site_json := jsonb_build_object(
    'meta', jsonb_build_object(
      'title', s.meta_title,
      'description', s.meta_description,
      'author', s.meta_author,
      'ogImage', (select m.storage_path::text from public.media m where m.id = s.og_media_id),
      'lang', s.meta_lang
    ),
    'hero', jsonb_strip_nulls(jsonb_build_object(
      'heading', s.hero_heading,
      'subheading', s.hero_subheading,
      'media', (select public.placement_json(p) from public.media_placements p where p.slot = 'hero')
    )),
    'about', jsonb_strip_nulls(jsonb_build_object(
      'heading', s.about_heading,
      'body', s.about_body,
      'portrait', (select public.placement_json(p) from public.media_placements p where p.slot = 'about_portrait')
    )),
    'contact', jsonb_build_object(
      'heading', s.contact_heading,
      'email', s.contact_email,
      'ctaLabel', s.contact_cta_label,
      'socials', coalesce((select jsonb_agg(jsonb_build_object('id', so.id, 'label', so.label, 'url', so.url) order by so.position, so.id)
                           from public.socials so), '[]'::jsonb)
    ),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'label', c.label) order by c.position, c.id)
                            from public.categories c), '[]'::jsonb),
    'layout', jsonb_build_object(
      'sections', coalesce((
        select jsonb_agg(
                 jsonb_build_object('id', l.section_id, 'visible', l.visible)
                 || case
                      when l.section_id = 'featured' then jsonb_build_object('options',
                        jsonb_build_object('workIds', coalesce((
                          select jsonb_agg(f.work_id order by f.position)
                          from public.layout_featured_works f
                          join public.works fw on fw.id = f.work_id
                          where case when p_published_only then fw.status = 'published' else fw.status <> 'archived' end
                        ), '[]'::jsonb)) || l.options)
                      when l.options <> '{}'::jsonb then jsonb_build_object('options', l.options)
                      else '{}'::jsonb
                    end
                 order by l.position)
        from public.layout l
      ), '[]'::jsonb)
    )
  );

  if s.placeholder then
    site_json := jsonb_build_object('placeholder', true) || site_json;
  end if;

  return jsonb_build_object('site', site_json, 'works', works_json);
end;
$$;

-- Bucket object keys referenced by a Content snapshot (src, poster, ogImage).
-- Embed URLs are skipped.
create function public.snapshot_media_paths(p_snapshot jsonb)
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

-- ---------------------------------------------------------------------------
-- Publish API (called by the `publish` / `publish-status` Edge Functions)
-- ---------------------------------------------------------------------------

-- Freezes the current draft into a new pending run. Editors only; the run is
-- attributed to auth.uid(). Errors: 42501 not an editor, PT409 a run is already
-- in flight, PT422 content cannot be assembled.
create function public.create_publish_run()
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

-- Status updates from the Edge Functions (service role only).
create function public.update_publish_run(p_id uuid, p_status public.publish_status, p_github_run_url text default null, p_error text default null)
returns public.publish_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.publish_runs;
begin
  update public.publish_runs
     set status = p_status,
         github_run_url = coalesce(p_github_run_url, github_run_url),
         error = coalesce(left(p_error, 2000), error),
         dispatched_at = case when p_status = 'dispatched' then coalesce(dispatched_at, now()) else dispatched_at end,
         finished_at = case when p_status in ('succeeded', 'failed') then coalesce(finished_at, now()) else null end,
         updated_at = now()
   where id = p_id
  returning * into run;
  if not found then
    raise exception 'publish run % not found', p_id using errcode = 'PT404';
  end if;
  return run;
end;
$$;

-- The live Content, or null when nothing has been published yet. Callable by
-- anon: this is the ONLY published-content read path for the public build.
create function public.get_published_content()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select r.snapshot from public.publish_runs r
  where r.status <> 'failed'
  order by r.requested_at desc, r.id desc
  limit 1;
$$;

-- True when a bucket object key belongs to the live snapshot. Used by the anon
-- storage read policy.
create function public.is_published_media(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p_path = any (r.media_paths) from public.publish_runs r
    where r.status <> 'failed'
    order by r.requested_at desc, r.id desc
    limit 1
  ), false);
$$;
