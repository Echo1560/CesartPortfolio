-- Undo 20261025000200_audit.sql. Deletes the activity log.
do $$
declare
  t text;
begin
  foreach t in array array['editors', 'media', 'site', 'socials', 'categories', 'works', 'media_placements', 'layout', 'layout_featured_works'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_log_activity', t);
    execute format('drop trigger if exists %I on public.%I', t || '_set_audit_fields', t);
  end loop;
end;
$$;
drop function if exists public.log_activity();
drop function if exists public.audit_row_id(text, jsonb);
drop function if exists public.write_activity(text, text, text, jsonb, uuid);
drop function if exists public.set_audit_fields();
drop table if exists public.activity_log;
