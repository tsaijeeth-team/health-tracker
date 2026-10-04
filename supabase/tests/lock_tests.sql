-- LOCAL TESTING ONLY. Never run this in Supabase.
-- Run after supabase_stub.sql and the migration, on a throwaway database.
-- Every test records PASS/FAIL; the script ends by listing any failures.
--
-- Example (local PostgreSQL, empty database "t"):
--   psql -d t -f supabase/tests/supabase_stub.sql
--   psql -d t -f supabase/migrations/001_init.sql
--   psql -d t -f supabase/tests/lock_tests.sql

\set ON_ERROR_STOP 1
\o /dev/null

create schema test;
create table test.results (n serial, name text, ok boolean, detail text);

-- Runs one statement as a given role and user, then records whether the
-- outcome matched what we expected (an error containing some text, or a
-- number of affected rows).
create function test.run(
  p_name text, p_role text, p_uid uuid, p_sql text,
  p_expect_error text default null, p_expect_rows int default null
) returns void
language plpgsql
as $$
declare
  err text;
  n int;
  ok boolean;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    err := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  if p_expect_error is not null then
    ok := err is not null and err ilike '%' || p_expect_error || '%';
  else
    ok := err is null and (p_expect_rows is null or n = p_expect_rows);
  end if;
  insert into test.results (name, ok, detail)
    values (p_name, ok, coalesce('error: ' || err, 'rows: ' || n));
end;
$$;

create function test.check(p_name text, p_condition boolean, p_detail text default '') returns void
language sql
as $$ insert into test.results (name, ok, detail) values (p_name, p_condition, p_detail); $$;

-- Two users: A is the owner, B is an intruder.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');

\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''

-- Fixed ids for readability.
-- d1 = past day (will be locked), d4 = today, d5 = unlocked past day, d3 = tomorrow.
\set d1 '''11111111-0000-0000-0000-000000000001'''
\set d3 '''11111111-0000-0000-0000-000000000003'''
\set d4 '''11111111-0000-0000-0000-000000000004'''
\set d5 '''11111111-0000-0000-0000-000000000005'''
\set f1 '''22222222-0000-0000-0000-000000000001'''
\set f5 '''22222222-0000-0000-0000-000000000005'''

-- ---------- Owner can create and edit unlocked data ----------
select test.run('owner creates a past day', 'authenticated', :A,
  $q$insert into public.days (id, log_date, weight_kg) values ('11111111-0000-0000-0000-000000000001', '2026-10-01', 82.4)$q$, null, 1);
select test.run('owner creates an unlocked day', 'authenticated', :A,
  $q$insert into public.days (id, log_date) values ('11111111-0000-0000-0000-000000000005', '2026-10-02')$q$, null, 1);
select test.run('owner creates tomorrow (India time)', 'authenticated', :A,
  $q$insert into public.days (id, log_date) values ('11111111-0000-0000-0000-000000000003', (now() at time zone 'Asia/Kolkata')::date + 1)$q$, null, 1);
select test.run('owner creates today (India time)', 'authenticated', :A,
  $q$insert into public.days (id, log_date) values ('11111111-0000-0000-0000-000000000004', (now() at time zone 'Asia/Kolkata')::date)$q$, null, 1);
select test.run('owner adds food', 'authenticated', :A,
  $q$insert into public.food_items (id, day_id, meal, food, weight_g, weight_state, kcal, protein_g, fibre_total_g, fibre_soluble_g, is_hunger_addon, data_source)
     values ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'lunch', 'Dal', 60, 'raw', 210, 14, 6, 2, false, 'ifct')$q$, null, 1);
select test.run('owner adds food on unlocked day', 'authenticated', :A,
  $q$insert into public.food_items (id, day_id, meal, food, weight_g, weight_state, kcal)
     values ('22222222-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000005', 'dinner', 'Rice', 150, 'cooked', 195)$q$, null, 1);
select test.run('owner adds water', 'authenticated', :A,
  $q$insert into public.fluids (day_id, drink_time, drink_type, ml) values ('11111111-0000-0000-0000-000000000001', '08:00', 'water', 500)$q$, null, 1);
