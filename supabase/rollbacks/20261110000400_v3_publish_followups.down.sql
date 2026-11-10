-- Undo 20261110000400_v3_publish_followups.sql: the 20261110000200/0300
-- definitions come back. Events keep their rows; page_slug is dropped.
drop function if exists public.stats_top_pages(timestamptz, timestamptz, integer);
drop function if exists public.record_event(public.event_name, text, text, text, public.device_class, text, jsonb, text);
drop index if exists public.events_page_slug_idx;
alter table public.events drop column if exists page_slug;

-- From 20261025000400_events_stats.sql.
create function public.record_event(
  p_name public.event_name,
  p_path text,
  p_work_slug text default null,
  p_referrer_host text default null,
  p_device public.device_class default 'unknown',
  p_visitor_hash text default null,
  p_props jsonb default '{}'::jsonb
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

  insert into public.events (name, path, work_slug, referrer_host, device, visitor_hash, props)
  values (p_name, p_path, p_work_slug, lower(p_referrer_host), coalesce(p_device, 'unknown'), p_visitor_hash, coalesce(p_props, '{}'::jsonb));
  return true;
end;
$$;
revoke execute on function public.record_event(public.event_name, text, text, text, public.device_class, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_event(public.event_name, text, text, text, public.device_class, text, jsonb) to service_role;

-- From 20261110000200_v3_publish.sql.
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

-- From 20261110000200_v3_publish.sql.
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

-- From 20261110000200_v3_publish.sql.
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

-- From 20261110000300_v3_migrate_v2.sql.
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
      if m[3] ~* '^(https?://|mailto:|/|#)' then
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

-- From 20261025000300_publish.sql.
create or replace function public.get_published_content()
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

drop function if exists public.snapshot_strip_hidden(jsonb);
drop function if exists public.json_visible_somewhere(jsonb);
drop function if exists public.is_safe_href(text);
