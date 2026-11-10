-- v3 content model: pages -> sections -> blocks, a site theme, and the site
-- navigation/footer. Contract: docs/V3-CONTRACTS.md.
-- Rollback: supabase/rollbacks/20261110000100_v3_content_model.down.sql
--
-- Like v2, these are DRAFT tables. The public site is built only from the
-- published snapshot (see 20261110000200_v3_publish.sql).
--
-- The database enforces identity, ordering, references and the type/variant
-- pairs. The deep shape of the settings/content JSON is the zod contract in
-- src/lib/schema-v3.ts: the editor validates before it writes, and the build
-- validates the snapshot again before rendering.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- draft: never built. published: built and routable. hidden: taken offline,
-- kept in the editor. Only `published` pages enter a snapshot.
create type public.page_status as enum ('draft', 'published', 'hidden');

-- Same values as `SectionType` in src/lib/schema-v3.ts.
create type public.section_type as enum (
  'hero', 'text', 'image', 'gallery', 'featured', 'about', 'contact', 'columns', 'spacer', 'cta', 'works-list'
);

-- Same values as `BlockType` in src/lib/schema-v3.ts.
create type public.block_type as enum ('heading', 'paragraph', 'image', 'button', 'divider', 'spacer', 'quote', 'video');

-- ---------------------------------------------------------------------------
-- Site: navigation and footer (SEO defaults stay in the v2 meta_* columns and
-- og_media_id). hero_*, about_*, contact_* and the layout tables are v2 only:
-- they keep the v2 build working until the v2 forms are retired (TITA-90 stage 7).
-- ---------------------------------------------------------------------------

alter table public.site
  add column nav jsonb not null default '{"items": []}'::jsonb
    check (jsonb_typeof(nav) = 'object' and jsonb_typeof(nav -> 'items') = 'array' and pg_column_size(nav) <= 32768),
  add column footer jsonb not null default '{"links": [], "showSocials": false, "showCopyright": true, "showBackToTop": true}'::jsonb
    check (jsonb_typeof(footer) = 'object' and pg_column_size(footer) <= 32768);

comment on column public.site.nav is 'SiteNav (schema-v3.ts): {items: NavItem[], cta?: Button}.';
comment on column public.site.footer is 'SiteFooter (schema-v3.ts).';

-- ---------------------------------------------------------------------------
-- Pages
-- ---------------------------------------------------------------------------

create table public.pages (
  id              uuid primary key default gen_random_uuid(),
  -- URL segment: /CesartPortfolio/<slug>/. The home page is served at / whatever its slug.
  slug            public.kebab_id not null unique,
  -- Page name in the editor and the default nav label.
  title           text not null check (length(btrim(title)) between 1 and 120),
  seo_title       text check (length(seo_title) <= 200),
  seo_description text check (length(seo_description) <= 500),
  social_media_id uuid references public.media (id) on delete restrict,
  status          public.page_status not null default 'draft',
  is_home         boolean not null default false,
  position        integer not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,
  -- Routes the site already uses, or may need. Keep in sync with RESERVED_SLUGS in schema-v3.ts.
  constraint pages_slug_not_reserved check (slug::text not in (
    'admin', 'work', 'works', 'api', 'assets', 'media', 'preview', 'sitemap', 'robots', 'rss', 'feed', '404', 'index', 'home-preview'
  ) and slug::text !~ '^_'),
  constraint pages_home_published check (not is_home or status = 'published'),
  constraint pages_position_unique unique (position) deferrable initially deferred
);

create unique index pages_one_home on public.pages (is_home) where is_home;
create index pages_social_media_id_idx on public.pages (social_media_id);
create index pages_status_idx on public.pages (status);

comment on table public.pages is 'Editor-created pages in nav order. Exactly one is the home page; it cannot be deleted.';

-- The home page cannot be deleted. Make another page the home first.
create function public.protect_home_page()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_home then
    raise exception 'the home page cannot be deleted' using errcode = 'PT409';
  end if;
  return old;
end;
$$;

create trigger pages_protect_home
  before delete on public.pages
  for each row execute function public.protect_home_page();

-- Checked at commit, so "move the home flag" can be two statements.
create function public.assert_one_home_page()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.pages) and not exists (select 1 from public.pages where is_home) then
    raise exception 'exactly one page must be the home page' using errcode = 'PT409';
  end if;
  return null;
end;
$$;

