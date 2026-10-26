-- Analytics: only the service role (track Edge Function) can record events,
-- rate limiting holds, payload checks hold, and only editors read stats.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- ===========================================================================
-- service_role (the track Edge Function)
-- ===========================================================================
set local role service_role;

select ok(public.record_event('page_view', '/CesartPortfolio/', null, 'www.instagram.com', 'mobile', repeat('a', 64)), 'service role can record a page view');
select ok(public.record_event('work_open', '/CesartPortfolio/work/placeholder-animation-01/', 'placeholder-animation-01', null, 'desktop', repeat('b', 64)), 'service role can record a work open');
select ok(public.record_event('video_play', '/CesartPortfolio/', null, null, 'desktop', repeat('b', 64)), 'video_play without a work is allowed (hero reel)');

select throws_ok($$select public.record_event('page_view', 'https://evil.example/')$$, '23514', null, 'path must be a site path');
select throws_ok($$select public.record_event('work_open', '/x/')$$, '23514', null, 'work_open needs a work slug');
select throws_ok($$select public.record_event('page_view', '/', null, null, 'desktop', '203.0.113.7')$$, '23514', null, 'a raw IP is rejected as visitor hash');
select throws_ok($$select public.record_event('page_view', '/', null, null, 'desktop', null, jsonb_build_object('blob', repeat('x', 2000)))$$, '23514', null, 'props over 1 KiB are rejected');

-- 60 events per visitor per minute: the first call above was #1.
select is(
  (select count(*)::int from generate_series(1, 70) g where public.record_event('page_view', '/', null, null, 'mobile', repeat('a', 64))),
  59,
  'a visitor is capped at 60 events per minute'
);

reset role;

-- ===========================================================================
-- reading stats
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

select results_eq(
  $$select page_views, visitors, work_opens, video_plays, contact_clicks from public.stats_overview(now() - interval '1 day', now() + interval '1 minute')$$,
  $$values (60::bigint, 1::bigint, 1::bigint, 1::bigint, 0::bigint)$$,
  'editor reads the overview'
);
select results_eq(
  $$select work_slug, title, opens from public.stats_top_works(now() - interval '1 day', now() + interval '1 minute')$$,
  $$values ('placeholder-animation-01'::text, 'Placeholder Loop 01'::text, 1::bigint)$$,
  'editor reads top works with titles'
);
select throws_ok($$select * from public.stats_overview(now(), now() - interval '1 day')$$, 'PT422', null, 'an inverted range is rejected');
select throws_ok($$select public.record_event('page_view', '/')$$, '42501', null, 'editors cannot record events directly');

reset role;

set local role anon;
select throws_ok($$select * from public.stats_daily(now() - interval '7 days', now())$$, '42501', null, 'anon cannot read stats');
reset role;

select * from finish();
rollback;
