-- LOCAL TESTING ONLY. Never run this in Supabase.
-- Run after supabase_stub.sql and the migration, on a throwaway database.
-- Every test records PASS/FAIL; the script ends by listing any failures.
--
-- Example (local PostgreSQL, empty database "t"):
--   psql -d t -f supabase/tests/supabase_stub.sql
--   psql -d t -f supabase/migrations/001_init.sql
--   psql -d t -f supabase/migrations/002_fibre_sum.sql
--   psql -d t -f supabase/migrations/003_other_descriptions.sql
--   psql -d t -f supabase/migrations/004_share_function.sql
--   psql -d t -f supabase/migrations/005_food_units.sql
--   psql -d t -f supabase/migrations/006_gym.sql
--   psql -d t -f supabase/migrations/007_points.sql
--   psql -d t -f supabase/migrations/008_points_start.sql
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
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal, fibre_total_g, fibre_soluble_g) values ('11111111-0000-0000-0000-000000000005', 'lunch', 'Oats', 40, 'raw', 150, 4, 5)$q$, 'within_total');
select test.run('rejects soluble + insoluble above total', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal, fibre_total_g, fibre_soluble_g, fibre_insoluble_g) values ('11111111-0000-0000-0000-000000000005', 'lunch', 'Oats', 40, 'raw', 150, 4, 2, 2.5)$q$, 'fibre_parts_within_total');
select test.run('accepts soluble + insoluble equal to total', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal, fibre_total_g, fibre_soluble_g, fibre_insoluble_g) values ('11111111-0000-0000-0000-000000000005', 'lunch', 'Oats', 40, 'raw', 150, 4, 1.5, 2.5)$q$, null, 1);
select test.run('accepts parts when total fibre is blank', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal, fibre_soluble_g, fibre_insoluble_g) values ('11111111-0000-0000-0000-000000000005', 'lunch', 'Oats', 40, 'raw', 150, 1, 2)$q$, null, 1);
select test.run('drink "other" may have a description', 'authenticated', :A,
  $q$insert into public.fluids (day_id, drink_time, drink_type, ml, kcal, description) values ('11111111-0000-0000-0000-000000000005', '10:00', 'other', 200, 45, 'coconut water')$q$, null, 1);
select test.run('rejects description on water', 'authenticated', :A,
  $q$insert into public.fluids (day_id, drink_time, drink_type, ml, description) values ('11111111-0000-0000-0000-000000000005', '10:00', 'water', 200, 'tap')$q$, 'fluids_description_only_for_other');
select test.run('rejects blank-space description', 'authenticated', :A,
  $q$insert into public.fluids (day_id, drink_time, drink_type, ml, description) values ('11111111-0000-0000-0000-000000000005', '10:00', 'other', 200, '   ')$q$, 'fluids_description_only_for_other');
select test.run('rejects 101-character description', 'authenticated', :A,
  $q$insert into public.cardio_sessions (day_id, cardio_type, minutes, start_time, description) values ('11111111-0000-0000-0000-000000000005', 'other', 30, '07:00', repeat('x', 101))$q$, 'cardio_description_only_for_other');
select test.run('cardio "other" may have a description', 'authenticated', :A,
  $q$insert into public.cardio_sessions (day_id, cardio_type, minutes, start_time, description) values ('11111111-0000-0000-0000-000000000005', 'other', 45, '18:00', 'badminton')$q$, null, 1);
select test.run('rejects description on run', 'authenticated', :A,
  $q$insert into public.cardio_sessions (day_id, cardio_type, minutes, start_time, description) values ('11111111-0000-0000-0000-000000000005', 'run', 20, '06:00', 'park')$q$, 'cardio_description_only_for_other');
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

-- ---------- Food units (005): the database calculates the grams ----------
-- Helper: insert one food on the unlocked day d5 and return its stored weight.
create function test.unit_weight(p_amount numeric, p_unit text, p_gpu numeric, p_sent_weight numeric default null)
returns numeric language plpgsql as $$
declare w numeric;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  set local role authenticated;
  insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal, amount, unit, grams_per_unit)
    values ('11111111-0000-0000-0000-000000000005', 'snack', 'Unit test', p_sent_weight, 'raw', 10, p_amount, p_unit, p_gpu)
    returning weight_g into w;
  reset role;
  return w;
end;
$$;
select test.check('units: 3 piece x 33.33 g = exactly 99.99 g (no rounding failure)', test.unit_weight(3, 'piece', 33.33) = 99.99, test.unit_weight(3, 'piece', 33.33)::text);
select test.check('units: 0.33 tsp x 3.33 g = exactly 1.0989 g', test.unit_weight(0.33, 'tsp', 3.33) = 1.0989, test.unit_weight(0.33, 'tsp', 3.33)::text);
select test.check('units: 500 mg = 0.5 g', test.unit_weight(500, 'mg', null) = 0.5);
select test.check('units: 5 mg = 0.005 g (tiny amounts are not rounded to 0)', test.unit_weight(5, 'mg', null) = 0.005);
select test.check('units: 150.5 g = 150.5 g', test.unit_weight(150.5, 'g', null) = 150.5);
select test.check('units: 250 ml x 1.03 g = 257.5 g', test.unit_weight(250, 'ml', 1.03) = 257.5);
select test.check('units: 2 tbsp x 12.5 g = 25 g', test.unit_weight(2, 'tbsp', 12.5) = 25);
select test.check('units: a wrong weight sent by the app is replaced', test.unit_weight(2, 'piece', 50, 999) = 100);
select test.run('units: piece without grams per unit is refused (even with a weight sent)', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal, amount, unit) values ('11111111-0000-0000-0000-000000000005', 'snack', 'Egg', 50, 'raw', 70, 1, 'piece')$q$, 'food_grams_per_unit_rule');
select test.run('units: g with grams per unit is refused', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_state, kcal, amount, unit, grams_per_unit) values ('11111111-0000-0000-0000-000000000005', 'snack', 'Oats', 'raw', 70, 40, 'g', 1)$q$, 'food_grams_per_unit_rule');
select test.run('units: mg with grams per unit is refused', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_state, kcal, amount, unit, grams_per_unit) values ('11111111-0000-0000-0000-000000000005', 'snack', 'Salt', 'raw', 0, 400, 'mg', 1)$q$, 'food_grams_per_unit_rule');
select test.run('units: unit without amount is refused', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal, unit) values ('11111111-0000-0000-0000-000000000005', 'snack', 'Oats', 40, 'raw', 70, 'g')$q$, 'food_amount_and_unit_together');
select test.run('units: amount without unit is refused', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal, amount) values ('11111111-0000-0000-0000-000000000005', 'snack', 'Oats', 40, 'raw', 70, 40)$q$, 'food_amount_and_unit_together');
select test.run('units: unknown unit is refused', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal, amount, unit) values ('11111111-0000-0000-0000-000000000005', 'snack', 'Milk', 240, 'raw', 70, 1, 'cup')$q$, 'food_items_unit_check');
select test.run('units: amount with 3 decimals is refused', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_state, kcal, amount, unit) values ('11111111-0000-0000-0000-000000000005', 'snack', 'Oats', 'raw', 70, 40.125, 'g')$q$, 'food_items_amount_check');
select test.run('units: grams per unit with 3 decimals is refused', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_state, kcal, amount, unit, grams_per_unit) values ('11111111-0000-0000-0000-000000000005', 'snack', 'Egg', 'raw', 70, 1, 'piece', 50.125)$q$, 'food_items_grams_per_unit_check');
select test.run('units: zero amount is refused', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_state, kcal, amount, unit) values ('11111111-0000-0000-0000-000000000005', 'snack', 'Oats', 'raw', 70, 0, 'g')$q$, 'food_items_amount_check');
select test.run('units: result above 5,000 g is refused (200 x 30 g)', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_state, kcal, amount, unit, grams_per_unit) values ('11111111-0000-0000-0000-000000000005', 'snack', 'Egg', 'raw', 70, 200, 'piece', 30)$q$, 'food_items_weight_g_check');
select test.run('units: old-style entry (grams only, no unit) still works', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_g, weight_state, kcal) values ('11111111-0000-0000-0000-000000000005', 'snack', 'Old app', 42, 'raw', 70)$q$, null, 1);
select test.check('units: old-style entry keeps its grams, unit blank',
  (select weight_g = 42 and amount is null and unit is null from public.food_items where food = 'Old app'));
