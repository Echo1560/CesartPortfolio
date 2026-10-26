-- Cookieless analytics. The `track` Edge Function (service role) is the only
-- writer, through record_event(). Editors read aggregates through the stats_*
-- functions. No raw IPs or user agents are stored.
-- Rollback: supabase/rollbacks/20261025000400_events_stats.down.sql

-- Same values as `TrackEvent` in src/lib/track.ts.
create type public.event_name as enum ('page_view', 'work_open', 'video_play', 'contact_click');
create type public.device_class as enum ('mobile', 'tablet', 'desktop', 'bot', 'unknown');

create table public.events (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  name          public.event_name not null,
  -- Site path without query string or fragment, e.g. /CesartPortfolio/work/foo/
  path          text not null check (path ~ '^/[^\s?#]*$' and length(path) <= 512),
  -- Work slug as sent by track() (the client knows slugs, not ids). Not a
  -- foreign key: stats survive deleting a work.
  work_slug     text check (work_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(work_slug) <= 100),
  -- Host only (no path or query) of an external referrer; null for direct or same-site.
  referrer_host text check (referrer_host ~ '^[a-z0-9.-]+$' and length(referrer_host) <= 253),
  device        public.device_class not null default 'unknown',
  -- HMAC-SHA256(daily_salt, ip || user_agent), hex. The salt rotates every UTC day
  -- and is never stored, so the hash cannot be linked across days or reversed.
  visitor_hash  text check (visitor_hash ~ '^[0-9a-f]{64}$'),
  -- Small extra fields, e.g. {"category": "animation"}. Max 1 KiB.
  props         jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object' and length(props::text) <= 1024),
  -- video_play may have no work (the hero reel).
  constraint events_work_open_has_work check (name <> 'work_open' or work_slug is not null)
);

create index events_occurred_at_idx on public.events (occurred_at);
create index events_name_occurred_at_idx on public.events (name, occurred_at);
create index events_work_slug_idx on public.events (work_slug, occurred_at) where work_slug is not null;
create index events_visitor_hash_idx on public.events (visitor_hash, occurred_at) where visitor_hash is not null;

comment on table public.events is 'Analytics events. Insert only via record_event() (track Edge Function). Editors read.';

-- Inserts one event unless the visitor is over the rate limit. Returns true when
-- stored, false when dropped. Service role only (the track Edge Function).
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

-- Deletes events older than the retention window. Service role only (keep-alive job).
create function public.purge_old_events(p_keep interval default interval '400 days')
returns bigint
language sql
security definer
set search_path = ''
as $$
  with d as (delete from public.events where occurred_at < now() - p_keep returning 1)
  select count(*) from d;
$$;

-- ---------------------------------------------------------------------------
-- Stats for the dashboard. Editors only (42501 otherwise). Ranges are
-- half-open [p_from, p_to), at most 400 days (PT422 otherwise).
-- ---------------------------------------------------------------------------

create function public.assert_stats_access(p_from timestamptz, p_to timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_editor() then
    raise exception 'only editors can read stats' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'invalid date range (from < to, at most 400 days)' using errcode = 'PT422';
  end if;
end;
$$;

create function public.stats_overview(p_from timestamptz, p_to timestamptz)
returns table (page_views bigint, visitors bigint, work_opens bigint, video_plays bigint, contact_clicks bigint)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.assert_stats_access(p_from, p_to);
  return query
  select
    count(*) filter (where e.name = 'page_view'),
    -- visitor_hash rotates daily, so this counts visitor-days.
    count(distinct e.visitor_hash) filter (where e.name = 'page_view'),
    count(*) filter (where e.name = 'work_open'),
    count(*) filter (where e.name = 'video_play'),
    count(*) filter (where e.name = 'contact_click')
  from public.events e
  where e.occurred_at >= p_from and e.occurred_at < p_to and e.device <> 'bot';
end;
$$;

create function public.stats_daily(p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns table (day date, page_views bigint, visitors bigint)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.assert_stats_access(p_from, p_to);
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then
    raise exception 'unknown time zone %', p_tz using errcode = 'PT422';
  end if;
  return query
  select d::date,
         count(e.id) filter (where e.name = 'page_view'),
         count(distinct e.visitor_hash) filter (where e.name = 'page_view')
  from generate_series((p_from at time zone p_tz)::date, ((p_to - interval '1 microsecond') at time zone p_tz)::date, interval '1 day') d
  left join public.events e
    on (e.occurred_at at time zone p_tz)::date = d::date
   and e.occurred_at >= p_from and e.occurred_at < p_to and e.device <> 'bot'
  group by d
  order by d;
end;
$$;

create function public.stats_top_works(p_from timestamptz, p_to timestamptz, p_limit integer default 10)
returns table (work_slug text, title text, opens bigint, video_plays bigint)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.assert_stats_access(p_from, p_to);
  return query
  select e.work_slug,
         w.title,
         count(*) filter (where e.name = 'work_open'),
         count(*) filter (where e.name = 'video_play')
  from public.events e
  left join public.works w on w.slug = e.work_slug
  where e.work_slug is not null and e.occurred_at >= p_from and e.occurred_at < p_to and e.device <> 'bot'
  group by e.work_slug, w.title
  order by 3 desc, 4 desc, 1
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
end;
$$;

create function public.stats_referrers(p_from timestamptz, p_to timestamptz, p_limit integer default 10)
returns table (referrer_host text, page_views bigint)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.assert_stats_access(p_from, p_to);
  return query
  select coalesce(e.referrer_host, '(direct)'), count(*)
  from public.events e
  where e.name = 'page_view' and e.occurred_at >= p_from and e.occurred_at < p_to and e.device <> 'bot'
  group by 1
  order by 2 desc, 1
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
end;
$$;

create function public.stats_devices(p_from timestamptz, p_to timestamptz)
returns table (device public.device_class, page_views bigint)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.assert_stats_access(p_from, p_to);
  return query
  select e.device, count(*)
  from public.events e
  where e.name = 'page_view' and e.occurred_at >= p_from and e.occurred_at < p_to
  group by e.device
  order by 2 desc, 1;
end;
$$;
