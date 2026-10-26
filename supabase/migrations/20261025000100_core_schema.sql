-- v2 core schema: editors, draft content tables, media library, layout.
-- Contract: docs/V2-CONTRACTS.md. Rollback: supabase/rollbacks/20261025000100_core_schema.down.sql
--
-- These tables hold the DRAFT (working) state edited in the dashboard. The live
-- site is built from the latest published snapshot (publish_runs), never from
-- these tables directly. See 20261025000300_publish.sql.

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.editor_role as enum ('owner', 'editor');
create type public.work_status as enum ('draft', 'published', 'archived');
-- Same values as `Media['type']` in src/lib/schema.ts.
create type public.media_type as enum ('image', 'animated', 'video', 'embed');
create type public.embed_provider as enum ('youtube', 'vimeo');
-- Where a media placement is used.
create type public.media_slot as enum ('hero', 'about_portrait', 'work_cover', 'work_gallery');
-- Same values as `SectionId` in src/lib/schema.ts.
create type public.section_id as enum ('hero', 'featured', 'grid', 'about', 'contact');

-- ---------------------------------------------------------------------------
-- Shared domain checks
-- ---------------------------------------------------------------------------

-- kebab-case id, same regex as `kebabId` in schema.ts.
create domain public.kebab_id as text
  check (value ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(value) <= 100);

-- Object key in the `media` bucket, same rules as `mediaPath` in schema.ts
-- (relative, no leading slash, no backslash, no "..", no URL scheme).
create domain public.media_path as text
  check (
    length(value) between 1 and 300
    and value !~ '^/'
    and position(E'\\' in value) = 0
    and not ('..' = any (string_to_array(value, '/')))
    and value !~* '^[a-z]+:'
  );

-- ---------------------------------------------------------------------------
-- Editors: who may write. Rows are created by the invite-editor Edge Function
-- (service role) or by seed.sql locally. Linked 1:1 to auth.users.
-- ---------------------------------------------------------------------------

create table public.editors (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        extensions.citext not null unique,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  role         public.editor_role not null default 'editor',
  invited_by   uuid references public.editors (user_id) on delete set null,
  disabled_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null
);

comment on table public.editors is 'Accounts allowed to edit content. disabled_at not null = cannot write or read private data.';

-- True when the caller is an active editor. SECURITY DEFINER so RLS policies can
-- call it without recursing into the editors policies.
create function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.editors e
    where e.user_id = (select auth.uid()) and e.disabled_at is null
  );
$$;

comment on function public.is_editor() is 'RLS helper: caller is an active (not disabled) editor.';

-- ---------------------------------------------------------------------------
-- Media library: one row per file in the `media` storage bucket.
-- ---------------------------------------------------------------------------

