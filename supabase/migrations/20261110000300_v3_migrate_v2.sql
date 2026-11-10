-- v2 -> v3 data migration: the default theme (the v2 look), and the v2 home
-- (site texts, layout, featured list, placements) as a home page with sections.
-- Contract: docs/V3-CONTRACTS.md §7. Rollback: supabase/rollbacks/20261110000300_v3_migrate_v2.down.sql
--
-- migrate_v2_to_v3() runs at the end of this file. On a fresh stack the v2
-- tables are still empty at that point, so seed.sql calls it again after
-- inserting the v2 rows. It does nothing once any page exists.

-- ---------------------------------------------------------------------------
-- Markdown subset -> rich text (RichText in schema-v3.ts)
-- ---------------------------------------------------------------------------

-- Plain string -> InlineText ([] when blank).
create function public.text_to_inline(p text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(btrim(p), '') = '' then '[]'::jsonb
              else jsonb_build_array(jsonb_build_object('type', 'text', 'text', btrim(p))) end;
$$;

-- Inline Markdown -> InlineText. Understands **bold**, *italic*, _italic_ and
-- [label](href) with an http(s)/mailto/relative href; anything else stays
-- literal text. Line breaks become spaces, as in Markdown.
create function public.md_inline_to_richtext(p text)
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

-- Markdown -> RichText doc. Blocks are separated by blank lines: "#..." is a
-- heading (level clamped to 2-4), a block of "- " lines a bullet list, a block
-- of "1. " lines an ordered list, anything else a paragraph.
create function public.md_to_richtext(p text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  blk text;
  nodes jsonb := '[]'::jsonb;
  inline jsonb;
begin
  for blk in
    select b from regexp_split_to_table(btrim(replace(coalesce(p, ''), E'\r\n', E'\n'), E' \n\t'), E'\n[ \t]*\n[[:space:]]*') b
    where btrim(b, E' \n\t') <> ''
  loop
    if blk ~ '^#{1,6}[ \t]' then
      inline := public.md_inline_to_richtext(btrim(regexp_replace(blk, '^#+[ \t]+', '')));
      nodes := nodes || jsonb_build_array(public.json_omit_nulls(jsonb_build_object(
        'type', 'heading',
        'attrs', jsonb_build_object('level', least(greatest(length(substring(blk from '^(#+)')), 2), 4)),
        'content', case when inline <> '[]'::jsonb then inline end)));
    elsif not exists (select 1 from regexp_split_to_table(blk, E'\n') l where l !~ '^[ \t]*[-*+][ \t]+') then
      nodes := nodes || jsonb_build_array(jsonb_build_object('type', 'bulletList', 'content', (
        select jsonb_agg(jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(
                 jsonb_build_object('type', 'paragraph', 'content', public.md_inline_to_richtext(regexp_replace(l, '^[ \t]*[-*+][ \t]+', '')))))
               order by o)
        from regexp_split_to_table(blk, E'\n') with ordinality as x(l, o))));
    elsif not exists (select 1 from regexp_split_to_table(blk, E'\n') l where l !~ '^[ \t]*[0-9]+[.)][ \t]+') then
      nodes := nodes || jsonb_build_array(jsonb_build_object('type', 'orderedList', 'content', (
        select jsonb_agg(jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(
                 jsonb_build_object('type', 'paragraph', 'content', public.md_inline_to_richtext(regexp_replace(l, '^[ \t]*[0-9]+[.)][ \t]+', '')))))
               order by o)
        from regexp_split_to_table(blk, E'\n') with ordinality as x(l, o))));
    else
      inline := public.md_inline_to_richtext(btrim(blk, E' \n\t'));
      nodes := nodes || jsonb_build_array(public.json_omit_nulls(jsonb_build_object(
        'type', 'paragraph', 'content', case when inline <> '[]'::jsonb then inline end)));
    end if;
  end loop;
  return jsonb_build_object('type', 'doc', 'content', nodes);
end;
$$;

-- ---------------------------------------------------------------------------
-- Default theme: the v2 look (src/styles/tokens.css). Must equal
-- DEFAULT_THEME_TOKENS in src/lib/schema-v3.ts (tests/unit/schema-v3.test.ts
-- reads the JSON between the markers below).
-- ---------------------------------------------------------------------------