select test.run('units: editing the amount recalculates the grams', 'authenticated', :A,
  $q$update public.food_items set amount = 4 where food = 'Unit test' and unit = 'tbsp'$q$, null, 1);
select test.check('units: 4 tbsp x 12.5 g = 50 g after edit',
  (select weight_g = 50 from public.food_items where food = 'Unit test' and unit = 'tbsp'));
-- A unit entry on today (d4), which gets confirmed below: the lock must cover it.
select test.run('units: owner adds 2 eggs on today', 'authenticated', :A,
  $q$insert into public.food_items (id, day_id, meal, food, weight_state, kcal, amount, unit, grams_per_unit)
     values ('22222222-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000004', 'breakfast', 'Egg', 'raw', 140, 2, 'piece', 50)$q$, null, 1);
select test.run('units: intruder cannot read the owner''s unit entries', 'authenticated', :B,
  $q$select * from public.food_items where unit is not null$q$, null, 0);

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
select test.run('locked: cannot change a drink description', 'authenticated', :A,
  $q$update public.fluids set description = 'changed' where day_id = '11111111-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('locked: cannot delete cardio', 'authenticated', :A,
  $q$delete from public.cardio_sessions where day_id = '11111111-0000-0000-0000-000000000001'$q$, 'locked');

select test.run('locked: cannot change a food amount', 'authenticated', :A,
  $q$update public.food_items set amount = 3 where id = '22222222-0000-0000-0000-000000000007'$q$, 'locked');
select test.run('locked: cannot change grams per unit', 'authenticated', :A,
  $q$update public.food_items set grams_per_unit = 60 where id = '22222222-0000-0000-0000-000000000007'$q$, 'locked');
select test.run('locked: cannot add a unit to an old entry', 'authenticated', :A,
  $q$update public.food_items set amount = 60, unit = 'g' where id = '22222222-0000-0000-0000-000000000001'$q$, 'locked');
select test.run('locked: cannot add food with units', 'authenticated', :A,
  $q$insert into public.food_items (day_id, meal, food, weight_state, kcal, amount, unit, grams_per_unit) values ('11111111-0000-0000-0000-000000000004', 'snack', 'Egg', 'raw', 70, 1, 'piece', 50)$q$, 'locked');
select test.run('dashboard: cannot change a locked food amount', 'postgres', null,
  $q$update public.food_items set amount = 3 where id = '22222222-0000-0000-0000-000000000007'$q$, 'locked');
select test.check('locked unit entry unchanged: 2 piece x 50 g = 100 g',
  (select amount = 2 and unit = 'piece' and grams_per_unit = 50 and weight_g = 100 from public.food_items where id = '22222222-0000-0000-0000-000000000007'));

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

-- ---------- Gym log ----------
-- d6 = an unlocked past day for gym tests (confirmed later in this section).
\set d6 '''11111111-0000-0000-0000-000000000006'''
select test.run('owner creates a gym day', 'authenticated', :A,
  $q$insert into public.days (id, log_date) values ('11111111-0000-0000-0000-000000000006', '2026-09-20')$q$, null, 1);
select test.run('owner saves an exercise', 'authenticated', :A,
  $q$insert into public.exercises (name) values ('Bench press')$q$, null, 1);
select test.run('duplicate exercise name rejected (case and spaces ignored)', 'authenticated', :A,
  $q$insert into public.exercises (name) values ('  bench   PRESS ')$q$, 'exercises_unique_name');
select test.run('exercise name over 60 characters rejected', 'authenticated', :A,
  $q$insert into public.exercises (name) values (repeat('x', 61))$q$, 'exercises_name_check');
select test.run('owner saves a bodyweight exercise', 'authenticated', :A,
  $q$insert into public.exercises (name) values ('Pull-up')$q$, null, 1);
select test.run('intruder may have the same name in their own list', 'authenticated', :B,
  $q$insert into public.exercises (name) values ('Bench press')$q$, null, 1);
select test.run('intruder sees only their own exercise', 'authenticated', :B,
  $q$select * from public.exercises$q$, null, 1);
select test.run('owner adds an exercise that is never used', 'authenticated', :A,
  $q$insert into public.exercises (name) values ('Typo exercise')$q$, null, 1);
select test.run('unused exercise can be deleted', 'authenticated', :A,
  $q$delete from public.exercises where name = 'Typo exercise'$q$, null, 1);

select id as bench from public.exercises where name = 'Bench press' and user_id = '00000000-0000-0000-0000-00000000000a' \gset
select id as pullup from public.exercises where name = 'Pull-up' \gset
select id as b_bench from public.exercises where user_id = '00000000-0000-0000-0000-00000000000b' \gset

