-- Undo 20261025000400_events_stats.sql. Deletes all analytics events.
drop function if exists public.stats_devices(timestamptz, timestamptz);
drop function if exists public.stats_referrers(timestamptz, timestamptz, integer);
drop function if exists public.stats_top_works(timestamptz, timestamptz, integer);
drop function if exists public.stats_daily(timestamptz, timestamptz, text);
drop function if exists public.stats_overview(timestamptz, timestamptz);
drop function if exists public.assert_stats_access(timestamptz, timestamptz);
drop function if exists public.purge_old_events(interval);
drop function if exists public.record_event(public.event_name, text, text, text, public.device_class, text, jsonb);
drop table if exists public.events;
drop type if exists public.device_class;
drop type if exists public.event_name;
