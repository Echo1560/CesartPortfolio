-- Undo 20261025000300_publish.sql. Deletes publish history and live snapshots.
drop function if exists public.is_published_media(text);
drop function if exists public.get_published_content();
drop function if exists public.update_publish_run(uuid, public.publish_status, text, text);
drop function if exists public.create_publish_run();
drop function if exists public.snapshot_media_paths(jsonb);
drop function if exists public.build_content(boolean);
drop function if exists public.placement_json(public.media_placements);
drop table if exists public.publish_runs;
drop type if exists public.publish_status;