select test.run('owner saves a whole session', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '18:30', array['chest','arms'],
    jsonb_build_array(
      jsonb_build_object('exercise_id', %L, 'note', 'felt strong', 'sets', jsonb_build_array(
        jsonb_build_object('reps', 10, 'weight_kg', 40), jsonb_build_object('reps', 8, 'weight_kg', 42.5), jsonb_build_object('reps', 6, 'weight_kg', 45))),
      jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 8, 'weight_kg', 0))))
  )$q$, :d6, :'bench', :'pullup'), null, 1);
select test.check('session stored: 2 exercises, 4 sets, note kept',
  (select count(*) from public.gym_exercises g join public.gym_sessions s on s.id = g.session_id where s.day_id = :d6) = 2
  and (select count(*) from public.gym_sets x join public.gym_exercises g on g.id = x.entry_id join public.gym_sessions s on s.id = g.session_id where s.day_id = :d6) = 4
  and exists (select 1 from public.gym_exercises where note = 'felt strong'));
select test.run('second session on the same day rejected by the database', 'authenticated', :A,
  format($q$insert into public.gym_sessions (day_id, start_time, muscle_groups) values (%L, '07:00', array['legs'])$q$, :d6), 'gym_one_session_per_day');
select test.run('saving again edits the same session (still one per day)', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '19:00', array['chest'],
    jsonb_build_array(jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(
      jsonb_build_object('reps', 5, 'weight_kg', 50), jsonb_build_object('reps', 5, 'weight_kg', 50), jsonb_build_object('reps', 5, 'weight_kg', 50)))))$q$, :d6, :'bench'), null, 1);
select test.check('one session, 1 exercise, 3 sets after editing',
  (select count(*) from public.gym_sessions where day_id = :d6) = 1
  and (select count(*) from public.gym_sets x join public.gym_exercises g on g.id = x.entry_id join public.gym_sessions s on s.id = g.session_id where s.day_id = :d6) = 3
  and (select start_time from public.gym_sessions where day_id = :d6) = '19:00');
select test.run('save with no exercises refused', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '19:00', array['chest'], '[]'::jsonb)$q$, :d6), 'at least one exercise');
select test.run('save with an exercise but no sets refused', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '19:00', array['chest'], jsonb_build_array(jsonb_build_object('exercise_id', %L, 'sets', '[]'::jsonb)))$q$, :d6, :'bench'), 'at least one set');
select test.check('a refused save changes nothing (all or nothing)',
  (select count(*) from public.gym_sets x join public.gym_exercises g on g.id = x.entry_id join public.gym_sessions s on s.id = g.session_id where s.day_id = :d6) = 3);
select test.run('reps 0 rejected', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '19:00', array['chest'], jsonb_build_array(jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 0, 'weight_kg', 40)))))$q$, :d6, :'bench'), 'gym_sets_reps_check');
select test.run('reps 101 rejected', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '19:00', array['chest'], jsonb_build_array(jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 101, 'weight_kg', 40)))))$q$, :d6, :'bench'), 'gym_sets_reps_check');
select test.run('weight 500.01 kg rejected', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '19:00', array['chest'], jsonb_build_array(jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'weight_kg', 500.01)))))$q$, :d6, :'bench'), 'gym_sets_weight_kg_check');
select test.run('weight with 3 decimals rejected', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '19:00', array['chest'], jsonb_build_array(jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'weight_kg', 40.125)))))$q$, :d6, :'bench'), 'gym_sets_weight_kg_check');
select test.run('unknown muscle group rejected', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '19:00', array['neck'], jsonb_build_array(jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'weight_kg', 40)))))$q$, :d6, :'bench'), 'muscle_groups');
select test.run('no muscle group rejected', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '19:00', array[]::text[], jsonb_build_array(jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'weight_kg', 40)))))$q$, :d6, :'bench'), 'muscle_groups');
select test.run('the same exercise twice in one session rejected', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '19:00', array['chest'], jsonb_build_array(
    jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'weight_kg', 40))),
    jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'weight_kg', 40)))))$q$, :d6, :'bench', :'bench'), 'gym_exercise_once_per_session');
select test.run('owner cannot use someone else''s exercise', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '19:00', array['chest'], jsonb_build_array(jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'weight_kg', 40)))))$q$, :d6, :'b_bench'), 'row-level security');
select test.run('intruder cannot save into owner''s day', 'authenticated', :B,
  format($q$select public.save_gym_session(%L, '19:00', array['chest'], jsonb_build_array(jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'weight_kg', 40)))))$q$, :d6, :'b_bench'), 'row-level security');
select test.run('intruder sees no gym sessions', 'authenticated', :B, $q$select * from public.gym_sessions$q$, null, 0);
select test.run('intruder sees no gym sets', 'authenticated', :B, $q$select * from public.gym_sets$q$, null, 0);
select test.run('visitor cannot read exercises', 'anon', null, $q$select * from public.exercises$q$, 'permission denied');
select test.run('visitor cannot read gym sets', 'anon', null, $q$select * from public.gym_sets$q$, 'permission denied');
select test.run('visitor cannot call save_gym_session', 'anon', null,
  format($q$select public.save_gym_session(%L, '19:00', array['chest'], '[]'::jsonb)$q$, :d6), 'permission denied');

-- ---------- Exercise names BEFORE the gym day is confirmed: rename allowed ----------
-- Bench press is used on d6, which is not confirmed yet.
select test.run('rename allowed while used only on unconfirmed days', 'authenticated', :A,
  format($q$update public.exercises set name = 'Barbell bench press' where id = %L$q$, :'bench'), null, 1);
select test.check('rename kept the session: same 3 sets, same reps and kg',
  (select string_agg(x.reps || 'x' || x.weight_kg, ',' order by x.set_number) from public.gym_sets x join public.gym_exercises g on g.id = x.entry_id where g.exercise_id = :'bench')
  = (select string_agg(x.reps || 'x' || x.weight_kg, ',' order by x.set_number) from public.gym_sets x join public.gym_exercises g on g.id = x.entry_id join public.exercises e on e.id = g.exercise_id where e.name = 'Barbell bench press'),
  (select string_agg(x.reps || 'x' || x.weight_kg, ',') from public.gym_sets x join public.gym_exercises g on g.id = x.entry_id where g.exercise_id = :'bench'));