select test.run('maad water may have kcal', 'authenticated', :A,
  $q$insert into public.fluids (day_id, drink_time, drink_type, ml, kcal) values ('11111111-0000-0000-0000-000000000001', '13:00', 'maad_water', 250, 40)$q$, null, 1);
select test.run('owner adds cardio', 'authenticated', :A,
  $q$insert into public.cardio_sessions (day_id, cardio_type, minutes, start_time) values ('11111111-0000-0000-0000-000000000001', 'brisk_walk', 30, '06:45')$q$, null, 1);
select test.run('owner edits unlocked day', 'authenticated', :A,
  $q$update public.days set bedtime = '23:30', wake_time = '07:00', junk_meals = 1 where id = '11111111-0000-0000-0000-000000000001'$q$, null, 1);

select test.check('sleep 23:30 -> 07:00 = 450 min',
  (select sleep_minutes from public.days where id = :d1) = 450,
  (select sleep_minutes::text from public.days where id = :d1));
update public.days set bedtime = '01:00', wake_time = '07:00' where id = :d5;
select test.check('sleep 01:00 -> 07:00 = 360 min',
  (select sleep_minutes from public.days where id = :d5) = 360,
  (select sleep_minutes::text from public.days where id = :d5));

-- ---------- Data checks reject bad values ----------
select test.run('rejects sleep quality 6', 'authenticated', :A,
  $q$update public.days set sleep_quality = 6 where id = '11111111-0000-0000-0000-000000000005'$q$, 'sleep_quality');
select test.run('rejects weight with 2 decimals', 'authenticated', :A,
  $q$update public.days set weight_kg = 82.45 where id = '11111111-0000-0000-0000-000000000005'$q$, 'weight_kg');
select test.run('rejects same bedtime and wake time', 'authenticated', :A,
  $q$update public.days set bedtime = '07:00', wake_time = '07:00' where id = '11111111-0000-0000-0000-000000000005'$q$, 'bedtime_differs_from_wake_time');
select test.run('rejects stress 11', 'authenticated', :A,
  $q$update public.days set stress = 11 where id = '11111111-0000-0000-0000-000000000005'$q$, 'stress');
select test.run('rejects negative junk meals', 'authenticated', :A,
  $q$update public.days set junk_meals = -1 where id = '11111111-0000-0000-0000-000000000005'$q$, 'junk_meals');
select test.run('rejects kcal on lassi', 'authenticated', :A,
  $q$insert into public.fluids (day_id, drink_time, drink_type, ml, kcal) values ('11111111-0000-0000-0000-000000000005', '10:00', 'lassi', 200, 150)$q$, 'kcal_only_for_allowed_drinks');
select test.run('rejects kcal on green tea', 'authenticated', :A,
  $q$insert into public.fluids (day_id, drink_time, drink_type, ml, kcal) values ('11111111-0000-0000-0000-000000000005', '10:00', 'green_tea', 200, 5)$q$, 'kcal_only_for_allowed_drinks');
select test.run('rejects unknown drink type', 'authenticated', :A,
  $q$insert into public.fluids (day_id, drink_time, drink_type, ml) values ('11111111-0000-0000-0000-000000000005', '10:00', 'beer', 200)$q$, 'drink_type');
select test.run('rejects unknown meal', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal) values ('11111111-0000-0000-0000-000000000005', 'brunch', 'Egg', 50, 'raw', 70)$q$, 'meal');
select test.run('requires raw/cooked', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, kcal) values ('11111111-0000-0000-0000-000000000005', 'lunch', 'Egg', 50, 70)$q$, 'weight_state');
select test.run('rejects soluble fibre above total', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal, fibre_total_g, fibre_soluble_g) values ('11111111-0000-0000-0000-000000000005', 'lunch', 'Oats', 40, 'raw', 150, 4, 5)$q$, 'soluble_within_total');
select test.run('rejects unknown data source', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal, data_source) values ('11111111-0000-0000-0000-000000000005', 'lunch', 'Egg', 50, 'raw', 70, 'guess')$q$, 'data_source');
select test.run('rejects unknown cardio type', 'authenticated', :A,
  $q$insert into public.cardio_sessions (day_id, cardio_type, minutes, start_time) values ('11111111-0000-0000-0000-000000000005', 'yoga', 30, '07:00')$q$, 'cardio_type');

