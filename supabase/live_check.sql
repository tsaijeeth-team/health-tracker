-- =====================================================================
-- Health Tracker: LIVE CHECK of the real database (build step 4)
--
-- Run in Supabase: SQL Editor -> New query -> paste ALL -> Run.
-- Do not highlight part of it: the editor would run only the highlighted part.
--
-- NOTHING IS SAVED. Four separate safety nets:
--   1. The whole script is one transaction: first line BEGIN, last line ROLLBACK.
--      There is no save (commit) command anywhere in this file.
--   2. The check ends by stopping with a message (shown in red). A stopped
--      transaction can never be saved; PostgreSQL discards it.
--   3. The Supabase SQL Editor closes its connection after every run, and an
--      unfinished transaction is discarded when its connection closes.
--   4. Test data uses far-away dates (2000-01-01 and 2099-12-31). If either
--      date already exists in your data, the check refuses to start.
--
-- The result is shown as an ERROR message on purpose; that is the only way
-- the editor can display it before the ROLLBACK line. Read the text:
--   "LIVE CHECK PASSED ..."  = all good.
--   "LIVE CHECK FAILED ..."  = send a screenshot.
-- =====================================================================

begin;

do $live_check$
declare
  owner_id   uuid;
  test_day   uuid;
  future_day uuid;
  food_id    uuid;
  passed     int := 0;
  failures   text[] := '{}';
  err        text;
  n          int;
  val        text;