select test.check('rename history: Bench press -> Barbell bench press, server time',
  (select count(*) = 1 and bool_and(old_name = 'Bench press' and new_name = 'Barbell bench press' and renamed_at > now() - interval '1 minute')
   from public.exercise_renames where exercise_id = :'bench'));
select test.run('rename to an existing name is refused (case and spaces ignored)', 'authenticated', :A,
  format($q$update public.exercises set name = '  PULL-UP ' where id = %L$q$, :'bench'), 'exercises_unique_name');
select test.check('refused rename left no history row',
  (select count(*) from public.exercise_renames where exercise_id = :'bench') = 1);
select test.run('rename that only changes capitals is allowed', 'authenticated', :A,
  format($q$update public.exercises set name = 'Barbell Bench Press' where id = %L$q$, :'bench'), null, 1);
select test.run('saving the same name again is allowed', 'authenticated', :A,
  format($q$update public.exercises set name = 'Barbell Bench Press' where id = %L$q$, :'bench'), null, 1);
select test.check('history: 2 renames, the no-change save not recorded',
  (select count(*) from public.exercise_renames where exercise_id = :'bench') = 2);
select test.run('rename to blank is refused', 'authenticated', :A,
  format($q$update public.exercises set name = '   ' where id = %L$q$, :'bench'), 'exercises_name_check');
select test.run('rename over 60 characters is refused', 'authenticated', :A,
  format($q$update public.exercises set name = repeat('x', 61) where id = %L$q$, :'bench'), 'exercises_name_check');
select test.run('only the name can be changed (not the owner)', 'authenticated', :A,
  format($q$update public.exercises set user_id = '00000000-0000-0000-0000-00000000000b' where id = %L$q$, :'bench'), 'permission denied');
select test.run('only the name can be changed (not the id)', 'authenticated', :A,
  format($q$update public.exercises set id = gen_random_uuid() where id = %L$q$, :'bench'), 'permission denied');
select test.run('used exercise (unconfirmed day) cannot be deleted', 'authenticated', :A,
  format($q$delete from public.exercises where id = %L$q$, :'bench'), 'Used in 1 session — rename instead');
select test.run('dashboard cannot delete a used exercise either', 'postgres', null,
  format($q$delete from public.exercises where id = %L$q$, :'bench'), 'Used in 1 session');
select test.run('owner cannot write fake rename history', 'authenticated', :A,
  format($q$insert into public.exercise_renames (exercise_id, user_id, old_name, new_name) values (%L, '00000000-0000-0000-0000-00000000000a', 'x', 'y')$q$, :'bench'), 'permission denied');
select test.run('owner cannot edit rename history', 'authenticated', :A,
  $q$update public.exercise_renames set old_name = 'x'$q$, 'permission denied');
select test.run('owner cannot delete rename history', 'authenticated', :A,
  $q$delete from public.exercise_renames$q$, 'permission denied');
select test.run('dashboard cannot edit rename history', 'postgres', null,
  $q$update public.exercise_renames set old_name = 'x'$q$, 'permanent');
select test.run('dashboard cannot delete rename history', 'postgres', null,
  $q$delete from public.exercise_renames$q$, 'permanent');
select test.run('intruder cannot rename the owner''s exercise', 'authenticated', :B,
  format($q$update public.exercises set name = 'Hacked' where id = %L$q$, :'bench'), null, 0);
select test.run('intruder cannot delete the owner''s exercise', 'authenticated', :B,
  format($q$delete from public.exercises where id = %L$q$, :'pullup'), null, 0);
select test.run('intruder sees no rename history', 'authenticated', :B, $q$select * from public.exercise_renames$q$, null, 0);
select test.run('intruder can rename their own exercise to the owner''s name (names are per person)', 'authenticated', :B,
  format($q$update public.exercises set name = 'Barbell Bench Press' where id = %L$q$, :'b_bench'), null, 1);
select test.run('visitor cannot read rename history', 'anon', null, $q$select * from public.exercise_renames$q$, 'permission denied');
select test.run('visitor cannot rename exercises', 'anon', null, $q$update public.exercises set name = 'x'$q$, 'permission denied');
select test.run('visitor cannot delete exercises', 'anon', null, $q$delete from public.exercises$q$, 'permission denied');
select test.run('owner adds and renames an unused exercise', 'authenticated', :A,
  $q$insert into public.exercises (name) values ('Curl'); update public.exercises set name = 'Biceps curl' where name = 'Curl'$q$, null, 1);
select test.run('unused exercise with rename history can still be deleted', 'authenticated', :A,
  $q$delete from public.exercises where name = 'Biceps curl'$q$, null, 1);
select test.check('its history went with it',
  not exists (select 1 from public.exercise_renames where new_name = 'Biceps curl'));

-- Lock: confirm the gym day, then every change must be refused.
select test.run('owner confirms the gym day', 'authenticated', :A,
  $q$update public.days set confirmed_at = now() where id = '11111111-0000-0000-0000-000000000006'$q$, null, 1);
select test.run('locked: cannot save the session again', 'authenticated', :A,
  format($q$select public.save_gym_session(%L, '20:00', array['legs'], jsonb_build_array(jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'weight_kg', 40)))))$q$, :d6, :'bench'), 'locked');
select test.run('locked: cannot change a set', 'authenticated', :A,
  $q$update public.gym_sets set weight_kg = 100$q$, 'locked');
select test.run('locked: cannot delete a set', 'authenticated', :A,
  $q$delete from public.gym_sets$q$, 'locked');
select test.run('locked: cannot add a set', 'authenticated', :A,
  $q$insert into public.gym_sets (entry_id, set_number, reps, weight_kg) select id, 9, 5, 40 from public.gym_exercises limit 1$q$, 'locked');
select test.run('locked: cannot change an exercise note', 'authenticated', :A,
  $q$update public.gym_exercises set note = 'changed'$q$, 'locked');
select test.run('locked: cannot delete the session', 'authenticated', :A,
  format($q$delete from public.gym_sessions where day_id = %L$q$, :d6), 'locked');
select test.run('dashboard: cannot change a locked set', 'postgres', null,
  $q$update public.gym_sets set reps = 1$q$, 'locked');

-- ---------- Exercise names AFTER the gym day is confirmed: locked ----------
select test.run('locked name: rename refused once used on a confirmed day', 'authenticated', :A,
  format($q$update public.exercises set name = 'Flat bench' where id = %L$q$, :'bench'), 'Used on a confirmed day — locked');
select test.run('locked name: changing only capitals is refused too', 'authenticated', :A,
  format($q$update public.exercises set name = 'barbell bench press' where id = %L$q$, :'bench'), 'Used on a confirmed day — locked');