create table public.media (
  id            uuid primary key default gen_random_uuid(),
  storage_path  public.media_path not null unique,
  kind          public.media_type not null check (kind <> 'embed'),
  mime_type     text not null check (mime_type in ('image/gif', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm')),
  bytes         bigint not null check (bytes > 0 and bytes <= 26214400), -- 25 MiB, same as the bucket limit
  width         integer check (width > 0),
  height        integer check (height > 0),
  default_alt   text not null default '',
  original_name text check (length(original_name) <= 255),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null,
  constraint media_kind_matches_mime check (
    (kind = 'image' and mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif'))
    or (kind = 'animated' and mime_type in ('image/gif', 'image/webp'))
    or (kind = 'video' and mime_type in ('video/mp4', 'video/webm'))
  )
);

comment on table public.media is 'Media library. storage_path is the object key in the media bucket and the `src` used in Content.';

-- ---------------------------------------------------------------------------
-- Site (singleton) and its child lists
-- ---------------------------------------------------------------------------

create table public.site (
  id                smallint primary key default 1 check (id = 1),
  placeholder       boolean not null default false,
  meta_title        text not null check (length(meta_title) between 1 and 200),
  meta_description  text not null check (length(meta_description) between 1 and 500),
  meta_author       text not null check (length(meta_author) between 1 and 100),
  meta_lang         text not null default 'en' check (meta_lang ~ '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$'),
  og_media_id       uuid not null references public.media (id) on delete restrict,
  hero_heading      text not null check (length(hero_heading) between 1 and 200),
  hero_subheading   text not null default '' check (length(hero_subheading) <= 500),
  about_heading     text not null check (length(about_heading) between 1 and 200),
  about_body        text not null default '' check (length(about_body) <= 20000), -- Markdown
  contact_heading   text not null check (length(contact_heading) between 1 and 200),
  contact_email     text not null check (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_cta_label text not null check (length(contact_cta_label) between 1 and 100),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id) on delete set null
);

create index site_og_media_id_idx on public.site (og_media_id);

create table public.socials (
  id         public.kebab_id primary key,
  label      text not null check (length(label) between 1 and 80),
  url        text not null check (url ~ '^https?://[^\s]+$' and length(url) <= 500),
  position   integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table public.categories (
  id         public.kebab_id primary key,
  slug       public.kebab_id not null unique,
  label      text not null check (length(label) between 1 and 80),
  position   integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Works
-- ---------------------------------------------------------------------------

create table public.works (
  id          public.kebab_id primary key,
  slug        public.kebab_id not null unique,
  title       text not null check (length(title) between 1 and 200),
  year        integer check (year between 1900 and 2100),
  category_id public.kebab_id not null references public.categories (id) on update cascade on delete restrict,
  tags        text[] not null default '{}' check (array_position(tags, '') is null and array_position(tags, null) is null and cardinality(tags) <= 30),
  description text not null default '' check (length(description) <= 10000),
  featured    boolean not null default false,
  sort_order  numeric, -- Content `order`; null sorts last
  placeholder boolean not null default false,
  status      public.work_status not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

create index works_category_id_idx on public.works (category_id);
create index works_status_idx on public.works (status);

-- ---------------------------------------------------------------------------
-- Media placements: a `Media` object in Content. Either a file from the
-- library (media_id) or an embed (embed_url + provider).
-- ---------------------------------------------------------------------------

create table public.media_placements (
  id              uuid primary key default gen_random_uuid(),
  slot            public.media_slot not null,
  work_id         public.kebab_id references public.works (id) on update cascade on delete cascade,
  position        integer not null default 0,
  type            public.media_type not null,
  media_id        uuid references public.media (id) on delete restrict,
  poster_media_id uuid references public.media (id) on delete restrict,
  embed_url       text check (embed_url ~ '^https://[^\s]+$' and length(embed_url) <= 500),
  provider        public.embed_provider,
  alt             text not null check (length(btrim(alt)) between 1 and 1000),
  -- Required for embeds. For files, null means "use media.width/height".
  width           integer check (width > 0),
  height          integer check (height > 0),
  loop            boolean,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,
  constraint media_placements_owner check ((slot in ('work_cover', 'work_gallery')) = (work_id is not null)),
  constraint media_placements_source check (
    case when type = 'embed'
      then media_id is null and embed_url is not null and provider is not null and width is not null and height is not null
      else media_id is not null and embed_url is null and provider is null
    end
  ),
  constraint media_placements_video_poster check (type <> 'video' or poster_media_id is not null),
  -- hero and the about portrait are rendered as single media; galleries hold files or embeds.
  constraint media_placements_slot_position check (slot = 'work_gallery' or position = 0)
);

create unique index media_placements_one_hero on public.media_placements (slot) where slot in ('hero', 'about_portrait');
create unique index media_placements_one_cover on public.media_placements (work_id) where slot = 'work_cover';
create unique index media_placements_gallery_position on public.media_placements (work_id, position) where slot = 'work_gallery';
create index media_placements_media_id_idx on public.media_placements (media_id);
create index media_placements_poster_media_id_idx on public.media_placements (poster_media_id);

-- The placement type must agree with the library file kind (an `image` placement
-- cannot point at an mp4, and so on).
create function public.check_placement_media_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  file_kind public.media_type;
  poster_kind public.media_type;
begin
  if new.media_id is not null then
    select kind into file_kind from public.media where id = new.media_id;
    if file_kind is distinct from new.type then
      raise exception 'media_placements: type % does not match media kind %', new.type, file_kind
        using errcode = '23514';
    end if;
  end if;
  if new.poster_media_id is not null then
    select kind into poster_kind from public.media where id = new.poster_media_id;
    if poster_kind is distinct from 'image' then
      raise exception 'media_placements: poster must be an image, got %', poster_kind
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger media_placements_check_kind
  before insert or update of type, media_id, poster_media_id on public.media_placements
  for each row execute function public.check_placement_media_kind();

-- ---------------------------------------------------------------------------
-- Layout: ordered home sections (`layout.sections` in Content).
-- ---------------------------------------------------------------------------

create table public.layout (
  section_id public.section_id primary key,
  position   integer not null,
  visible    boolean not null default true,
  -- Section options without the featured work list (see layout_featured_works).
  --   featured: {"limit"?: int > 0}
  --   grid:     {"columns"?: {"sm","md","lg": 1..6}, "masonry"?: bool, "showFilters"?: bool}
  --   others:   {}
  options    jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint layout_position_unique unique (position) deferrable initially deferred,
  constraint layout_options_shape check (
    case section_id
      when 'featured' then
        (options - 'limit') = '{}'::jsonb
        and (not options ? 'limit' or (jsonb_typeof(options -> 'limit') = 'number' and (options ->> 'limit') ~ '^[1-9][0-9]{0,2}$'))
      when 'grid' then
        (options - 'columns' - 'masonry' - 'showFilters') = '{}'::jsonb
        and (not options ? 'masonry' or jsonb_typeof(options -> 'masonry') = 'boolean')
        and (not options ? 'showFilters' or jsonb_typeof(options -> 'showFilters') = 'boolean')
        and (not options ? 'columns' or (
          jsonb_typeof(options -> 'columns') = 'object'
          and ((options -> 'columns') - 'sm' - 'md' - 'lg') = '{}'::jsonb
          -- All three keys required, as JSON integers 1..6. A missing key would
          -- make the regex NULL, which a CHECK treats as a pass.
          and (options -> 'columns') ?& array['sm', 'md', 'lg']
          and jsonb_typeof(options -> 'columns' -> 'sm') = 'number' and (options -> 'columns' ->> 'sm') ~ '^[1-6]$'
          and jsonb_typeof(options -> 'columns' -> 'md') = 'number' and (options -> 'columns' ->> 'md') ~ '^[1-6]$'
          and jsonb_typeof(options -> 'columns' -> 'lg') = 'number' and (options -> 'columns' ->> 'lg') ~ '^[1-6]$'
        ))
      else options = '{}'::jsonb
    end
  )
);

comment on table public.layout is 'Home sections in display order. One row per section id.';

-- `layout.sections[featured].options.workIds`, with referential integrity.
create table public.layout_featured_works (
  work_id    public.kebab_id primary key references public.works (id) on update cascade on delete cascade,
  position   integer not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint layout_featured_works_position_unique unique (position) deferrable initially deferred
);