-- ---------- Intruder (another logged-in account) gets nothing ----------
select test.run('intruder sees no days', 'authenticated', :B,
  $q$select * from public.days$q$, null, 0);
select test.run('intruder sees no food', 'authenticated', :B,
  $q$select * from public.food_items$q$, null, 0);
select test.run('intruder cannot edit owner day', 'authenticated', :B,
  $q$update public.days set weight_kg = 50 where id = '11111111-0000-0000-0000-000000000005'$q$, null, 0);
select test.run('intruder cannot delete owner day', 'authenticated', :B,
  $q$delete from public.days where id = '11111111-0000-0000-0000-000000000005'$q$, null, 0);
select test.run('intruder cannot add food to owner day', 'authenticated', :B,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal) values ('11111111-0000-0000-0000-000000000005', 'lunch', 'X', 1, 'raw', 1)$q$, 'row-level security');
select test.run('owner cannot create rows as someone else', 'authenticated', :A,
  $q$insert into public.days (log_date, user_id) values ('2026-09-01', '00000000-0000-0000-0000-00000000000b')$q$, 'row-level security');

-- ---------- Logged-out visitor gets nothing ----------
select test.run('visitor cannot read days', 'anon', null, $q$select * from public.days$q$, 'permission denied');
select test.run('visitor cannot read food', 'anon', null, $q$select * from public.food_items$q$, 'permission denied');
select test.run('visitor cannot read notes', 'anon', null, $q$select * from public.day_notes$q$, 'permission denied');
select test.run('visitor cannot read share links', 'anon', null, $q$select * from public.share_links$q$, 'permission denied');
select test.run('visitor cannot write days', 'anon', null, $q$insert into public.days (log_date) values ('2026-09-01')$q$, 'permission denied');
select test.run('website cannot call private helpers', 'authenticated', :A, $q$select private.today_ist()$q$, 'permission denied');

-- ---------- Confirming ----------
select test.run('cannot insert an already-confirmed day', 'authenticated', :A,
  $q$insert into public.days (log_date, confirmed_at) values ('2026-09-02', now())$q$, 'must be saved');
select test.run('cannot confirm tomorrow (India time)', 'authenticated', :A,
  $q$update public.days set confirmed_at = now() where id = '11111111-0000-0000-0000-000000000003'$q$, 'future');
select test.run('can confirm today (India time)', 'authenticated', :A,
  $q$update public.days set confirmed_at = now() where id = '11111111-0000-0000-0000-000000000004'$q$, null, 1);
select test.run('can confirm a past day (with fake timestamp)', 'authenticated', :A,
  $q$update public.days set confirmed_at = '2000-01-01' where id = '11111111-0000-0000-0000-000000000001'$q$, null, 1);
select test.check('confirm time comes from server clock, not the request',
  (select confirmed_at > now() - interval '1 minute' from public.days where id = :d1),
  (select confirmed_at::text from public.days where id = :d1));