select test.run('locked name: delete refused with the locked message', 'authenticated', :A,
  format($q$delete from public.exercises where id = %L$q$, :'bench'), 'Used on a confirmed day — locked');
select test.run('locked name: dashboard cannot rename it', 'postgres', null,
  format($q$update public.exercises set name = 'Flat bench' where id = %L$q$, :'bench'), 'Used on a confirmed day — locked');
select test.run('locked name: dashboard cannot delete it', 'postgres', null,
  format($q$delete from public.exercises where id = %L$q$, :'bench'), 'Used on a confirmed day — locked');
select test.run('locked name: saving the identical name is not a change (allowed)', 'authenticated', :A,
  format($q$update public.exercises set name = 'Barbell Bench Press' where id = %L$q$, :'bench'), null, 1);
select test.check('locked name unchanged and its earlier history kept (2 renames)',
  (select name = 'Barbell Bench Press' from public.exercises where id = :'bench')
  and (select count(*) from public.exercise_renames where exercise_id = :'bench') = 2);
select test.check('locked gym day untouched: still 3 sets, still confirmed',
  (select count(*) from public.gym_sets x join public.gym_exercises g on g.id = x.entry_id join public.gym_sessions s on s.id = g.session_id where s.day_id = :d6) = 3
  and (select confirmed_at is not null from public.days where id = :d6));
-- Another exercise used only on an unconfirmed day stays renamable.
select test.run('owner creates a second gym day (not confirmed)', 'authenticated', :A,
  $q$insert into public.days (id, log_date) values ('11111111-0000-0000-0000-000000000007', '2026-09-21')$q$, null, 1);
select test.run('owner logs pull-ups on it', 'authenticated', :A,
  format($q$select public.save_gym_session('11111111-0000-0000-0000-000000000007', '07:00', array['back'],
    jsonb_build_array(jsonb_build_object('exercise_id', %L, 'sets', jsonb_build_array(jsonb_build_object('reps', 8, 'weight_kg', 0)))))$q$, :'pullup'), null, 1);
select test.run('exercise used only on an unconfirmed day: rename allowed', 'authenticated', :A,
  format($q$update public.exercises set name = 'Pull-up (wide grip)' where id = %L$q$, :'pullup'), null, 1);
select test.run('exercise used only on an unconfirmed day: delete refused (used)', 'authenticated', :A,
  format($q$delete from public.exercises where id = %L$q$, :'pullup'), 'Used in 1 session — rename instead');
select test.run('confirming that day locks its exercise names', 'authenticated', :A,
  $q$update public.days set confirmed_at = now() where id = '11111111-0000-0000-0000-000000000007'$q$, null, 1);
select test.run('…and the rename is now refused', 'authenticated', :A,
  format($q$update public.exercises set name = 'Pull-up' where id = %L$q$, :'pullup'), 'Used on a confirmed day — locked');


-- =====================================================================
-- ---------- Points & rank (007) ----------
-- Three more people, each with hand-worked expected answers. Data is written as the database owner
-- (row rules bypassed, lock triggers still on). T = today (India time).
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000c'),
  ('00000000-0000-0000-0000-00000000000d'),
  ('00000000-0000-0000-0000-00000000000e');
\set C '''00000000-0000-0000-0000-00000000000c'''
\set D '''00000000-0000-0000-0000-00000000000d'''
\set E '''00000000-0000-0000-0000-00000000000e'''
select (now() at time zone 'Asia/Kolkata')::date as t \gset
\set T '''' :t ''''

-- C: a realistic 10 days. Confirmed now, so T-9 is late (-20) and T-8 (nothing logged) is missed (-20).
insert into public.days (user_id, log_date, junk_meals, porn, gaming_hours, weight_kg)
select :C, :T::date - k, 0, false,
       case when k = 7 then 1.5 else 0 end,
       case k when 9 then 103 when 7 then 101.5 when 5 then 99.9 when 1 then 99.2 when 0 then 99.0 end
from generate_series(0, 9) k where k <> 8;
-- Weekly target for this week, set today as C: only weigh-ins from today on count.
select test.run('weekly target: owner sets this week''s target', 'authenticated', :C,
  format($q$insert into public.weight_targets (week_start, target_kg) values (%L, 99.5)$q$, date_trunc('week', :T::date)::date), null, 1);
update public.days set confirmed_at = now() where user_id = :C;
select private.points_report(:C, now(), :T::date - 9) as c_report \gset
\set CR '''' :c_report ''''
select test.check('C: total 360 = 5 - 20 + 70 + 25 + 125 + 25 + 25 + 25 + 45 + 35',
  (:CR::jsonb->>'total')::int = 360, :CR::jsonb->>'total');
select test.check('C: rank Shoorveer (350 or more)', :CR::jsonb->>'rank' = 'Shoorveer', :CR::jsonb->>'rank');
select test.check('C: late confirm takes -20 but the day still earns (T-9: -20 +20 +5 = 5)',
  (select (e->>'points')::int = 5 and e->'items' @> '[{"code":"missed_confirm"},{"code":"clean_day"},{"code":"no_games"}]'
   from jsonb_array_elements(:CR::jsonb->'days') e where e->>'date' = (:T::date - 9)::text));
select test.check('C: a day with nothing logged is missed (-20)',
  (select (e->>'points')::int = -20 and jsonb_array_length(e->'items') = 1
   from jsonb_array_elements(:CR::jsonb->'days') e where e->>'date' = (:T::date - 8)::text));
select test.check('C: gaming 1.5 h is clean but earns no "no games" +5; milestone 102 kg (+50)',
  (select (e->>'points')::int = 70 and not e->'items' @> '[{"code":"no_games"}]' and e->'items' @> '[{"code":"milestone"}]'
   from jsonb_array_elements(:CR::jsonb->'days') e where e->>'date' = (:T::date - 7)::text));
select test.check('C: 99.9 kg earns both the 100 and 99.9 milestones, once each',
  (select count(*) from jsonb_array_elements(:CR::jsonb->'days') e, jsonb_array_elements(e->'items') i where i->>'code' = 'milestone') = 3);
select test.check('C: 7-day clean streak bonus on the 7th day after the gap (T-1), not before',
  (select string_agg(e->>'date', ',') from jsonb_array_elements(:CR::jsonb->'days') e where e->'items' @> '[{"code":"streak"}]')
  = (:T::date - 1)::text);
