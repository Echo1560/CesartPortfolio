-- Row Level Security and privileges.
--   anon:          no table access at all. Reads live content ONLY through
--                  get_published_content(); cannot write anything.
--   authenticated: rows visible/writable only when is_editor() (an active row in
--                  editors). Non-editor accounts see nothing and write nothing.
--   service_role:  Edge Functions only (bypasses RLS). Never shipped to a browser.
-- Rollback: supabase/rollbacks/20261025000500_rls.down.sql

-- ---------------------------------------------------------------------------
-- Editor management RPCs
-- ---------------------------------------------------------------------------

-- True when the caller is an active owner. Only owners manage accounts
-- (invite, disable, enable, remove); owners and editors both edit all content.
create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.editors e
    where e.user_id = (select auth.uid()) and e.disabled_at is null and e.role = 'owner'
  );
$$;

-- Shared guard for disable/enable/remove. Errors: 42501 caller is not an
-- active owner, PT409 targeting yourself or the last active owner, PT404
-- unknown editor. An advisory lock serialises account changes so the
-- last-owner count cannot race.
create function public.assert_can_manage_editor(p_user_id uuid, p_verb text)
returns public.editors
language plpgsql
security definer
set search_path = ''
as $$
declare
  ed public.editors;
begin
  if not public.is_owner() then
    raise exception 'only owners can manage accounts' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.editors.manage'));
  select * into ed from public.editors where user_id = p_user_id for update;
  if not found then
    raise exception 'editor % not found', p_user_id using errcode = 'PT404';
  end if;
  if p_verb <> 'enable' and ed.role = 'owner' and ed.disabled_at is null and (
    select count(*) from public.editors where role = 'owner' and disabled_at is null
  ) <= 1 then
    raise exception 'cannot % the last active owner', p_verb using errcode = 'PT409';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'you cannot % your own account', p_verb using errcode = 'PT409';
  end if;
  return ed;
end;
$$;

-- Disable or re-enable an editor. Disabled editors keep their auth account but
-- lose every read/write right at once (is_editor() checks disabled_at).
-- The editors audit trigger logs the change (disabled_at old/new) with the actor.
create function public.set_editor_disabled(p_user_id uuid, p_disabled boolean)
returns public.editors
language plpgsql
security definer
set search_path = ''
as $$
declare
  ed public.editors;
begin
  perform public.assert_can_manage_editor(p_user_id, case when p_disabled then 'disable' else 'enable' end);
  update public.editors
     set disabled_at = case when p_disabled then coalesce(disabled_at, now()) end
   where user_id = p_user_id
  returning * into ed;
  return ed;
end;
$$;

-- Removes editor rights (deletes the editors row; the audit trigger logs it).
-- The remove-editor Edge Function deletes the auth user ONLY after this
-- returns without error.
create function public.remove_editor(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_can_manage_editor(p_user_id, 'remove');
  delete from public.editors where user_id = p_user_id;
end;
$$;

-- Registers an invited auth user as an editor. Service role only: called by the
-- invite-editor Edge Function after auth.admin.inviteUserByEmail(), with the
-- inviting owner's id (verified from their JWT) as p_invited_by. Invited
-- accounts get role 'editor'; there is no API to promote anyone to owner.
create function public.register_invited_editor(p_user_id uuid, p_email text, p_display_name text, p_invited_by uuid)
returns public.editors
language plpgsql
security definer
set search_path = ''
as $$
declare
  ed public.editors;
begin
  if not exists (select 1 from public.editors where user_id = p_invited_by and disabled_at is null and role = 'owner') then
    raise exception 'inviter is not an active owner' using errcode = '42501';
  end if;
  insert into public.editors (user_id, email, display_name, role, invited_by)
  values (p_user_id, p_email, p_display_name, 'editor', p_invited_by)
  returning * into ed;
  perform public.write_activity('invite', 'editors', p_user_id::text, jsonb_build_object('email', p_email), p_invited_by);
  return ed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing, then grant exactly what each role needs.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- New tables and sequences created by later migrations are NOT exposed by
-- default either: every migration must grant explicitly (see docs/V2-CONTRACTS.md).
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
-- EXECUTE to PUBLIC is a global Postgres default that cannot be revoked per
-- schema. Every later migration that adds a function in public must
-- `revoke execute ... from public` itself; tests/database/00_structure.test.sql
-- fails if anon can execute anything unexpected.

-- Editable content tables: full CRUD for editors (RLS below decides).
grant select, insert, update, delete on
  public.media, public.site, public.socials, public.categories, public.works,
  public.media_placements, public.layout, public.layout_featured_works
to authenticated;

-- Read-only for editors.
grant select on public.editors, public.activity_log, public.events, public.publish_runs to authenticated;
-- An editor may rename themself; nothing else on editors is client-writable.
grant update (display_name) on public.editors to authenticated;

-- Functions.
grant execute on function public.get_published_content() to anon, authenticated;
grant execute on function public.is_published_media(text) to anon, authenticated;
grant execute on function
  public.is_editor(),
  public.is_owner(),
  public.placement_json(public.media_placements),
  public.build_content(boolean),
  public.create_publish_run(),
  public.assert_stats_access(timestamptz, timestamptz),
  public.stats_overview(timestamptz, timestamptz),
  public.stats_daily(timestamptz, timestamptz, text),
  public.stats_top_works(timestamptz, timestamptz, integer),
  public.stats_referrers(timestamptz, timestamptz, integer),
  public.stats_devices(timestamptz, timestamptz),
  public.set_editor_disabled(uuid, boolean),
  public.remove_editor(uuid)
to authenticated;

grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['editors', 'media', 'site', 'socials', 'categories', 'works', 'media_placements',
                           'layout', 'layout_featured_works', 'activity_log', 'events', 'publish_runs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Editable content: editors only, every operation.
  foreach t in array array['media', 'site', 'socials', 'categories', 'works', 'media_placements', 'layout', 'layout_featured_works'] loop
    execute format(
      'create policy editors_all on public.%I for all to authenticated using ((select public.is_editor())) with check ((select public.is_editor()))', t);
  end loop;

  -- Private data: editors read, nobody writes through the API.
  foreach t in array array['activity_log', 'events', 'publish_runs'] loop
    execute format('create policy editors_select on public.%I for select to authenticated using ((select public.is_editor()))', t);
  end loop;
end;
$$;

-- editors: active editors see the team; anyone signed in sees their own row
-- (so the dashboard can tell a disabled or non-editor account why it is locked out).
create policy editors_select on public.editors
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_editor()));

create policy editors_update_self on public.editors
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_editor()))
  with check (user_id = (select auth.uid()));