begin
  -- Safety: there must be exactly one user (you), and the test dates must be unused.
  select count(*) into n from auth.users;
  if n <> 1 then
    raise exception 'LIVE CHECK NOT STARTED: expected exactly 1 user, found %.', n;
  end if;
  select id into owner_id from auth.users;
  if exists (select 1 from public.days where log_date in ('2000-01-01', '2099-12-31')) then
    raise exception 'LIVE CHECK NOT STARTED: a day dated 2000-01-01 or 2099-12-31 already exists.';
  end if;

  -- Act as you, logged in through the app.
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ---- 1. Owner can create and edit an unlocked day ----
  begin
    insert into public.days (log_date, weight_kg, bedtime, wake_time)
      values ('2000-01-01', 80.0, '23:30', '07:00')
      returning id into test_day;
    insert into public.days (log_date) values ('2099-12-31') returning id into future_day;
    insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal)
      values (test_day, 'lunch', 'TEST', 100, 'cooked', 100)
      returning id into food_id;
    insert into public.fluids (day_id, drink_time, drink_type, ml) values (test_day, '08:00', 'water', 500);
    insert into public.cardio_sessions (day_id, cardio_type, minutes, start_time) values (test_day, 'walk', 10, '06:00');
    passed := passed + 1;
  exception when others then
    failures := failures || ('owner can add data: ' || sqlerrm);
  end;

  -- ---- 2. Sleep duration is calculated across midnight ----
  select sleep_minutes::text into val from public.days where id = test_day;
  if val = '450' then passed := passed + 1;
  else failures := failures || ('sleep 23:30 -> 07:00 should be 450 min, got ' || coalesce(val, 'nothing'));
  end if;

  -- ---- 3. Data checks ----
  begin
    insert into public.fluids (day_id, drink_time, drink_type, ml, kcal) values (test_day, '09:00', 'lassi', 200, 150);
    failures := failures || 'kcal on lassi was NOT blocked'::text;
  exception when others then passed := passed + 1;
  end;

  -- ---- 4. Future day (India time) cannot be confirmed ----
  begin
    update public.days set confirmed_at = now() where id = future_day;
    failures := failures || 'confirming 2099-12-31 was NOT blocked'::text;
  exception when others then
    if sqlerrm ilike '%future%' then passed := passed + 1;
    else failures := failures || ('future confirm blocked for the wrong reason: ' || sqlerrm);
    end if;
  end;

  -- ---- 5. Past day can be confirmed; time comes from the server clock ----
  begin
    update public.days set confirmed_at = '1990-01-01' where id = test_day;
    get diagnostics n = row_count;
    if n = 1 and (select confirmed_at > now() - interval '1 minute' from public.days where id = test_day) then
      passed := passed + 1;
    else
      failures := failures || 'confirm did not use the server clock'::text;
    end if;
  exception when others then
    failures := failures || ('could not confirm 2000-01-01: ' || sqlerrm);
  end;

  -- ---- 6-13. Locked day: every change must be refused ----
  begin
    update public.days set weight_kg = 70.0 where id = test_day;
    failures := failures || 'locked: weight change was NOT blocked'::text;
  exception when others then passed := passed + 1;
  end;
  begin
    update public.days set confirmed_at = null where id = test_day;
    failures := failures || 'locked: un-confirm was NOT blocked'::text;
  exception when others then passed := passed + 1;
  end;
  begin
    delete from public.days where id = test_day;
    failures := failures || 'locked: day delete was NOT blocked'::text;
  exception when others then passed := passed + 1;
  end;
  begin
    insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal)
      values (test_day, 'snack', 'TEST', 10, 'raw', 10);
    failures := failures || 'locked: adding food was NOT blocked'::text;
  exception when others then passed := passed + 1;
  end;
  begin
    update public.food_items set kcal = 1 where id = food_id;
    failures := failures || 'locked: editing food was NOT blocked'::text;
  exception when others then passed := passed + 1;
  end;
  begin
    delete from public.fluids where day_id = test_day;
    failures := failures || 'locked: deleting fluids was NOT blocked'::text;
  exception when others then passed := passed + 1;
  end;
  begin
    insert into public.cardio_sessions (day_id, cardio_type, minutes, start_time) values (test_day, 'run', 5, '18:00');
    failures := failures || 'locked: adding cardio was NOT blocked'::text;
  exception when others then passed := passed + 1;
  end;
  begin
    update public.food_items set day_id = future_day where id = food_id;
    failures := failures || 'locked: moving food out was NOT blocked'::text;
  exception when others then passed := passed + 1;
  end;

  -- ---- 14-15. Notes: add yes, edit no ----
  begin
    insert into public.day_notes (day_id, body) values (test_day, 'TEST note');
    passed := passed + 1;
  exception when others then
    failures := failures || ('could not add a note to a locked day: ' || sqlerrm);
  end;
  begin
    update public.day_notes set body = 'changed' where day_id = test_day;
    failures := failures || 'editing a note was NOT blocked'::text;
  exception when others then passed := passed + 1;
  end;

  -- ---- 16. The website cannot call private helpers ----
  begin
    perform private.today_ist();
    failures := failures || 'private helper was callable'::text;
  exception when others then passed := passed + 1;
  end;

  -- ---- 17-19. Logged-out visitor gets nothing ----
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform 1 from public.days;
    failures := failures || 'visitor could read days'::text;
  exception when others then passed := passed + 1;
  end;
  begin
    perform 1 from public.food_items;
    failures := failures || 'visitor could read food'::text;
  exception when others then passed := passed + 1;
  end;
  begin
    insert into public.days (log_date) values ('2000-01-02');
    failures := failures || 'visitor could write days'::text;
  exception when others then passed := passed + 1;
  end;

  -- ---- 20. Even the dashboard (database owner) cannot change a locked day ----
  reset role;
  begin
    update public.days set weight_kg = 60.0 where id = test_day;
    failures := failures || 'dashboard could change a locked day'::text;
  exception when others then passed := passed + 1;
  end;

  -- ---- Report (stops the transaction on purpose, so nothing is saved) ----
  if cardinality(failures) = 0 then
    raise exception 'LIVE CHECK PASSED: % of 20 checks passed. Everything was undone; nothing was saved.', passed;
  else
    raise exception 'LIVE CHECK FAILED: % passed, % failed: %. Nothing was saved.',
      passed, cardinality(failures), array_to_string(failures, ' | ');
  end if;
end;
$live_check$;

rollback;