select test.check('C: weekly target hit only by today''s weigh-in (yesterday was before the target was set)',
  (select string_agg(e->>'date', ',') from jsonb_array_elements(:CR::jsonb->'days') e where e->'items' @> '[{"code":"weekly_target"}]')
  = :T);
select test.check('C: report says this week''s target was hit', (:CR::jsonb->'this_week'->>'hit')::boolean);
select test.check('C: next rank Samanth needs 340 more points',
  :CR::jsonb->'next_rank'->>'name' = 'Samanth' and (:CR::jsonb->'next_rank'->>'points_needed')::int = 340);
select test.run('weekly target: locked once hit (change refused)', 'authenticated', :C,
  $q$update public.weight_targets set target_kg = 98$q$, 'already hit — locked');
select test.run('weekly target: locked once hit (delete refused)', 'authenticated', :C,
  $q$delete from public.weight_targets$q$, 'already hit — locked');
select test.run('weekly target: dashboard cannot change a hit target either', 'postgres', null,
  format($q$update public.weight_targets set target_kg = 98 where user_id = %L$q$, :C), 'already hit — locked');
select test.run('weekly target: a past week is refused', 'authenticated', :C,
  format($q$insert into public.weight_targets (week_start, target_kg) values (%L, 99)$q$, date_trunc('week', :T::date)::date - 7), 'this week or a later week');
select test.run('weekly target: next week can be set', 'authenticated', :C,
  format($q$insert into public.weight_targets (week_start, target_kg) values (%L, 99)$q$, date_trunc('week', :T::date)::date + 7), null, 1);
select test.run('weekly target: next week can be changed (not hit)', 'authenticated', :C,
  format($q$update public.weight_targets set target_kg = 98.5 where week_start = %L$q$, date_trunc('week', :T::date)::date + 7), null, 1);
select test.run('weekly target: the week must start on a Monday', 'authenticated', :C,
  format($q$insert into public.weight_targets (week_start, target_kg) values (%L, 99)$q$, date_trunc('week', :T::date)::date + 15), 'weight_targets_week_start_check');
select test.run('weekly target: 2 decimals refused', 'authenticated', :C,
  format($q$insert into public.weight_targets (week_start, target_kg) values (%L, 99.25)$q$, date_trunc('week', :T::date)::date + 21), 'weight_targets_target_kg_check');
select test.run('weekly target: one per week', 'authenticated', :C,
  format($q$insert into public.weight_targets (week_start, target_kg) values (%L, 97)$q$, date_trunc('week', :T::date)::date + 7), 'weight_target_once_per_week');
select test.run('weekly target: set_on comes from the server, not the app', 'authenticated', :C,
  format($q$update public.weight_targets set set_on = '2000-01-01' where week_start = %L$q$, date_trunc('week', :T::date)::date + 7), 'permission denied');
select test.check('weekly target: set_on is today',
  (select bool_and(set_on = :T::date) from public.weight_targets where user_id = :C));
select test.run('weekly target: intruder sees none of C''s targets', 'authenticated', :B, $q$select * from public.weight_targets$q$, null, 0);
select test.run('weekly target: visitor cannot read targets', 'anon', null, $q$select * from public.weight_targets$q$, 'permission denied');

-- D: penalties, blanks, gym rules, an unconfirmed today.
insert into public.days (user_id, log_date, junk_meals, porn, gaming_hours) values
  (:D, :T::date - 3, 2, true, 3),
  (:D, :T::date - 2, 0, false, null),
  (:D, :T::date - 1, 0, false, null),
  (:D, :T::date, 0, false, 0);
insert into public.exercises (user_id, name) values (:D, 'Squat');
insert into public.gym_sessions (user_id, day_id, start_time, muscle_groups)
  select :D, id, '07:00', array['legs'] from public.days where user_id = :D and log_date in (:T::date - 2, :T::date - 1);
insert into public.gym_exercises (user_id, session_id, exercise_id, position)
  select :D, s.id, e.id, 1 from public.gym_sessions s, public.exercises e where s.user_id = :D and e.user_id = :D;
insert into public.gym_sets (user_id, entry_id, set_number, reps, weight_kg)
  select :D, g.id, n, 8, 40 from public.gym_exercises g join public.gym_sessions s on s.id = g.session_id join public.days d on d.id = s.day_id,
    generate_series(1, 2) n
  where g.user_id = :D and (d.log_date = :T::date - 1 or n = 1);
update public.days set confirmed_at = now() where user_id = :D and log_date < :T::date;
select private.points_report(:D, now(), :T::date - 3) as d_report \gset
\set DR '''' :d_report ''''
select test.check('D: junk 2 meals, porn Yes, gaming 3 h = -50 -15 -10 = -75, not clean',
  (select (e->>'points')::int = -75 and e->'items' @> '[{"code":"junk_day"},{"code":"porn"},{"code":"gaming_over"},{"code":"not_clean"}]'
   from jsonb_array_elements(:DR::jsonb->'days') e where e->>'date' = (:T::date - 3)::text));
select test.check('D: the "not clean" line explains every reason',
  (select i->>'label' = 'Not clean: 2 junk meals, porn Yes, gaming 3 h'
   from jsonb_array_elements(:DR::jsonb->'days') e, jsonb_array_elements(e->'items') i
   where e->>'date' = (:T::date - 3)::text and i->>'code' = 'not_clean'));
select test.check('D: blank gaming = not clean and no "no games" (0 points); gym with only 1 set = no points',
  (select (e->>'points')::int = 0 and e->'items' @> '[{"code":"gym_too_short"}]'
     and (select i->>'label' from jsonb_array_elements(e->'items') i where i->>'code' = 'not_clean') = 'Not clean: gaming not answered'
   from jsonb_array_elements(:DR::jsonb->'days') e where e->>'date' = (:T::date - 2)::text));
select test.check('D: gym with an exercise of 2 sets = +10',
  (select (e->>'points')::int = 10 and e->'items' @> '[{"code":"gym"}]'
   from jsonb_array_elements(:DR::jsonb->'days') e where e->>'date' = (:T::date - 1)::text));
select test.check('D: today not confirmed = no points yet (pending)',
  (select (e->>'points')::int = 0 and e->'items' @> '[{"code":"pending"}]'
   from jsonb_array_elements(:DR::jsonb->'days') e where e->>'date' = :T));
select test.check('D: total can go below 0 (-65), rank Sainik',
  (:DR::jsonb->>'total')::int = -65 and :DR::jsonb->>'rank' = 'Sainik', :DR::jsonb->>'total');