-- ---------- Locked day: nothing can change ----------
select test.run('locked: cannot change weight', 'authenticated', :A,
  $q$update public.days set weight_kg = 80.0 where id = '11111111-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('locked: cannot un-confirm', 'authenticated', :A,
  $q$update public.days set confirmed_at = null where id = '11111111-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('locked: cannot change date', 'authenticated', :A,
  $q$update public.days set log_date = '2026-09-15' where id = '11111111-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('locked: cannot delete day', 'authenticated', :A,
  $q$delete from public.days where id = '11111111-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('locked: cannot add food', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal) values ('11111111-0000-0000-0000-000000000001', 'snack', 'Biscuit', 20, 'cooked', 90)$q$, 'locked');
select test.run('locked: cannot edit food', 'authenticated', :A,
  $q$update public.food_items set kcal = 1 where id = '22222222-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('locked: cannot delete food', 'authenticated', :A,
  $q$delete from public.food_items where id = '22222222-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('locked: cannot move food out to another day', 'authenticated', :A,
  $q$update public.food_items set day_id = '11111111-0000-0000-0000-000000000005' where id = '22222222-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('locked: cannot move food in from another day', 'authenticated', :A,
  $q$update public.food_items set day_id = '11111111-0000-0000-0000-000000000001' where id = '22222222-0000-0000-0000-000000000005'$q$, 'locked');
select test.run('locked: cannot add fluids', 'authenticated', :A,
  $q$insert into public.fluids (day_id, drink_time, drink_type, ml) values ('11111111-0000-0000-0000-000000000001', '20:00', 'water', 250)$q$, 'locked');
select test.run('locked: cannot edit fluids', 'authenticated', :A,
  $q$update public.fluids set ml = 1 where day_id = '11111111-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('locked: cannot delete fluids', 'authenticated', :A,
  $q$delete from public.fluids where day_id = '11111111-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('locked: cannot add cardio', 'authenticated', :A,
  $q$insert into public.cardio_sessions (day_id, cardio_type, minutes, start_time) values ('11111111-0000-0000-0000-000000000001', 'run', 10, '18:00')$q$, 'locked');
select test.run('locked: cannot edit cardio', 'authenticated', :A,
  $q$update public.cardio_sessions set minutes = 99 where day_id = '11111111-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('locked: cannot delete cardio', 'authenticated', :A,
  $q$delete from public.cardio_sessions where day_id = '11111111-0000-0000-0000-000000000001'$q$, 'locked');

-- Even the Supabase dashboard (database owner) is stopped by the lock.
select test.run('dashboard: cannot change locked day', 'postgres', null,
  $q$update public.days set weight_kg = 70.0 where id = '11111111-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('dashboard: cannot delete locked food', 'postgres', null,
  $q$delete from public.food_items where id = '22222222-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('dashboard: cannot bulk-wipe days', 'postgres', null,
  $q$truncate public.days cascade$q$, 'Bulk deletion');

-- ---------- Notes ----------
select test.run('can add note to locked day', 'authenticated', :A,
  $q$insert into public.day_notes (day_id, body) values ('11111111-0000-0000-0000-000000000001', 'Weight taken after breakfast by mistake')$q$, null, 1);
select test.run('owner can read notes', 'authenticated', :A,
  $q$select * from public.day_notes$q$, null, 1);
select test.run('cannot edit a note', 'authenticated', :A,
  $q$update public.day_notes set body = 'changed'$q$, 'permission denied');
select test.run('cannot delete a note', 'authenticated', :A,
  $q$delete from public.day_notes$q$, 'permission denied');
select test.run('dashboard: cannot edit a note', 'postgres', null,
  $q$update public.day_notes set body = 'changed'$q$, 'permanent');
select test.run('dashboard: cannot delete a note', 'postgres', null,
  $q$delete from public.day_notes$q$, 'permanent');
select test.run('intruder sees no notes', 'authenticated', :B,
  $q$select * from public.day_notes$q$, null, 0);

-- ---------- Unlocked day can be deleted (with its entries) ----------
select test.run('owner deletes unlocked day', 'authenticated', :A,
  $q$delete from public.days where id = '11111111-0000-0000-0000-000000000005'$q$, null, 1);
select test.check('its food was removed too',
  not exists (select 1 from public.food_items where id = :f5));

-- ---------- Share links ----------
select test.run('owner creates share link', 'authenticated', :A,
  $q$insert into public.share_links (label) values ('Family')$q$, null, 1);
select test.check('share token is 64 random hex characters',
  (select token ~ '^[0-9a-f]{64}$' from public.share_links limit 1),
  (select token from public.share_links limit 1));
select test.run('intruder sees no share links', 'authenticated', :B,
  $q$select * from public.share_links$q$, null, 0);

-- ---------- Report ----------
\o
\echo
\echo ===== Results =====
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from test.results;
select n, name, detail from test.results where not ok order by n;
