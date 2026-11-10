-- Page slugs the pages manager relies on: unique, kebab-case, not reserved; one home; fixed positions.
-- Run as an editor (Cesart) so the checks go through RLS like the dashboard does.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok($$insert into public.pages (slug, title, status, position) values ('journal', 'Journal', 'published', 10)$$, 'a new slug is accepted');
select throws_ok($$insert into public.pages (slug, title, status, position) values ('journal', 'Journal again', 'draft', 11)$$, '23505', null, 'a duplicate slug is refused');
select throws_ok($$insert into public.pages (slug, title, status, position) values ('Bad Slug', 'Bad', 'draft', 12)$$, '23514', null, 'a slug that is not kebab-case is refused');
select throws_ok($$insert into public.pages (slug, title, status, position) values ('trailing-', 'Bad', 'draft', 12)$$, '23514', null, 'a slug ending in a dash is refused');
select throws_ok($$insert into public.pages (slug, title, status, position) values ('admin', 'Admin', 'draft', 12)$$, '23514', null, 'a reserved slug is refused');
select throws_ok($$insert into public.pages (slug, title, status, position) values ('_private', 'Private', 'draft', 12)$$, '23514', null, 'a slug starting with an underscore is refused');
select throws_ok($$update public.pages set slug = (select slug from public.pages where is_home) where slug = 'journal'$$, '23505', null, 'renaming a page to the home slug is refused');
select lives_ok($$update public.pages set slug = 'journal-2' where slug = 'journal'$$, 'a page can be renamed to a free slug');
set constraints pages_position_unique immediate;
select throws_ok($$insert into public.pages (slug, title, status, position) values ('twin-position', 'Twin', 'draft', 10)$$, '23505', null, 'two pages cannot share a position');

select * from finish();
rollback;