select test.check('D: days before the start date are ignored',
  (select count(*) from jsonb_array_elements(:DR::jsonb->'days')) = 4);

-- E: 520 clean, on-time days to walk through every rank and weight gate.
-- Day k (1..520) = T-521+k. Total on day k = 300 (all 6 milestones on day 1) + 25k + 20*floor(k/7).
-- Confirm times are set directly (test database only) so no day is late.
alter table public.days disable trigger guard_days;
insert into public.days (user_id, log_date, junk_meals, porn, gaming_hours, weight_kg, confirmed_at)
select :E, :T::date - 521 + k, 0, false, 0,
  case when k <= 150 then 93 when k <= 160 then 94.6 when k <= 170 then 96 when k <= 240 then 93
       when k <= 330 then 84 when k <= 340 then 85.8 when k <= 350 then 87 else 84 end,
  ((:T::date - 520 + k)::timestamp at time zone 'Asia/Kolkata')
from generate_series(1, 520) k;
alter table public.days enable trigger guard_days;
select private.points_report(:E, now(), :T::date - 520) as e_report \gset
\set ER '''' :e_report ''''
create function test.e_rank(k int, report jsonb) returns text language sql as $$
  select e->>'rank' from jsonb_array_elements(report->'days') e
  where e->>'date' = ((now() at time zone 'Asia/Kolkata')::date - 521 + k)::text $$;
create function test.e_total(k int, report jsonb) returns int language sql as $$
  select (e->>'total')::int from jsonb_array_elements(report->'days') e
  where e->>'date' = ((now() at time zone 'Asia/Kolkata')::date - 521 + k)::text $$;
select test.check('E: totals follow 300 + 25k + 20*floor(k/7) (day 1: 325, day 7: 495, day 520: 14780)',
  test.e_total(1, :ER) = 325 and test.e_total(7, :ER) = 495 and test.e_total(520, :ER) = 300 + 25 * 520 + 20 * 74,
  test.e_total(520, :ER)::text);
select test.check('E: Sainik -> Shoorveer at 350 (day 2), Samanth at 700, Raja at 1,500',
  test.e_rank(1, :ER) = 'Sainik' and test.e_rank(2, :ER) = 'Shoorveer'
  and test.e_rank(14, :ER) = 'Shoorveer' and test.e_rank(15, :ER) = 'Samanth' and test.e_rank(43, :ER) = 'Samanth' and test.e_rank(44, :ER) = 'Raja');
select test.check('E: Maharaj on the first day with 3,500 points (day 116; gate held since day 1)',
  test.e_rank(115, :ER) = 'Raja' and test.e_rank(116, :ER) = 'Maharaj', test.e_total(116, :ER)::text);
select test.check('E: average between 94 and 95 keeps Maharaj (day 162: exactly 95.0)',
  test.e_rank(160, :ER) = 'Maharaj' and test.e_rank(162, :ER) = 'Maharaj');
select test.check('E: average above 95 loses Maharaj -> Raja (day 163: 95.2)',
  test.e_rank(163, :ER) = 'Raja');
select test.check('E: back under 94 must be held 28 days again (from day 175): Raja on day 201, Maharaj on day 202',
  test.e_rank(201, :ER) = 'Raja' and test.e_rank(202, :ER) = 'Maharaj');
select test.check('E: Chakravarti Samrat on the first day with 7,500 points and average <= 85 (day 259)',
  test.e_rank(258, :ER) = 'Maharaj' and test.e_rank(259, :ER) = 'Chakravarti Samrat', test.e_total(259, :ER)::text);
select test.check('E: average up to 86 keeps Chakravarti Samrat (day 341: 85.97)',
  test.e_rank(340, :ER) = 'Chakravarti Samrat' and test.e_rank(341, :ER) = 'Chakravarti Samrat');
select test.check('E: average above 86 loses it -> Maharaj (still held 28 days at <= 94) (day 342)',
  test.e_rank(342, :ER) = 'Maharaj');
select test.check('E: Chakravarti Samrat again once the average is <= 85 (day 355), not before (day 354)',
  test.e_rank(354, :ER) = 'Maharaj' and test.e_rank(355, :ER) = 'Chakravarti Samrat');
select test.check('E: Vikramaditya on the first day with 12,000 points (day 420; <= 85 held since day 355)',
  test.e_rank(419, :ER) = 'Chakravarti Samrat' and test.e_rank(420, :ER) = 'Vikramaditya', test.e_total(420, :ER)::text);
select test.check('E: current rank Vikramaditya, no next rank',
  :ER::jsonb->>'rank' = 'Vikramaditya' and :ER::jsonb->'next_rank' = 'null'::jsonb);
select test.check('E: 7-day average reported (84)', (:ER::jsonb->>'avg7_kg')::numeric = 84);

-- Access rules.
select test.run('get_my_points: owner gets their own report', 'authenticated', :C,
  $q$select public.get_my_points()$q$, null, 1);
select test.run('get_my_points: visitor cannot call it', 'anon', null, $q$select public.get_my_points()$q$, 'permission denied');
select test.run('points_report is private (website cannot call it)', 'authenticated', :C,
  format($q$select private.points_report(%L)$q$, :E), 'permission denied');
select test.run('points_rules is private', 'authenticated', :C, $q$select private.points_rules()$q$, 'permission denied');
select test.run('points start date: owner cannot change it', 'authenticated', :A,
  $q$update public.points_settings set start_date = '2000-01-01'$q$, 'permission denied');
select test.run('points start date: owner cannot add one', 'authenticated', :C,
  $q$insert into public.points_settings (start_date) values ('2000-01-01')$q$, 'permission denied');
select test.run('points start date: visitor cannot read it', 'anon', null, $q$select * from public.points_settings$q$, 'permission denied');
select test.check('no start date set = nothing counted yet (start is tomorrow), rank Sainik',
  (select (r->>'total')::int = 0 and r->>'rank' = 'Sainik' and jsonb_array_length(r->'days') = 0 from private.points_report(:E) r));

-- ---------- Share page: the only door for logged-out viewers ----------
-- State here: owner A has four confirmed days (d1 = 2026-10-01, d4 = today, two gym days in Sept) and one unconfirmed (tomorrow).
-- d1 has: food Dal 210 kcal (protein 14), water 500 ml, maad water 250 ml 40 kcal, cardio brisk walk 30 min,
-- a note, and private fields (bedtime 23:30, wake 07:00, junk meals 1).
select token as share_token from public.share_links where label = 'Family' \gset
\set T '''' :share_token ''''

