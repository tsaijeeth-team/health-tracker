-- =====================================================================
-- Health Tracker: database change 009 (points rules v2)
--
-- Run ONCE in Supabase, AFTER 008: SQL Editor -> New query -> paste -> Run.
--
-- Replaces the "clean day" bundle with 9 pillars scored independently on
-- every confirmed day (owner's rules v2, 8 Oct 2026). Points are never
-- stored, so v2 applies retrospectively from the points start date
-- (Mon 5 Oct 2026) by recalculating from saved logs. No logged or locked
-- data is changed.
--
-- 1. days.fast_day: Yes/No (default No). Part of the day: locks on confirm.
-- 2. private.points_rules(): ALL v2 values in one place (draft).
-- 3. private.day_pillars(): the 9 pillars for one day (the one calculation,
--    used by the report and by the Confirm dialog preview).
-- 4. private.points_report(): v2 (pillars + junk-free streak + unchanged
--    weekly target, milestones, missed confirm and rank logic).
-- 5. public.preview_day_points(date): the owner's "points if confirmed now".
-- =====================================================================

-- ---------- 1. Fast day ----------
-- Adding a column with a default does not rewrite or "update" any row: no lock trigger fires.
alter table public.days add column fast_day boolean not null default false;

-- ---------- 2. Rules v2 (draft values: change them here only) ----------
create or replace function private.points_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 2,
    -- Pillars (confirmed days only; a blank field scores the pillar's worst value)
    'nutrition_kcal_under',   2000,  -- food + known drink kcal must be UNDER this
    'nutrition_protein_over',  100,  -- known protein must be OVER this (g)
    'nutrition_hit',            20,
    'nutrition_miss',          -20,  -- also: no food logged (not a fast day)
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

-- ---------- 3. The 9 pillars for one day ----------
-- Works for any date (a day with no row = everything blank). Returns
-- { points, blanks, pillars: [{code, name, points, detail, blank}] } in a fixed order.
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

  -- 1. Nutrition: food + known drink kcal under the limit AND known protein over the target.
  if has_day and day.fast_day then
    pts := (r->>'nutrition_fast_day')::int; det := 'Fast day';
  elsif n_food = 0 then
    pts := (r->>'nutrition_miss')::int; det := 'no food logged';
  else
    pts := case when v_kcal < (r->>'nutrition_kcal_under')::numeric and v_protein > (r->>'nutrition_protein_over')::numeric
                then (r->>'nutrition_hit')::int else (r->>'nutrition_miss')::int end;
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

-- ---------- 4. The report, v2 ----------
create or replace function private.points_report(p_user uuid, p_now timestamptz default now(), p_start date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r            jsonb := private.points_rules();
  ranks        jsonb := r->'ranks';
  n_ranks      int := jsonb_array_length(r->'ranks');
  v_today      date := (p_now at time zone 'Asia/Kolkata')::date;
  v_start      date;
  d            date;
  day          record;
  confirmed    boolean;
  deadline     timestamptz;
  items        jsonb;
  pillars      jsonb;
  day_pts      int;
  total        int := 0;
  streak       int := 0;
  milestones   jsonb := r->'milestones_kg';
  m_done       numeric[] := '{}';
  m            numeric;
  wk           date;
  tgt          record;
  wk_done      date[] := '{}';
  avg7         numeric;
  holds        int[];
  cur          int := 0;
  best         int;
  i            int;
  rk           jsonb;
  ok           boolean;
  days_out     jsonb := '[]'::jsonb;
  next_rank    jsonb := null;
  this_week    jsonb;
begin
  select coalesce(p_start, s.start_date, v_today + 1) into v_start
    from (select 1) one left join public.points_settings s on s.user_id = p_user;
  holds := array_fill(0, array[n_ranks]);

  d := v_start;
  while d <= v_today loop
    select x.* into day from public.days x where x.user_id = p_user and x.log_date = d;
    confirmed := found and day.confirmed_at is not null;
    deadline := ((d + (r->>'confirm_days')::int + 1)::timestamp at time zone 'Asia/Kolkata');
    items := '[]'::jsonb;
    pillars := null;

    if (not confirmed and p_now >= deadline) or (confirmed and day.confirmed_at >= deadline) then
      items := items || jsonb_build_object('code', 'missed_confirm', 'points', (r->>'missed_confirm')::int,
        'label', format('Not confirmed by %s, 23:59 (7-day deadline)', to_char(d + (r->>'confirm_days')::int, 'DD Mon')));
    end if;

    if not confirmed then
      streak := 0;
      if p_now < deadline then
        items := items || jsonb_build_object('code', 'pending', 'points', 0,
          'label', 'Not confirmed yet: no points until confirmed');
      end if;
    else
      pillars := private.day_pillars(p_user, d);

      -- Junk-free streak: consecutive confirmed days with 0 junk meals (blank breaks it).
      if day.junk_meals = 0 then
        streak := streak + 1;
        if streak % (r->>'streak_length')::int = 0 then
          items := items || jsonb_build_object('code', 'streak', 'points', (r->>'streak_bonus')::int,
            'label', format('%s-day junk-free streak', streak));
        end if;
      else
        streak := 0;
      end if;

      if day.weight_kg is not null then
        for m in select value::numeric from jsonb_array_elements_text(milestones) loop
          if not (m = any (m_done)) and day.weight_kg <= m then
            m_done := m_done || m;
            items := items || jsonb_build_object('code', 'milestone', 'points', (r->>'milestone')::int,
              'label', format('Weight milestone: %s kg or less', m));
          end if;
        end loop;
        wk := date_trunc('week', d)::date;
        if not (wk = any (wk_done)) then
          select t.* into tgt from public.weight_targets t where t.user_id = p_user and t.week_start = wk;
          if found and d >= tgt.set_on and day.weight_kg <= tgt.target_kg then
            wk_done := wk_done || wk;
            items := items || jsonb_build_object('code', 'weekly_target', 'points', (r->>'weekly_target')::int,
              'label', format('Weekly target hit (%s kg or less)', tgt.target_kg));
          end if;
        end if;
      end if;
    end if;

    select coalesce(sum((e->>'points')::int), 0) into day_pts from jsonb_array_elements(items) e;
    day_pts := day_pts + coalesce((pillars->>'points')::int, 0);
    total := total + day_pts;

    select round(avg(x.weight_kg), 2) into avg7 from public.days x
      where x.user_id = p_user and x.confirmed_at is not null and x.weight_kg is not null
        and x.log_date between d - 6 and d;
    for i in 0 .. n_ranks - 1 loop
      rk := ranks->i;
      if rk ? 'gate_kg' then
        holds[i + 1] := case when avg7 is not null and avg7 <= (rk->>'gate_kg')::numeric then holds[i + 1] + 1 else 0 end;
      end if;
    end loop;

    -- Rank (unchanged logic): keep the current rank unless its points or weight rule is broken,
    -- then take the highest rank whose full requirement is met now.
    rk := ranks->cur;
    if total < (rk->>'points')::int
       or (rk ? 'keep_kg' and avg7 is not null and avg7 > (rk->>'keep_kg')::numeric) then
      cur := 0;
    end if;
    best := 0;
    for i in 0 .. n_ranks - 1 loop
      rk := ranks->i;
      ok := total >= (rk->>'points')::int;
      if ok and rk ? 'gate_kg' then
        ok := avg7 is not null and avg7 <= (rk->>'gate_kg')::numeric
              and holds[i + 1] >= greatest((rk->>'hold_days')::int, 1);
      end if;
      if ok then best := i; end if;
    end loop;
    if best > cur then cur := best; end if;

    days_out := jsonb_build_object('date', d, 'confirmed', confirmed,
      'pillars', coalesce(pillars->'pillars', '[]'::jsonb), 'items', items,
      'points', day_pts, 'total', total, 'avg7_kg', avg7, 'rank', ranks->cur->>'name') || days_out;
    d := d + 1;
  end loop;

  if v_start > v_today then
    select round(avg(x.weight_kg), 2) into avg7 from public.days x
      where x.user_id = p_user and x.confirmed_at is not null and x.weight_kg is not null
        and x.log_date between v_today - 6 and v_today;
  end if;

  if cur < n_ranks - 1 then
    rk := ranks->(cur + 1);
    next_rank := jsonb_build_object(
      'name', rk->>'name',
      'points', (rk->>'points')::int,
      'points_needed', greatest((rk->>'points')::int - total, 0),
      'gate_kg', rk->'gate_kg',
      'hold_days', rk->'hold_days',
      'held_days', case when rk ? 'gate_kg' then holds[cur + 2] end);
  end if;

  wk := date_trunc('week', v_today)::date;
  select jsonb_build_object('week_start', t.week_start, 'target_kg', t.target_kg, 'set_on', t.set_on,
           'hit', private.weight_target_hit(p_user, t.week_start, t.set_on, t.target_kg))
    into this_week from public.weight_targets t where t.user_id = p_user and t.week_start = wk;

  return jsonb_build_object(
    'start_date', v_start,
    'today', v_today,
    'total', total,
    'rank', ranks->cur->>'name',
    'avg7_kg', avg7,
    'next_rank', next_rank,
    'week_start', wk,
    'this_week', this_week,
    'rules', r,
    'days', days_out);
end;
$$;

-- ---------- 5. Confirm dialog: points if this day were confirmed now ----------
-- Pillars for the logged-in owner's own day (by date), plus whether confirming now is late.
-- Streak, target and milestone bonuses depend on other days and are not included.
create or replace function public.preview_day_points(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r jsonb := private.points_rules();
  late boolean;
begin
  if auth.uid() is null then
    raise exception 'Log in first.';
  end if;
  late := now() >= ((p_date + (r->>'confirm_days')::int + 1)::timestamp at time zone 'Asia/Kolkata');
  return private.day_pillars(auth.uid(), p_date)
    || jsonb_build_object('late', late, 'late_points', case when late then (r->>'missed_confirm')::int else 0 end);
end;
$$;

revoke all on function public.preview_day_points(date) from public, anon;
grant execute on function public.preview_day_points(date) to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