create constraint trigger pages_one_home_at_commit
  after insert or update of is_home or delete on public.pages
  deferrable initially deferred
  for each row execute function public.assert_one_home_page();

-- Makes a page the home page (and publishes it) in one call, since PostgREST
-- cannot run the two updates in one transaction. SECURITY INVOKER: RLS applies.
-- Errors: 42501 not an editor, PT404 unknown page.
create function public.set_home_page(p_page_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_editor() then
    raise exception 'only editors can change the home page' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pages where id = p_page_id) then
    raise exception 'page % not found', p_page_id using errcode = 'PT404';
  end if;
  update public.pages set is_home = false where is_home and id <> p_page_id;
  update public.pages set is_home = true, status = 'published' where id = p_page_id and not is_home;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sections
-- ---------------------------------------------------------------------------

create table public.sections (
  id             uuid primary key default gen_random_uuid(),
  page_id        uuid not null references public.pages (id) on delete cascade,
  type           public.section_type not null,
  variant        text not null default 'default',
  position       integer not null,
  -- Presentation (side panel): SectionSettings for the type.
  settings       jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 32768),
  -- Editable content (inline editing): SectionContent for the type.
  content        jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 131072),
  show_on_desktop boolean not null default true,
  show_on_tablet  boolean not null default true,
  show_on_mobile  boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users (id) on delete set null,
  -- Same lists as SECTION_VARIANTS in schema-v3.ts.
  constraint sections_variant_valid check (
    case type
      when 'hero'       then variant in ('default', 'overlay', 'split', 'text-only')
      when 'text'       then variant in ('default', 'lead', 'boxed')
      when 'image'      then variant in ('default', 'full-bleed', 'caption-side')
      when 'gallery'    then variant in ('default', 'grid')
      when 'featured'   then variant in ('default', 'large-first', 'strip')
      when 'about'      then variant in ('default', 'portrait-right', 'stacked')
      when 'contact'    then variant in ('default', 'centered', 'split')
      when 'columns'    then variant in ('default', 'wide-left', 'wide-right')
      when 'spacer'     then variant in ('default')
      when 'cta'        then variant in ('default', 'centered', 'banner')
      when 'works-list' then variant in ('default', 'compact', 'cards')
    end
  ),
  constraint sections_columns_setting check (
    not settings ? 'columns' or type <> 'columns'
    or (jsonb_typeof(settings -> 'columns') = 'number' and (settings ->> 'columns') ~ '^[2-4]$')
  ),
  constraint sections_page_position_unique unique (page_id, position) deferrable initially deferred
);

comment on table public.sections is 'Ordered sections of a page. type + variant pick the component; settings/content follow schema-v3.ts.';

-- ---------------------------------------------------------------------------
-- Blocks (only inside the flexible section types: text, columns)
-- ---------------------------------------------------------------------------

create table public.blocks (
  id             uuid primary key default gen_random_uuid(),
  section_id     uuid not null references public.sections (id) on delete cascade,
  type           public.block_type not null,
  -- Column inside a `columns` section (0-based). Always 0 in a `text` section.
  column_index   smallint not null default 0 check (column_index between 0 and 3),
  position       integer not null,
  settings       jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 8192),
  content        jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 65536),
  show_on_desktop boolean not null default true,
  show_on_tablet  boolean not null default true,
  show_on_mobile  boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users (id) on delete set null,
  constraint blocks_section_position_unique unique (section_id, column_index, position) deferrable initially deferred
);

comment on table public.blocks is 'Ordered blocks inside a text or columns section. content follows schema-v3.ts BlockContent.';

-- Number of columns a section offers to blocks: text = 1, columns = settings.columns (default 2), others = 0.
create function public.section_block_columns(p_type public.section_type, p_settings jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'text' then 1
    when 'columns' then coalesce((p_settings ->> 'columns')::integer, 2)
    else 0
  end;
$$;

-- A block must sit in a flexible section, in a column that exists.
create function public.check_block_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s public.sections;
begin
  select * into s from public.sections where id = new.section_id;
  if not found then
    return new; -- the foreign key reports it
  end if;
  if new.column_index >= public.section_block_columns(s.type, s.settings) then
    raise exception 'blocks: a % section has no column %', s.type, new.column_index
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger blocks_check_parent
  before insert or update of section_id, column_index on public.blocks
  for each row execute function public.check_block_parent();

-- The reverse: a section cannot change type or lose columns while blocks use them.
create function public.check_section_blocks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.blocks b
    where b.section_id = new.id and b.column_index >= public.section_block_columns(new.type, new.settings)
  ) then
    raise exception 'sections: % blocks still use a column this % section no longer has', new.id, new.type
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger sections_check_blocks
  before update of type, settings on public.sections
  for each row execute function public.check_section_blocks();