select test.run('visitor can call the share function', 'anon', null,
  format('select public.get_shared_progress(%L)', :'share_token'), null, 1);
select test.check('share shows only confirmed days (4), newest first',
  (select jsonb_array_length(public.get_shared_progress(:T)->'days')) = 4
  and (select public.get_shared_progress(:T)->'days'->1->>'date') = '2026-10-01'
  and (select public.get_shared_progress(:T)->'days'->2->>'date') = '2026-09-21'
  and (select public.get_shared_progress(:T)->'days'->3->>'date') = '2026-09-20',
  (select public.get_shared_progress(:T)::text));
select test.check('share page top level: only the days and the rank (no points, no weights)',
  (select array_agg(k order by k) from jsonb_object_keys(public.get_shared_progress(:T)) k) = array['days', 'rank'],
  (select string_agg(k, ',') from jsonb_object_keys(public.get_shared_progress(:T)) k));
select test.check('share page rank is the owner''s rank (Sainik: no start date yet)',
  public.get_shared_progress(:T)->>'rank' = 'Sainik');
select test.check('unconfirmed (tomorrow) not shared',
  not exists (select 1 from jsonb_array_elements(public.get_shared_progress(:T)->'days') e
              where (e->>'date')::date > (now() at time zone 'Asia/Kolkata')::date));
select test.check('each shared day has exactly the allowed fields',
  (select bool_and((select array_agg(k order by k) from jsonb_object_keys(e) k) =
     array['bedtime','cardio','date','fluids','food','junk_meals','sleep_minutes','steps','wake_time','weight_kg'])
   from jsonb_array_elements(public.get_shared_progress(:T)->'days') e));
select test.check('no hidden field or note text anywhere in the shared data',
  (select public.get_shared_progress(:T)::text) !~* '(porn|gaming|snoring|gasping|stress|energy|pulse|quality|nap|sleepiness|naam|notes|breakfast by mistake|confirmed_at|user_id|"id")',
  (select public.get_shared_progress(:T)::text));
select test.check('shared totals for 1 Oct: 210 kcal food, 750 ml fluids, 40 kcal drinks, 30 min cardio, 7 h 30 sleep',
  (select (e->'food'->>'kcal')::numeric = 210 and (e->'food'->>'protein_g')::numeric = 14
      and (e->'fluids'->>'total_ml')::int = 750 and (e->'fluids'->>'sugary_ml')::int = 0
      and (e->'fluids'->>'kcal')::numeric = 40 and (e->'cardio'->0->>'minutes')::int = 30
      and e->>'bedtime' = '23:30' and (e->>'sleep_minutes')::int = 450 and (e->>'junk_meals')::int = 1
   from jsonb_array_elements(public.get_shared_progress(:T)->'days') e where e->>'date' = '2026-10-01'),
  (select public.get_shared_progress(:T)::text));
select test.check('gym data is not shared (not on the allowed list)',
  (select public.get_shared_progress(:T)::text) !~* '(gym|bench|exercise|rename|reps|weight_kg": 4|felt strong)',
  (select public.get_shared_progress(:T)::text));
select test.check('wrong token returns nothing',
  public.get_shared_progress(repeat('a', 64)) is null);
select test.check('malformed token returns nothing',
  public.get_shared_progress('abc') is null and public.get_shared_progress(null) is null
  and public.get_shared_progress(:T || ' or 1=1') is null);
select test.run('visitor still cannot read tables directly', 'anon', null, $q$select * from public.days$q$, 'permission denied');

-- Another user's link never shows the owner's data.
select test.run('intruder creates own link', 'authenticated', :B,
  $q$insert into public.share_links (label) values ('B link')$q$, null, 1);
select token as b_token from public.share_links where label = 'B link' \gset
select test.check('intruder link shows none of the owner''s days',
  (select jsonb_array_length(public.get_shared_progress(:'b_token')->'days')) = 0);

-- Expired link.
select test.run('owner creates an expired link', 'authenticated', :A,
  $q$insert into public.share_links (label, expires_at) values ('Old', now() - interval '1 minute')$q$, null, 1);
select token as old_token from public.share_links where label = 'Old' \gset
select test.check('expired link returns nothing', public.get_shared_progress(:'old_token') is null);

-- Token and owner can never change.
select test.run('cannot change a link''s token', 'authenticated', :A,
  $q$update public.share_links set token = repeat('b', 64) where label = 'Family'$q$, 'cannot be changed');

-- Revoke: immediate and permanent.
select test.run('owner revokes the link', 'authenticated', :A,
  $q$update public.share_links set revoked_at = now() where label = 'Family'$q$, null, 1);
select test.check('revoked link returns nothing', public.get_shared_progress(:T) is null);
select test.run('revoked link cannot be re-activated', 'authenticated', :A,
  $q$update public.share_links set revoked_at = null where label = 'Family'$q$, 'revoked');
select test.run('dashboard cannot re-activate it either', 'postgres', null,
  $q$update public.share_links set revoked_at = null where label = 'Family'$q$, 'revoked');
select test.check('still revoked', public.get_shared_progress(:T) is null);

-- ---------- Backup export: every table can be read in pages ordered by created_at, id ----------
select test.check('every owner table has created_at (the backup export sorts by it)',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'share_links'
      and not exists (select 1 from information_schema.columns col
        where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'created_at')),
  (select string_agg(c.relname, ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (select 1 from information_schema.columns col where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'created_at')));

-- ---------- 008: points start date moved to Mon, 5 Oct 2026 ----------
-- (Run here again, after all test users exist, so it has someone to apply to.)
select md5(string_agg(t::text, '|' order by t::text)) as days_before from public.days t \gset
\ir ../migrations/008_points_start.sql
select test.check('008: every person''s points start on 2026-10-05',
  (select bool_and(start_date = date '2026-10-05') and count(*) = (select count(*) from auth.users) from public.points_settings));
select test.check('008: no logged data changed',
  (select md5(string_agg(t::text, '|' order by t::text)) from public.days t) = :'days_before');
select test.check('008: the report now starts on 5 Oct 2026',
  private.points_report('00000000-0000-0000-0000-00000000000c')->>'start_date' = '2026-10-05');
\ir ../migrations/008_points_start.sql
select test.check('008: running it twice is harmless',
  (select bool_and(start_date = date '2026-10-05') and count(*) = (select count(*) from auth.users) from public.points_settings));

-- ---------- Report ----------
\o
\echo
\echo ===== Results =====
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from test.results;
select n, name, detail from test.results where not ok order by n;
