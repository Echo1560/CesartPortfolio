-- Undo 20261025000500_rls.sql: drop policies, disable RLS, drop editor RPCs.
-- Restores Supabase's default grants to anon/authenticated (as before the migration).
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['editors', 'media', 'site', 'socials', 'categories', 'works', 'media_placements',
                           'layout', 'layout_featured_works', 'activity_log', 'events', 'publish_runs'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I disable row level security', t);
  end loop;
end;
$$;

drop function if exists public.register_invited_editor(uuid, text, text, uuid);
drop function if exists public.remove_editor(uuid);
drop function if exists public.set_editor_disabled(uuid, boolean);

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to public, anon, authenticated;
