-- =====================================================================
-- Health Tracker: database change 010 (points rules v2.1: nutrition)
--
-- Run ONCE in Supabase, AFTER 009: SQL Editor -> New query -> paste -> Run.
--
-- Owner's change, 9 Oct 2026. Nutrition on a normal (not fast) day:
--   kcal under 2,000 AND protein over 100 g   -> +20  (unchanged)
--   kcal under 2,000, protein 100 g or less   ->   0  (was -20)
--   kcal 2,000 or more                         -> -20  (unchanged)
--   no food logged                             -> -20  (unchanged)
--   fast day                                   ->   0  (unchanged)
-- Points are never stored, so this applies retrospectively from the points
-- start date. Only these two functions change: no data, no other rule, no lock.
-- =====================================================================

-- ---------- Rules (all values in this one block) ----------
create or replace function private.points_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 2.1,
    -- Pillars (confirmed days only; a blank field scores the pillar's worst value)
    'nutrition_kcal_under',   2000,  -- food + known drink kcal must be UNDER this
    'nutrition_protein_over',  100,  -- known protein must be OVER this (g)
    'nutrition_hit',            20,  -- kcal under the limit AND protein over the target
    'nutrition_kcal_only',       0,  -- kcal under the limit, protein not over the target (v2.1)
    'nutrition_miss',          -20,  -- kcal at or over the limit; also: no food logged (not a fast day)
    'nutrition_fast_day',        0,
    'steps_over',             5000,
    'steps_hit',                10,
    'steps_miss',              -10,
    'junk_free',                10,  -- 0 junk meals
    'junk_any',                -50,  -- 1 or more (also blank)
    'porn_no',                   5,
    'porn_yes',                -15,  -- also blank
    'gaming_zero',               5,  -- 0 h
    'gaming_limit_h',            2,
    'gaming_within',             0,  -- more than 0, up to the limit
    'gaming_over',             -10,  -- over the limit (also blank)
    'sleep_good_h',              7,
    'sleep_ok_h',                6,
    'sleep_good',               10,  -- 7 h or more
    'sleep_ok',                  0,  -- 6 h to under 7 h
    'sleep_short',             -10,  -- under 6 h (also blank)
    'fluids_good_ml',         4000,
    'fluids_ok_ml',           3000,
    'fluids_good',               5,
    'fluids_ok',                 0,
    'fluids_low',               -5,
    'gym',                      10,  -- max 1 per day
    'gym_min_sets',              2,  -- an exercise with this many sets or more
    'naam_jaap_yes',             5,  -- No or blank = 0
    -- Bonuses and penalties
    'streak_bonus',             20,  -- every streak_length-th consecutive junk-free confirmed day
    'streak_length',             7,
    'weekly_target',            10,
    'milestone',                50,
    'milestones_kg',    jsonb_build_array(102, 100, 99.9, 98, 96, 94),
    'missed_confirm',          -20,
    'confirm_days',              7,
    'ranks', jsonb_build_array(
      jsonb_build_object('name', 'Sainik',             'points', 0),
      jsonb_build_object('name', 'Shoorveer',          'points', 525),
      jsonb_build_object('name', 'Samanth',            'points', 1050),
      jsonb_build_object('name', 'Raja',               'points', 2250),
      jsonb_build_object('name', 'Maharaj',            'points', 5250,  'gate_kg', 94, 'keep_kg', 95, 'hold_days', 28),
      jsonb_build_object('name', 'Chakravarti Samrat', 'points', 11250, 'gate_kg', 85, 'keep_kg', 86, 'hold_days', 0),
      jsonb_build_object('name', 'Vikramaditya',       'points', 18000, 'gate_kg', 85, 'keep_kg', 86, 'hold_days', 28)
    )
  );
$$;

