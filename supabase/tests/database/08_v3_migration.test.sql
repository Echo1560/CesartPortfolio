-- v2 -> v3 migration result on the seeded v2 content (seed.sql runs
-- migrate_v2_to_v3()), the Markdown converter, and the default theme.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select results_eq(
  $$select slug::text, status::text, is_home from public.pages$$,
  $$values ('home', 'published', true)$$,
  'v2 content becomes one published home page'
);
select results_eq(
  $$select s.type::text, s.variant, s.settings ->> 'anchor' from public.sections s order by s.position$$,
  $$values ('hero', 'default', null::text), ('featured', 'default', 'featured'), ('gallery', 'default', 'work'),
           ('cta', 'default', null), ('about', 'default', 'about'), ('contact', 'default', 'contact')$$,
  'the v2 layout becomes sections in the same order, with the v2 anchors'
);
select ok(
  (select bool_and(show_on_desktop and show_on_tablet and show_on_mobile) from public.sections),
  'every v2 section was visible, so every section shows on every device'
);
select is((select count(*)::int from public.blocks), 0, 'the v2 home has no blocks');

-- Content -------------------------------------------------------------------
select is(
  (select content #>> '{heading,0,text}' from public.sections where type = 'hero'),
  (select hero_heading from public.site),
  'the hero heading comes from site.hero_heading'
);
select is(
  (select (content #>> '{media,mediaId}')::uuid from public.sections where type = 'hero'),
  (select media_id from public.media_placements where slot = 'hero'),
  'the hero media is the v2 hero placement'
);
select is(
  (select content #>> '{media,posterId}' from public.sections where type = 'hero') is not null,
  true,
  'the hero video keeps its poster'
);
select is(
  (select settings -> 'workIds' from public.sections where type = 'featured'),
  (select jsonb_agg(work_id order by position) from public.layout_featured_works),
  'featured works keep the v2 list and order'
);
select is((select settings -> 'limit' from public.sections where type = 'featured'), '6'::jsonb, 'the featured limit is kept');
select is(
  (select settings - 'anchor' from public.sections where type = 'gallery'),
  '{"sort": "default", "source": {"kind": "all"}, "columns": {"sm": 1, "md": 2, "lg": 3}, "showFilters": true}'::jsonb,
  'the grid options become gallery settings (masonry = the default variant)'
);
select is(
  (select content #> '{buttons,0}' from public.sections where type = 'cta'),
  '{"label": "Commissions (placeholder)", "link": {"kind": "anchor", "anchor": "contact"}, "style": "primary"}'::jsonb,
  'the v2 commissions band becomes a CTA section linking to #contact'
);
select is(
  (select content #> '{body,content,1,content,0}' from public.sections where type = 'about'),
  '{"type": "text", "text": "Services (placeholder):", "marks": [{"type": "bold"}]}'::jsonb,
  'the about Markdown becomes rich text, bold included'
);
select is(
  (select jsonb_array_length(content #> '{body,content}') from public.sections where type = 'about'),
  2,
  'the about body keeps its two paragraphs'
);
select is(
  (select content ->> 'email' from public.sections where type = 'contact'),
  (select contact_email from public.site),
  'the contact email comes from the site row'
);

-- Site and theme ------------------------------------------------------------
select is(
  (select array_agg(i ->> 'label' order by o) from public.site, jsonb_array_elements(nav -> 'items') with ordinality x(i, o)),
  array['Work', 'About', 'Contact'],
  'the nav has the v2 header links'
);
select is(
  (select nav #>> '{cta,link,anchor}' from public.site),
  'contact',
  'the nav button links to the contact section, as in v2'
);
select is((select tokens from public.theme), public.default_theme_tokens(), 'the theme is the default (v2) theme');

-- Idempotence and the live snapshot -----------------------------------------
select is(public.migrate_v2_to_v3(), false, 'running the migration again changes nothing');
select is(
  public.get_published_content() #>> '{pages,0,sections,4,content,portrait,src}',
  'placeholder/portrait.jpg',
  'the live snapshot resolves media references to bucket keys'
);
select ok(
  (select media_paths from public.publish_runs order by requested_at desc limit 1) @> array['placeholder/portrait.jpg'],
  'media used by sections are readable by the build'
);

-- Markdown converter --------------------------------------------------------
select is(
  public.md_to_richtext(E'## Rates\n\n- one\n- *two*\n\nSee [the brief](https://example.com/brief) or [this](javascript:alert(1)).'),
  '{"type": "doc", "content": [
     {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Rates"}]},
     {"type": "bulletList", "content": [
       {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "one"}]}]},
       {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "two", "marks": [{"type": "italic"}]}]}]}]},
     {"type": "paragraph", "content": [
       {"type": "text", "text": "See "},
       {"type": "text", "text": "the brief", "marks": [{"type": "link", "attrs": {"href": "https://example.com/brief"}}]},
       {"type": "text", "text": " or "},
       {"type": "text", "text": "this"},
       {"type": "text", "text": ")."}]}]}'::jsonb,
  'Markdown converts to rich text; unsafe link targets become plain text'
);
select is(public.md_to_richtext(''), '{"type": "doc", "content": []}'::jsonb, 'empty Markdown is an empty doc');

select * from finish();
rollback;
