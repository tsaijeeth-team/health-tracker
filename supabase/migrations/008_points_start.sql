-- =====================================================================
-- Health Tracker: database change 008 (points start date)
--
-- Run ONCE in Supabase, AFTER 007_points.sql: SQL Editor -> New query ->
-- paste -> Run.
--
-- Moves the points start date to Mon, 5 Oct 2026 (retrospective; owner's
-- instruction, 6 Oct 2026). 5 and 6 Oct then count under the normal rules,
-- including the 7-day confirm deadline (12 and 13 Oct, 23:59 India time).
-- Changes only this one date: no data, no rules, no lock.
-- All or nothing: if 007 has not been run, it stops and changes nothing.
-- =====================================================================

do $$
begin
  if to_regclass('public.points_settings') is null then
    raise exception 'Run 007_points.sql first (points_settings does not exist). Nothing was changed.';
  end if;

  insert into public.points_settings (user_id, start_date)
    select u.id, date '2026-10-05' from auth.users u
    on conflict (user_id) do update set start_date = excluded.start_date;
end;
$$;
