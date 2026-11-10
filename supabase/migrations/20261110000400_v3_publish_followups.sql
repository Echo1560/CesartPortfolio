-- v3 publish follow-ups (TITA-93, from the PR #29 review):
--   1. restore_published_snapshot() also replaces blocks that moved to another
--      section since the version (they used to abort the restore with 23505).
--   2. Sections and blocks hidden on every device stay in the STORED snapshot
--      (publish_runs) with their visibility, so a restore brings them back.
--      They are never public: get_published_content() strips them, and so do
--      snapshot_media_paths() and the build (src/lib/validate-v3.ts).
--   3. snapshot_media_paths() keeps only keys that are files in the library.
--   4. One safe-href rule (SAFE_HREF in schema-v3.ts) for the Markdown import.
--   5. Events carry the page slug; stats_top_pages() groups page views by page.
-- Contract: docs/V3-CONTRACTS.md §5-6. Rollback: supabase/rollbacks/20261110000400_v3_publish_followups.down.sql

-- ---------------------------------------------------------------------------
-- Safe href (SAFE_HREF in src/lib/schema-v3.ts: keep both in sync)
-- ---------------------------------------------------------------------------

-- http(s), mailto:, tel:, a site path (not `//host` or `/\host`) or #anchor.
create function public.is_safe_href(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p ~ '^(https?://[^[:space:]]+|mailto:[^[:space:]]+|tel:\+?[0-9 ()-]+|/(?![/\\])[^[:space:]\\]*|#[A-Za-z0-9_-]+)$', false);
$$;

-- Same as 20261110000300_v3_migrate_v2.sql, but links use is_safe_href().
create or replace function public.md_inline_to_richtext(p text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  pat constant text := '\*\*([^*]+)\*\*|\[([^]]+)\]\(([^)[:space:]]+)\)|\*([^*[:space:]][^*]*)\*|_([^_[:space:]][^_]*)_';
  rest text := regexp_replace(coalesce(p, ''), '[[:space:]]*\n[[:space:]]*', ' ', 'g');
  nodes jsonb := '[]'::jsonb;
  i integer;
  whole text;
  m text[];
begin
  loop
    i := regexp_instr(rest, pat);
    if i = 0 then
      if rest <> '' then
        nodes := nodes || jsonb_build_array(jsonb_build_object('type', 'text', 'text', rest));
      end if;
      return nodes;
    end if;
    if i > 1 then
      nodes := nodes || jsonb_build_array(jsonb_build_object('type', 'text', 'text', left(rest, i - 1)));
    end if;
    whole := regexp_substr(rest, pat);
    m := regexp_match(whole, '^(?:' || pat || ')$');
    if m[1] is not null then
      nodes := nodes || jsonb_build_array(jsonb_build_object('type', 'text', 'text', m[1], 'marks', '[{"type": "bold"}]'::jsonb));
    elsif m[2] is not null then
      if public.is_safe_href(m[3]) then
        nodes := nodes || jsonb_build_array(jsonb_build_object('type', 'text', 'text', m[2],
          'marks', jsonb_build_array(jsonb_build_object('type', 'link', 'attrs', jsonb_build_object('href', m[3])))));
      else
        nodes := nodes || jsonb_build_array(jsonb_build_object('type', 'text', 'text', m[2]));
      end if;
    else
      nodes := nodes || jsonb_build_array(jsonb_build_object('type', 'text', 'text', coalesce(m[4], m[5]), 'marks', '[{"type": "italic"}]'::jsonb));
    end if;
    rest := substr(rest, i + length(whole));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hidden-everywhere sections and blocks
-- ---------------------------------------------------------------------------

-- True unless the item's `visibility` turns off desktop, tablet and mobile.
create function public.json_visible_somewhere(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((p #>> '{visibility,desktop}')::boolean, true)
      or coalesce((p #>> '{visibility,tablet}')::boolean, true)
      or coalesce((p #>> '{visibility,mobile}')::boolean, true);
$$;

-- A v3 snapshot without the sections and blocks hidden on every device: what
-- the build renders. Other snapshots are returned unchanged.
create function public.snapshot_strip_hidden(p_snapshot jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_snapshot -> 'pages') is distinct from 'array' then p_snapshot
  else jsonb_set(p_snapshot, '{pages}', (
    select coalesce(jsonb_agg(
             case when jsonb_typeof(pg -> 'sections') is distinct from 'array' then pg
             else jsonb_set(pg, '{sections}', (
               select coalesce(jsonb_agg(
                        case when jsonb_typeof(s -> 'blocks') is distinct from 'array' then s
                        else jsonb_set(s, '{blocks}', (
                          select coalesce(jsonb_agg(b order by bo), '[]'::jsonb)
                          from jsonb_array_elements(s -> 'blocks') with ordinality as bx(b, bo)
                          where public.json_visible_somewhere(b)
                        )) end
                        order by so), '[]'::jsonb)
               from jsonb_array_elements(pg -> 'sections') with ordinality as sx(s, so)
               where public.json_visible_somewhere(s)
             )) end
             order by po), '[]'::jsonb)
    from jsonb_array_elements(p_snapshot -> 'pages') with ordinality as px(pg, po)
  )) end;
$$;

-- Same as 20261110000200_v3_publish.sql, but sections and blocks hidden on
-- every device are kept (with their visibility) so restore can bring them back.
create or replace function public.build_content_v3(p_published_only boolean default true)
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
                            where b.section_id = se.id
                          ), '[]'::jsonb) end
                        ))
                        order by se.position)
               from public.sections se
               where se.page_id = p.id
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

-- The live snapshot for the public build (anon), as in 20261025000300_publish.sql,
-- minus the sections and blocks hidden on every device: hidden means private.
-- Editors read the full stored version through published_snapshots (restore).
create or replace function public.get_published_content()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.snapshot_strip_hidden(r.snapshot) from public.publish_runs r
  where r.status <> 'failed'
  order by r.requested_at desc, r.id desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Media paths: only library files, only what the build renders
-- ---------------------------------------------------------------------------

-- Bucket object keys referenced by a snapshot (v2 or v3): every src, poster
-- and ogImage that is a file in the media library. Embed URLs, keys that are
-- not in `media`, and media of sections/blocks hidden on every device are
-- left out, so they never become readable by anon (is_published_media()).
-- STABLE now: it reads public.media. Callers are create_publish_run()
-- (SECURITY DEFINER) and db:import (service role), so RLS never hides rows.
create or replace function public.snapshot_media_paths(p_snapshot jsonb)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.v order by x.v), '{}')
  from (
    select jsonb_path_query(s.snap, 'lax $.**.src') #>> '{}' as v from (select public.snapshot_strip_hidden(p_snapshot) as snap) s
    union all
    select jsonb_path_query(s.snap, 'lax $.**.poster') #>> '{}' from (select public.snapshot_strip_hidden(p_snapshot) as snap) s
    union all
    select jsonb_path_query(s.snap, 'lax $.**.ogImage') #>> '{}' from (select public.snapshot_strip_hidden(p_snapshot) as snap) s
  ) x
  where x.v is not null
    and exists (select 1 from public.media m where m.storage_path::text = x.v);
$$;

-- ---------------------------------------------------------------------------
-- Restore
-- ---------------------------------------------------------------------------

-- Same as 20261110000200_v3_publish.sql, plus: blocks of the version that now
-- live in another section (moved since) are deleted before the insert, so
-- they come back where the version had them instead of failing with 23505.
create or replace function public.restore_published_snapshot(p_run_id uuid)
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

  -- Blocks of the version that were moved into a section outside it since.
  delete from public.blocks
   where id in (
     select (b ->> 'id')::uuid
     from jsonb_array_elements(snap -> 'pages') p,
          jsonb_array_elements(p -> 'sections') s,
          jsonb_array_elements(coalesce(s -> 'blocks', '[]'::jsonb)) b
   );

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
-- Per-page stats
-- ---------------------------------------------------------------------------

-- Slug of the v3 page the event happened on (body data-page-slug, sent by
-- track()). Null on work detail pages, the 404 page and pre-v3 events. Not a
-- foreign key: stats survive renaming or deleting a page.
alter table public.events
  add column page_slug text check (page_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(page_slug) <= 100);
create index events_page_slug_idx on public.events (page_slug, occurred_at) where page_slug is not null;

drop function public.record_event(public.event_name, text, text, text, public.device_class, text, jsonb);

-- As in 20261025000400_events_stats.sql, plus p_page_slug.
create function public.record_event(
  p_name public.event_name,
  p_path text,
  p_work_slug text default null,
  p_referrer_host text default null,
  p_device public.device_class default 'unknown',
  p_visitor_hash text default null,
  p_props jsonb default '{}'::jsonb,
  p_page_slug text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 60 events per visitor per minute, 1200 per minute site-wide.
  if p_visitor_hash is not null and (
    select count(*) from public.events
    where visitor_hash = p_visitor_hash and occurred_at > now() - interval '1 minute'
  ) >= 60 then
    return false;
  end if;
  if (select count(*) from public.events where occurred_at > now() - interval '1 minute') >= 1200 then
    return false;
  end if;

  insert into public.events (name, path, work_slug, referrer_host, device, visitor_hash, props, page_slug)
  values (p_name, p_path, p_work_slug, lower(p_referrer_host), coalesce(p_device, 'unknown'), p_visitor_hash, coalesce(p_props, '{}'::jsonb), p_page_slug);
  return true;
end;
$$;

-- Page views, visitors and contact clicks per v3 page, most viewed first.
-- `title` is the page's current title (null once the page is deleted or its
-- slug changed).
create function public.stats_top_pages(p_from timestamptz, p_to timestamptz, p_limit integer default 10)
returns table (page_slug text, title text, page_views bigint, visitors bigint, contact_clicks bigint)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.assert_stats_access(p_from, p_to);
  return query
  select e.page_slug,
         pg.title,
         count(*) filter (where e.name = 'page_view'),
         count(distinct e.visitor_hash) filter (where e.name = 'page_view'),
         count(*) filter (where e.name = 'contact_click')
  from public.events e
  left join public.pages pg on pg.slug::text = e.page_slug
  where e.page_slug is not null and e.occurred_at >= p_from and e.occurred_at < p_to and e.device <> 'bot'
  group by e.page_slug, pg.title
  order by 3 desc, 5 desc, 1
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.is_safe_href(text),
  public.json_visible_somewhere(jsonb),
  public.snapshot_strip_hidden(jsonb),
  public.record_event(public.event_name, text, text, text, public.device_class, text, jsonb, text),
  public.stats_top_pages(timestamptz, timestamptz, integer)
from public, anon, authenticated;
grant execute on function public.stats_top_pages(timestamptz, timestamptz, integer) to authenticated;
grant execute on function
  public.is_safe_href(text),
  public.json_visible_somewhere(jsonb),
  public.snapshot_strip_hidden(jsonb),
  public.record_event(public.event_name, text, text, text, public.device_class, text, jsonb, text),
  public.stats_top_pages(timestamptz, timestamptz, integer)
to service_role;
