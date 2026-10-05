-- =====================================================================
-- Health Tracker: LIVE CHECK of the real database (build steps 4 and 11)
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
  v_token    text;
  ok         boolean;
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

  -- ---- 21-25. Security audit of the real database (read-only) ----
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if n = 0 then passed := passed + 1; else failures := failures || (n || ' table(s) without owner-only rules')::text; end if;

  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind in ('r', 'v', 'm')
      and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
        or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'));
  if n = 0 then passed := passed + 1; else failures := failures || ('visitors have access to ' || n || ' table(s)')::text; end if;

  select coalesce(string_agg(p.proname, ',' order by p.proname), '') into val
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  if val = 'get_shared_progress' then passed := passed + 1;
  else failures := failures || ('visitors can call: [' || val || '] (expected only get_shared_progress)')::text; end if;

  if not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('authenticated', 'private', 'usage') then
    passed := passed + 1;
  else failures := failures || 'private helpers are reachable from the website'::text; end if;

  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname in ('public', 'private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');
  if n = 0 then passed := passed + 1; else failures := failures || (n || ' privileged function(s) without a fixed search path')::text; end if;

  -- ---- 26-29. Later data rules, as you ----
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal, fibre_total_g, fibre_soluble_g, fibre_insoluble_g)
      values (future_day, 'lunch', 'TEST', 40, 'raw', 150, 4, 2, 2.5);
    failures := failures || 'soluble + insoluble above total fibre was NOT blocked'::text;
  exception when others then passed := passed + 1;
  end;
  begin
    insert into public.fluids (day_id, drink_time, drink_type, ml, description) values (future_day, '10:00', 'water', 200, 'TEST');
    failures := failures || 'description on water was NOT blocked'::text;
  exception when others then passed := passed + 1;
  end;
  begin
    insert into public.cardio_sessions (day_id, cardio_type, minutes, start_time, description) values (future_day, 'other', 30, '18:00', 'TEST');
    passed := passed + 1;
  exception when others then
    failures := failures || ('could not add cardio "Other" with a description: ' || sqlerrm);
  end;
  begin
    insert into public.share_links (label) values ('TEST live check') returning token into v_token;
    passed := passed + 1;
  exception when others then
    failures := failures || ('could not create a share link: ' || sqlerrm);
  end;

  -- ---- 30-32. Share page, as a logged-out visitor ----
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    select exists (select 1 from jsonb_array_elements(public.get_shared_progress(v_token)->'days') e where e->>'date' = '2000-01-01')
       and not exists (select 1 from jsonb_array_elements(public.get_shared_progress(v_token)->'days') e where e->>'date' = '2099-12-31')
      into ok;
    if ok then passed := passed + 1;
    else failures := failures || 'share page did not show exactly the confirmed test day'::text; end if;
  exception when others then
    failures := failures || ('visitor could not use the share link: ' || sqlerrm);
  end;
  begin
    select coalesce(bool_and((select array_agg(k order by k) from jsonb_object_keys(e) k) =
        array['bedtime','cardio','date','fluids','food','junk_meals','sleep_minutes','steps','wake_time','weight_kg']), true)
      into ok from jsonb_array_elements(public.get_shared_progress(v_token)->'days') e;
    if ok then passed := passed + 1;
    else failures := failures || 'share page returned fields outside the allowed list'::text; end if;
  exception when others then
    failures := failures || ('share field check failed: ' || sqlerrm);
  end;
  begin
    perform 1 from public.share_links;
    failures := failures || 'visitor could read share links'::text;
  exception when others then passed := passed + 1;
  end;

  -- ---- 33-34. Switching a link off is immediate and permanent ----
  reset role;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.share_links set revoked_at = now() where token = v_token;
    if public.get_shared_progress(v_token) is null then passed := passed + 1;
    else failures := failures || 'switched-off link still works'::text; end if;
  exception when others then
    failures := failures || ('could not switch off the link: ' || sqlerrm);
  end;
  begin
    update public.share_links set revoked_at = null where token = v_token;
    failures := failures || 'a switched-off link could be re-activated'::text;
  exception when others then passed := passed + 1;
  end;
  reset role;

  -- ---- Report (stops the transaction on purpose, so nothing is saved) ----
  if cardinality(failures) = 0 then
    raise exception 'LIVE CHECK PASSED: % of 34 checks passed. Everything was undone; nothing was saved.', passed;
  else
    raise exception 'LIVE CHECK FAILED: % passed, % failed: %. Nothing was saved.',
      passed, cardinality(failures), array_to_string(failures, ' | ');
  end if;
end;
$live_check$;

rollback;