-- ---------- The 9 pillars for one day (only Nutrition changed) ----------
create or replace function private.day_pillars(p_user uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r        jsonb := private.points_rules();
  day      record;
  has_day  boolean;
  n_food   int := 0;
  v_kcal     numeric := 0;
  v_protein  numeric := 0;
  unknown_drinks int := 0;
  v_ml       numeric := 0;
  gym_ok   boolean := false;
  gym_any  boolean := false;
  out      jsonb := '[]'::jsonb;
  pts      int;
  det      text;
  fmt      text := 'FM999,990';
begin
  select x.* into day from public.days x where x.user_id = p_user and x.log_date = p_date;
  has_day := found;
  if has_day then
    select count(*), coalesce(sum(i.kcal), 0), coalesce(sum(i.protein_g), 0)
      into n_food, v_kcal, v_protein from public.food_items i where i.day_id = day.id;
    select coalesce(sum(f.ml), 0),
           v_kcal + coalesce(sum(f.kcal), 0),
           count(*) filter (where f.kcal is null and f.drink_type in ('maad_water', 'sugary_drink', 'other'))
      into v_ml, v_kcal, unknown_drinks from public.fluids f where f.day_id = day.id;
    gym_any := exists (select 1 from public.gym_sessions s where s.day_id = day.id);
    gym_ok := exists (
      select 1 from public.gym_sessions s join public.gym_exercises g on g.session_id = s.id
      where s.day_id = day.id
        and (select count(*) from public.gym_sets x where x.entry_id = g.id) >= (r->>'gym_min_sets')::int);
  end if;

  -- 1. Nutrition (v2.1): food + known drink kcal under the limit = no penalty; plus protein over the target = points.
  if has_day and day.fast_day then
    pts := (r->>'nutrition_fast_day')::int; det := 'Fast day';
  elsif n_food = 0 then
    pts := (r->>'nutrition_miss')::int; det := 'no food logged';
  else
    -- v2.1: over the kcal limit = miss; under it = hit with enough protein, else 0 (no penalty, no points).
    pts := case when v_kcal >= (r->>'nutrition_kcal_under')::numeric then (r->>'nutrition_miss')::int
                when v_protein > (r->>'nutrition_protein_over')::numeric then (r->>'nutrition_hit')::int
                else (r->>'nutrition_kcal_only')::int end;
    det := format('%s kcal (needs under %s) · %s g protein (needs over %s)',
      to_char(round(v_kcal), fmt), to_char((r->>'nutrition_kcal_under')::int, fmt),
      trim_scale(round(v_protein, 1))::text, r->>'nutrition_protein_over');
    if unknown_drinks > 0 then
      det := det || format(' · %s drink%s with unknown kcal', unknown_drinks, case when unknown_drinks = 1 then '' else 's' end);
    end if;
  end if;
  out := out || jsonb_build_object('code', 'nutrition', 'name', 'Nutrition', 'points', pts, 'detail', det, 'blank', false);

  -- 2. Steps
  if not has_day or day.steps is null then
    out := out || jsonb_build_object('code', 'steps', 'name', 'Steps', 'points', (r->>'steps_miss')::int, 'detail', 'blank', 'blank', true);
  else
    out := out || jsonb_build_object('code', 'steps', 'name', 'Steps', 'blank', false,
      'points', case when day.steps > (r->>'steps_over')::int then (r->>'steps_hit')::int else (r->>'steps_miss')::int end,
      'detail', format('%s steps (needs over %s)', to_char(day.steps, fmt), to_char((r->>'steps_over')::int, fmt)));
  end if;

  -- 3. Junk
  if not has_day or day.junk_meals is null then
    out := out || jsonb_build_object('code', 'junk', 'name', 'Junk', 'points', (r->>'junk_any')::int, 'detail', 'blank', 'blank', true);
  else
    out := out || jsonb_build_object('code', 'junk', 'name', 'Junk', 'blank', false,
      'points', case when day.junk_meals = 0 then (r->>'junk_free')::int else (r->>'junk_any')::int end,
      'detail', case when day.junk_meals = 0 then 'no junk meals'
                     else format('%s junk meal%s', day.junk_meals, case when day.junk_meals = 1 then '' else 's' end) end);
  end if;

  -- 4. Porn
  if not has_day or day.porn is null then
    out := out || jsonb_build_object('code', 'porn', 'name', 'Porn', 'points', (r->>'porn_yes')::int, 'detail', 'blank', 'blank', true);
  else
    out := out || jsonb_build_object('code', 'porn', 'name', 'Porn', 'blank', false,
      'points', case when day.porn then (r->>'porn_yes')::int else (r->>'porn_no')::int end,
      'detail', case when day.porn then 'Yes' else 'No' end);
  end if;

  -- 5. Gaming (affects only this pillar)
  if not has_day or day.gaming_hours is null then
    out := out || jsonb_build_object('code', 'gaming', 'name', 'Gaming', 'points', (r->>'gaming_over')::int, 'detail', 'blank', 'blank', true);
  else
    out := out || jsonb_build_object('code', 'gaming', 'name', 'Gaming', 'blank', false,
      'points', case when day.gaming_hours = 0 then (r->>'gaming_zero')::int
                     when day.gaming_hours <= (r->>'gaming_limit_h')::numeric then (r->>'gaming_within')::int
                     else (r->>'gaming_over')::int end,
      'detail', format('%s h', trim_scale(day.gaming_hours)::text));
  end if;

  -- 6. Sleep (calculated from bedtime and wake time; naps not counted)
  if not has_day or day.sleep_minutes is null then
    out := out || jsonb_build_object('code', 'sleep', 'name', 'Sleep', 'points', (r->>'sleep_short')::int, 'detail', 'blank', 'blank', true);
  else
    out := out || jsonb_build_object('code', 'sleep', 'name', 'Sleep', 'blank', false,
      'points', case when day.sleep_minutes >= (r->>'sleep_good_h')::int * 60 then (r->>'sleep_good')::int
                     when day.sleep_minutes >= (r->>'sleep_ok_h')::int * 60 then (r->>'sleep_ok')::int
                     else (r->>'sleep_short')::int end,
      'detail', format('%s h %s min', day.sleep_minutes / 60, day.sleep_minutes % 60));
  end if;

  -- 7. Fluids (all drinks)
  out := out || jsonb_build_object('code', 'fluids', 'name', 'Fluids', 'blank', false,
    'points', case when v_ml >= (r->>'fluids_good_ml')::numeric then (r->>'fluids_good')::int
                   when v_ml >= (r->>'fluids_ok_ml')::numeric then (r->>'fluids_ok')::int
                   else (r->>'fluids_low')::int end,
    'detail', format('%s ml', to_char(v_ml, fmt)));

  -- 8. Gym
  out := out || jsonb_build_object('code', 'gym', 'name', 'Gym', 'blank', false,
    'points', case when gym_ok then (r->>'gym')::int else 0 end,
    'detail', case when gym_ok then 'session' when gym_any then format('no exercise with %s+ sets', r->>'gym_min_sets') else 'no session' end);

  -- 9. Naam Jaap
  out := out || jsonb_build_object('code', 'naam_jaap', 'name', 'Naam Jaap',
    'points', case when has_day and day.naam_jaap then (r->>'naam_jaap_yes')::int else 0 end,
    'detail', case when not has_day or day.naam_jaap is null then 'blank' when day.naam_jaap then 'Yes' else 'No' end,
    'blank', not has_day or day.naam_jaap is null);

  return jsonb_build_object(
    'points', (select coalesce(sum((e->>'points')::int), 0) from jsonb_array_elements(out) e),
    'blanks', (select count(*) from jsonb_array_elements(out) e where (e->>'blank')::boolean),
    'pillars', out);
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
