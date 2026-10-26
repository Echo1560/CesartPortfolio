-- Attribution: every editable table gets updated_by/updated_at set by a trigger,
-- and every insert/update/delete is written to activity_log with the actor.
-- Rollback: supabase/rollbacks/20261025000200_audit.down.sql

create table public.activity_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- auth.uid() of the caller; null for seeds, migrations and service-role jobs.
  actor_id    uuid references auth.users (id) on delete set null,
  -- Display name at the time of the change, kept if the editor is removed later.
  actor_name  text,
  action      text not null check (action in ('insert', 'update', 'delete', 'publish', 'invite', 'disable', 'enable', 'remove')),
  table_name  text not null check (length(table_name) <= 63),
  row_id      text check (length(row_id) <= 200),
  -- insert/delete: {"row": {...}}; update: {"changed": {"col": {"old": x, "new": y}}}; other actions: free-form.
  details     jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);

create index activity_log_occurred_at_idx on public.activity_log (occurred_at desc);
create index activity_log_actor_id_idx on public.activity_log (actor_id);
create index activity_log_table_row_idx on public.activity_log (table_name, row_id);

comment on table public.activity_log is 'Append-only audit trail shown in the dashboard. Written only by triggers and SECURITY DEFINER functions.';

-- BEFORE INSERT/UPDATE: stamp updated_at and updated_by. Clients cannot forge
-- either value, whatever they send.
create function public.set_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

-- Writes one activity_log row. SECURITY DEFINER: callers never get INSERT on
-- activity_log itself.
-- p_actor overrides auth.uid() for service-role callers acting for an editor
-- (for example invite-editor).
create function public.write_activity(p_action text, p_table text, p_row_id text, p_details jsonb default '{}'::jsonb, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := coalesce(p_actor, (select auth.uid()));
begin
  insert into public.activity_log (actor_id, actor_name, action, table_name, row_id, details)
  values (
    uid,
    (select e.display_name from public.editors e where e.user_id = uid),
    p_action,
    p_table,
    p_row_id,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.write_activity(text, text, text, jsonb, uuid) from public, anon, authenticated;

-- Primary-key text for a row of any audited table.
create function public.audit_row_id(p_table text, p_row jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_table
    when 'editors' then p_row ->> 'user_id'
    when 'layout' then p_row ->> 'section_id'
    when 'layout_featured_works' then p_row ->> 'work_id'
    else p_row ->> 'id'
  end;
$$;

-- AFTER INSERT/UPDATE/DELETE: log the change. Updates record only the columns
-- that changed (minus the audit columns); a no-op update is not logged.
create function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  changed jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(new_row) loop
      if k not in ('updated_at', 'updated_by') and (old_row -> k) is distinct from (new_row -> k) then
        changed := changed || jsonb_build_object(k, jsonb_build_object('old', old_row -> k, 'new', new_row -> k));
      end if;
    end loop;
    if changed = '{}'::jsonb then
      return null;
    end if;
    perform public.write_activity('update', tg_table_name, public.audit_row_id(tg_table_name, new_row), jsonb_build_object('changed', changed));
  elsif tg_op = 'INSERT' then
    perform public.write_activity('insert', tg_table_name, public.audit_row_id(tg_table_name, new_row), jsonb_build_object('row', new_row - 'updated_at' - 'updated_by'));
  else
    perform public.write_activity('delete', tg_table_name, public.audit_row_id(tg_table_name, old_row), jsonb_build_object('row', old_row - 'updated_at' - 'updated_by'));
  end if;
  return null;
end;
$$;

-- Attach both triggers to every editable table.
do $$
declare
  t text;
begin
  foreach t in array array['editors', 'media', 'site', 'socials', 'categories', 'works', 'media_placements', 'layout', 'layout_featured_works'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.set_audit_fields()', t || '_set_audit_fields', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_activity()', t || '_log_activity', t);
  end loop;
end;
$$;