-- ---------------------------------------------------------------------------
-- Media references inside JSON: {"mediaId": uuid, "posterId"?: uuid, ...}.
-- JSON cannot carry a foreign key, so triggers keep the same guarantee both ways.
-- ---------------------------------------------------------------------------

-- Every mediaId / posterId in a JSON value. Non-uuid strings raise 22P02.
create function public.json_media_ids(p_value jsonb)
returns setof uuid
language sql
immutable
set search_path = ''
as $$
  select (v #>> '{}')::uuid
  from jsonb_path_query(coalesce(p_value, 'null'::jsonb), 'lax $.**.mediaId') v
  union
  select (v #>> '{}')::uuid
  from jsonb_path_query(coalesce(p_value, 'null'::jsonb), 'lax $.**.posterId') v;
$$;

create function public.check_json_media_refs()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  missing uuid;
begin
  select id into missing
  from public.json_media_ids(jsonb_build_array(new.settings, new.content)) as r(id)
  where not exists (select 1 from public.media m where m.id = r.id)
  limit 1;
  if missing is not null then
    raise exception '%: media % does not exist', tg_table_name, missing using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger sections_check_media_refs
  before insert or update of settings, content on public.sections
  for each row execute function public.check_json_media_refs();

create trigger blocks_check_media_refs
  before insert or update of settings, content on public.blocks
  for each row execute function public.check_json_media_refs();

-- A library file used by a section or block cannot be deleted (like the
-- `on delete restrict` foreign keys from media_placements and pages).
create function public.protect_media_in_use()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  vars jsonb := jsonb_build_object('id', old.id::text);
  path jsonpath := '$.** ? (@.mediaId == $id || @.posterId == $id)';
begin
  if exists (select 1 from public.sections s where jsonb_path_exists(jsonb_build_array(s.settings, s.content), path, vars))
     or exists (select 1 from public.blocks b where jsonb_path_exists(jsonb_build_array(b.settings, b.content), path, vars)) then
    raise exception 'media % is still used by a section or block', old.id using errcode = '23503';
  end if;
  return old;
end;
$$;

create trigger media_protect_in_use
  before delete on public.media
  for each row execute function public.protect_media_in_use();

-- ---------------------------------------------------------------------------
-- Theme (singleton)
-- ---------------------------------------------------------------------------

create table public.theme (
  id         smallint primary key default 1 check (id = 1),
  -- Preset the tokens started from (THEME_PRESETS in schema-v3.ts). Informational:
  -- the tokens are what renders.
  preset     public.kebab_id not null default 'classic',
  -- ThemeTokens (schema-v3.ts).
  tokens     jsonb not null check (
    jsonb_typeof(tokens) = 'object'
    and tokens ?& array['colors', 'typography', 'spacing', 'buttons', 'radius', 'links', 'motion']
    and pg_column_size(tokens) <= 16384
  ),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.theme is 'Site styles. One row. tokens become CSS custom properties at build time.';

-- ---------------------------------------------------------------------------
-- Audit: updated_at/updated_by + activity_log, as on every v2 editable table.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['pages', 'sections', 'blocks', 'theme'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.set_audit_fields()', t || '_set_audit_fields', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_activity()', t || '_log_activity', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS: editors only, like the v2 draft tables. Anon gets nothing.
-- ---------------------------------------------------------------------------

revoke all on public.pages, public.sections, public.blocks, public.theme from anon, authenticated;
grant select, insert, update, delete on public.pages, public.sections, public.blocks, public.theme to authenticated;

revoke execute on function
  public.set_home_page(uuid),
  public.protect_home_page(),
  public.assert_one_home_page(),
  public.section_block_columns(public.section_type, jsonb),
  public.check_block_parent(),
  public.check_section_blocks(),
  public.json_media_ids(jsonb),
  public.check_json_media_refs(),
  public.protect_media_in_use()
from public, anon, authenticated;
grant execute on function public.set_home_page(uuid), public.section_block_columns(public.section_type, jsonb), public.json_media_ids(jsonb) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['pages', 'sections', 'blocks', 'theme'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy editors_all on public.%I for all to authenticated using ((select public.is_editor())) with check ((select public.is_editor()))', t);
  end loop;
end;
$$;