create function public.default_theme_tokens()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select
-- BEGIN DEFAULT_THEME_TOKENS
'{
  "colors": {
    "light": {
      "background": "#f6f5f2", "surface": "#ffffff", "text": "#1b1b1a", "muted": "#5d5c58",
      "accent": "#8a3b2a", "accentContrast": "#ffffff", "border": "#dcdad4", "focus": "#1a5fd0"
    },
    "dark": {
      "background": "#121211", "surface": "#1b1b19", "text": "#efede8", "muted": "#a3a19a",
      "accent": "#e08a73", "accentContrast": "#121211", "border": "#2f2e2b", "focus": "#7fb0ff"
    }
  },
  "typography": {
    "headingFont": "system-serif", "bodyFont": "system-sans", "scale": "medium",
    "headingWeight": 400, "bodyWeight": 400, "lineHeight": 1.6, "headingLineHeight": 1.1,
    "letterSpacing": 0, "headingLetterSpacing": 0, "headingCase": "none"
  },
  "spacing": { "scale": "medium" },
  "buttons": { "shape": "pill", "style": "solid", "textCase": "none" },
  "radius": "medium",
  "links": { "underline": "always", "color": "text" },
  "motion": { "enabled": true }
}'
-- END DEFAULT_THEME_TOKENS
  ::jsonb;
$$;

insert into public.theme (id, preset, tokens) values (1, 'classic', public.default_theme_tokens())
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- v2 -> v3
-- ---------------------------------------------------------------------------

-- A v2 single-media placement (hero, about_portrait) as a MediaRef, or null.
-- Embeds have no v3 equivalent (video is self-hosted only) and are dropped.
create function public.v2_placement_ref(p_slot public.media_slot)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select public.json_omit_nulls(jsonb_build_object(
    'mediaId', p.media_id,
    'posterId', p.poster_media_id,
    'alt', p.alt,
    'loop', to_jsonb(p.loop),
    'width', p.width,
    'height', p.height
  ))
  from public.media_placements p
  where p.slot = p_slot and p.type <> 'embed' and p.media_id is not null;
$$;

-- Builds the home page from the v2 draft tables, so that with the default
-- theme it renders like the v2 home. Idempotent: returns false (and changes
-- nothing) when a page already exists or there is no v2 site row.
create function public.migrate_v2_to_v3()
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  s public.site;
  home_id uuid := gen_random_uuid();
  l record;
  n integer := 0;
  shown boolean;
  grid_shown boolean := false;
  about_shown boolean := false;
  contact_shown boolean := exists (select 1 from public.layout where section_id = 'contact' and visible);
  nav_items jsonb := '[]'::jsonb;
begin
  if exists (select 1 from public.pages) then
    return false;
  end if;
  select * into s from public.site where id = 1;
  if not found then
    return false;
  end if;

  insert into public.theme (id, preset, tokens) values (1, 'classic', public.default_theme_tokens())
  on conflict (id) do nothing;

  insert into public.pages (id, slug, title, status, is_home, position)
  values (home_id, 'home', 'Home', 'published', true, 0);

  for l in select * from public.layout order by position loop
    shown := l.visible;
    case l.section_id
      when 'hero' then
        insert into public.sections (page_id, type, variant, position, settings, content, show_on_desktop, show_on_tablet, show_on_mobile)
        values (home_id, 'hero', 'default', n, '{}'::jsonb,
          public.json_omit_nulls(jsonb_build_object(
            'heading', public.text_to_inline(s.hero_heading),
            'subheading', case when btrim(s.hero_subheading) <> '' then public.text_to_inline(s.hero_subheading) end,
            'media', public.v2_placement_ref('hero'))),
          shown, shown, shown);
      when 'featured' then
        insert into public.sections (page_id, type, variant, position, settings, content, show_on_desktop, show_on_tablet, show_on_mobile)
        values (home_id, 'featured', 'default', n,
          jsonb_build_object('anchor', 'featured',
            'workIds', coalesce((select jsonb_agg(f.work_id order by f.position) from public.layout_featured_works f), '[]'::jsonb))
          || case when l.options ? 'limit' then jsonb_build_object('limit', l.options -> 'limit') else '{}'::jsonb end,
          jsonb_build_object('heading', public.text_to_inline('Featured')),
          shown, shown, shown);
      when 'grid' then
        grid_shown := shown;
        insert into public.sections (page_id, type, variant, position, settings, content, show_on_desktop, show_on_tablet, show_on_mobile)
        values (home_id, 'gallery',
          case when (l.options ->> 'masonry')::boolean is false then 'grid' else 'default' end,
          n,
          jsonb_build_object(
            'anchor', 'work',
            'source', jsonb_build_object('kind', 'all'),
            'sort', 'default',
            'columns', coalesce(l.options -> 'columns', '{"sm": 1, "md": 2, "lg": 3}'::jsonb),
            'showFilters', coalesce((l.options ->> 'showFilters')::boolean, true)),
          jsonb_build_object(
            'heading', public.text_to_inline('Work'),
            'emptyText', public.text_to_inline('No work in this category yet.')),
          shown, shown, shown);
        -- v2 drew a "Have a project in mind?" band at the end of the grid when contact was shown.
        n := n + 1;
        shown := shown and contact_shown;
        insert into public.sections (page_id, type, variant, position, settings, content, show_on_desktop, show_on_tablet, show_on_mobile)
        values (home_id, 'cta', 'default', n,
          '{"paddingTop": "none"}'::jsonb,
          jsonb_build_object(
            'heading', public.text_to_inline('Have a project in mind?'),
            'buttons', jsonb_build_array(jsonb_build_object(
              'label', s.contact_cta_label,
              'link', '{"kind": "anchor", "anchor": "contact"}'::jsonb,
              'style', 'primary'))),
          shown, shown, shown);
      when 'about' then
        about_shown := shown;
        insert into public.sections (page_id, type, variant, position, settings, content, show_on_desktop, show_on_tablet, show_on_mobile)
        values (home_id, 'about', 'default', n, '{"anchor": "about"}'::jsonb,
          public.json_omit_nulls(jsonb_build_object(
            'heading', public.text_to_inline(s.about_heading),
            'body', public.md_to_richtext(s.about_body),
            'portrait', public.v2_placement_ref('about_portrait'))),
          shown, shown, shown);
      when 'contact' then
        insert into public.sections (page_id, type, variant, position, settings, content, show_on_desktop, show_on_tablet, show_on_mobile)
        values (home_id, 'contact', 'default', n, '{"anchor": "contact", "showEmail": true, "showSocials": true}'::jsonb,
          jsonb_build_object(
            'heading', public.text_to_inline(s.contact_heading),
            'email', s.contact_email,
            'ctaLabel', s.contact_cta_label),
          shown, shown, shown);
    end case;
    n := n + 1;
  end loop;

  -- v2 header: Work / About / Contact anchors for the visible sections, and the CTA button.
  if grid_shown then
    nav_items := nav_items || jsonb_build_array(jsonb_build_object('id', 'work', 'label', 'Work',
      'link', jsonb_build_object('kind', 'page', 'pageId', home_id, 'anchor', 'work')));
  end if;
  if about_shown then
    nav_items := nav_items || jsonb_build_array(jsonb_build_object('id', 'about', 'label', 'About',
      'link', jsonb_build_object('kind', 'page', 'pageId', home_id, 'anchor', 'about')));
  end if;
  if contact_shown then
    nav_items := nav_items || jsonb_build_array(jsonb_build_object('id', 'contact', 'label', 'Contact',
      'link', jsonb_build_object('kind', 'page', 'pageId', home_id, 'anchor', 'contact')));
  end if;

  update public.site
     set nav = jsonb_build_object(
           'items', nav_items,
           'cta', jsonb_build_object(
             'label', s.contact_cta_label,
             'style', 'primary',
             'link', case when contact_shown
                       then jsonb_build_object('kind', 'page', 'pageId', home_id, 'anchor', 'contact')
                       else jsonb_build_object('kind', 'url', 'url', 'mailto:' || s.contact_email) end)),
         footer = '{"links": [], "showSocials": false, "showCopyright": true, "showBackToTop": true}'::jsonb
   where id = 1;

  return true;
end;
$$;

revoke execute on function
  public.text_to_inline(text),
  public.md_inline_to_richtext(text),
  public.md_to_richtext(text),
  public.default_theme_tokens(),
  public.v2_placement_ref(public.media_slot),
  public.migrate_v2_to_v3()
from public, anon, authenticated;
grant execute on function
  public.text_to_inline(text),
  public.md_inline_to_richtext(text),
  public.md_to_richtext(text),
  public.default_theme_tokens(),
  public.v2_placement_ref(public.media_slot),
  public.migrate_v2_to_v3()
to service_role;

-- Hosted projects already have v2 rows: convert them now.
select public.migrate_v2_to_v3();
