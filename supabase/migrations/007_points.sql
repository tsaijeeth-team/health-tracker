-- =====================================================================
-- Health Tracker: database change 007, build step 14 (points & rank)
--
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- 1. private.points_rules(): EVERY point value and rank threshold, in one
--    place. They are a draft: to change them, edit this function and run
--    just that "create or replace function" block again.
-- 2. points_settings: the date points start (set to the day after this file
--    is run; earlier days are ignored).
-- 3. weight_targets: one weekly target weight per week (Monday-Sunday, India
--    time). Locked once hit.
-- 4. private.points_report(): the ONE calculation. Only confirmed days earn
--    or lose day points; a missed confirm deadline costs -20. Nothing is
--    stored: it is worked out from your data each time, so it can never
--    drift out of sync.
-- 5. public.get_my_points(): the logged-in owner's report (app screen).
-- 6. The share page now also shows the current rank (not the points).
-- =====================================================================

-- ---------- 1. Rules (draft values: change them here only) ----------
create or replace function private.points_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'clean_day',        20,    -- junk meals 0 AND porn No AND gaming <= gaming_limit_h (no blanks)
    'no_games',          5,    -- gaming = 0
    'gym',              10,    -- max 1 per day; needs an exercise with gym_min_sets or more sets
    'gym_min_sets',      2,
    'streak_bonus',     20,    -- on every streak_length-th consecutive clean confirmed day
    'streak_length',     7,
    'weekly_target',    10,    -- first confirmed weigh-in at or below this week's target
    'milestone',        50,    -- each, once ever
    'milestones_kg',    jsonb_build_array(102, 100, 99.9, 98, 96, 94),
    'junk_day',        -50,    -- a day with 1 or more junk meals
    'porn',            -15,
    'gaming_over',     -10,    -- gaming above gaming_limit_h
    'gaming_limit_h',    2,
    'missed_confirm',  -20,    -- not confirmed by 23:59 IST on the confirm_days-th day after
    'confirm_days',      7,
    'ranks', jsonb_build_array(
      jsonb_build_object('name', 'Sainik',             'points', 0),
      jsonb_build_object('name', 'Shoorveer',          'points', 350),
      jsonb_build_object('name', 'Samanth',            'points', 700),
      jsonb_build_object('name', 'Raja',               'points', 1500),
      -- gate_kg: 7-day average needed to GAIN the rank; keep_kg: lost above this; hold_days: gate held that long
      jsonb_build_object('name', 'Maharaj',            'points', 3500,  'gate_kg', 94, 'keep_kg', 95, 'hold_days', 28),
      jsonb_build_object('name', 'Chakravarti Samrat', 'points', 7500,  'gate_kg', 85, 'keep_kg', 86, 'hold_days', 0),
      jsonb_build_object('name', 'Vikramaditya',       'points', 12000, 'gate_kg', 85, 'keep_kg', 86, 'hold_days', 28)
    )
  );
$$;

-- ---------- 2. Points start date ----------
create table public.points_settings (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  start_date  date not null,
  created_at  timestamptz not null default now()
);
alter table public.points_settings enable row level security;
revoke all on public.points_settings from anon, authenticated;
grant select on public.points_settings to authenticated;  -- read only; set once, below
create policy "owner reads own points settings" on public.points_settings
  for select to authenticated using (user_id = (select auth.uid()));

-- Points start the day after this file is run (India time). Earlier days are ignored.
insert into public.points_settings (user_id, start_date)
  select u.id, private.today_ist() + 1 from auth.users u
  on conflict (user_id) do nothing;

-- ---------- 3. Weekly weight targets ----------
create table public.weight_targets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week_start  date not null check (extract(isodow from week_start) = 1),  -- a Monday
  target_kg   numeric not null check (target_kg >= 30 and target_kg <= 300 and target_kg = round(target_kg, 1)),
  set_on      date not null,  -- weigh-ins from this day on count (always set by the database: see guard)
  created_at  timestamptz not null default now(),
  constraint weight_target_once_per_week unique (user_id, week_start)
);
create index weight_targets_user_week_idx on public.weight_targets (user_id, week_start);
alter table public.weight_targets enable row level security;
revoke all on public.weight_targets from anon, authenticated;
grant select, insert, delete on public.weight_targets to authenticated;
grant update (target_kg) on public.weight_targets to authenticated;
create policy "owner manages own weight targets" on public.weight_targets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- True once a confirmed weigh-in on or after set_on, in that week, is at or below the target.
create or replace function private.weight_target_hit(p_user uuid, p_week_start date, p_set_on date, p_target numeric)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.days d
    where d.user_id = p_user
      and d.confirmed_at is not null
      and d.weight_kg is not null
      and d.log_date between greatest(p_week_start, p_set_on) and p_week_start + 6
      and d.weight_kg <= p_target);
$$;

-- Targets: this week or later only; set_on comes from the server clock; locked once hit.
create or replace function private.guard_weight_targets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE')
     and private.weight_target_hit(old.user_id, old.week_start, old.set_on, old.target_kg) then
    raise exception 'The target for the week of % was already hit — locked.', old.week_start;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.week_start < date_trunc('week', private.today_ist())::date then
    raise exception 'A target can only be set for this week or a later week.';
  end if;
  new.set_on := private.today_ist();
  return new;
end;
$$;

create trigger guard_weight_targets
  before insert or update or delete on public.weight_targets
  for each row execute function private.guard_weight_targets();
create trigger block_truncate_weight_targets before truncate on public.weight_targets for each statement execute function private.block_truncate();
create trigger block_truncate_points_settings before truncate on public.points_settings for each statement execute function private.block_truncate();

-- ---------- 4. The calculation ----------
-- Walks every day from the start date to today (India time) and returns:
--   total, rank, the 7-day average weight, what the next rank needs, this week's target,
--   and every day (newest first) with each rule that applied and its points.
-- p_now and p_start exist so tests can pick "now" and the start date.
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
  day_pts      int;
  total        int := 0;
  streak       int := 0;
  is_clean     boolean;
  reasons      text[];
  milestones   jsonb := r->'milestones_kg';
  m_done       numeric[] := '{}';
  m            numeric;
  wk           date;
  tgt          record;
  wk_done      date[] := '{}';
  avg7         numeric;
  holds        int[];
  cur          int := 0;   -- index into ranks (0 = Sainik)
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
    -- Deadline: 23:59:59 IST on the confirm_days-th day after = midnight IST starting the next day.
    deadline := ((d + (r->>'confirm_days')::int + 1)::timestamp at time zone 'Asia/Kolkata');
    items := '[]'::jsonb;

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
      -- Clean day: all three answered and within limits.
      reasons := '{}';
      if day.junk_meals is null then reasons := reasons || 'junk meals not answered'::text;
      elsif day.junk_meals > 0 then reasons := reasons || format('%s junk meal%s', day.junk_meals, case when day.junk_meals = 1 then '' else 's' end); end if;
      if day.porn is null then reasons := reasons || 'porn not answered'::text;
      elsif day.porn then reasons := reasons || 'porn Yes'::text; end if;
      if day.gaming_hours is null then reasons := reasons || 'gaming not answered'::text;
      elsif day.gaming_hours > (r->>'gaming_limit_h')::numeric then reasons := reasons || format('gaming %s h', day.gaming_hours); end if;
      is_clean := cardinality(reasons) = 0;

      if is_clean then
        streak := streak + 1;
        items := items || jsonb_build_object('code', 'clean_day', 'points', (r->>'clean_day')::int, 'label', 'Clean day');
        if streak % (r->>'streak_length')::int = 0 then
          items := items || jsonb_build_object('code', 'streak', 'points', (r->>'streak_bonus')::int,
            'label', format('%s-day clean streak', streak));
        end if;
      else
        streak := 0;
        items := items || jsonb_build_object('code', 'not_clean', 'points', 0,
          'label', 'Not clean: ' || array_to_string(reasons, ', '));
      end if;

      if day.gaming_hours = 0 then
        items := items || jsonb_build_object('code', 'no_games', 'points', (r->>'no_games')::int, 'label', 'No games played');
      end if;
      if day.junk_meals > 0 then
        items := items || jsonb_build_object('code', 'junk_day', 'points', (r->>'junk_day')::int,
          'label', format('Junk food (%s meal%s)', day.junk_meals, case when day.junk_meals = 1 then '' else 's' end));
      end if;
      if day.porn then
        items := items || jsonb_build_object('code', 'porn', 'points', (r->>'porn')::int, 'label', 'Porn');
      end if;
      if day.gaming_hours > (r->>'gaming_limit_h')::numeric then
        items := items || jsonb_build_object('code', 'gaming_over', 'points', (r->>'gaming_over')::int,
          'label', format('Gaming over %s h (%s h)', r->>'gaming_limit_h', day.gaming_hours));
      end if;

      -- Gym: a session with at least one exercise of gym_min_sets or more sets.
      if exists (
        select 1 from public.gym_sessions s join public.gym_exercises g on g.session_id = s.id
        where s.day_id = day.id
          and (select count(*) from public.gym_sets x where x.entry_id = g.id) >= (r->>'gym_min_sets')::int) then
        items := items || jsonb_build_object('code', 'gym', 'points', (r->>'gym')::int, 'label', 'Gym session');
      elsif exists (select 1 from public.gym_sessions s where s.day_id = day.id) then
        items := items || jsonb_build_object('code', 'gym_too_short', 'points', 0,
          'label', format('Gym session without an exercise of %s+ sets: no points', r->>'gym_min_sets'));
      end if;

      if day.weight_kg is not null then
        -- Milestones: once ever each.
        for m in select value::numeric from jsonb_array_elements_text(milestones) loop
          if not (m = any (m_done)) and day.weight_kg <= m then
            m_done := m_done || m;
            items := items || jsonb_build_object('code', 'milestone', 'points', (r->>'milestone')::int,
              'label', format('Weight milestone: %s kg or less', m));
          end if;
        end loop;
        -- Weekly target: first confirmed weigh-in on/after the day the target was set.
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
    total := total + day_pts;

    -- 7-day average of confirmed morning weights ending today-in-the-walk.
    select round(avg(x.weight_kg), 2) into avg7 from public.days x
      where x.user_id = p_user and x.confirmed_at is not null and x.weight_kg is not null
        and x.log_date between d - 6 and d;
    for i in 0 .. n_ranks - 1 loop
      rk := ranks->i;
      if rk ? 'gate_kg' then
        holds[i + 1] := case when avg7 is not null and avg7 <= (rk->>'gate_kg')::numeric then holds[i + 1] + 1 else 0 end;
      end if;
    end loop;

    -- Rank: keep the current one unless its points or weight rule is broken; then take the
    -- highest rank whose full requirement is met now (if higher than what is held).
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
    -- (After a loss cur restarted at 0, so the line above lands on the best rank met now.)

    days_out := jsonb_build_object('date', d, 'confirmed', confirmed, 'items', items,
      'points', day_pts, 'total', total, 'avg7_kg', avg7, 'rank', ranks->cur->>'name') || days_out;
    d := d + 1;
  end loop;

  -- The current 7-day average, also when the walk has not started yet.
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

-- ---------- 5. The owner's report (app) ----------
create or replace function public.get_my_points()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Log in first.';
  end if;
  return private.points_report(auth.uid());
end;
$$;

revoke all on function public.get_my_points() from public, anon;
grant execute on function public.get_my_points() to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

-- ---------- 6. Share page: also the current rank ----------
-- Same as in 004, plus one field: 'rank' (the rank name only; no points, no weights).
create or replace function public.get_shared_progress(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  link_owner uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select l.user_id into link_owner
  from public.share_links l
  where l.token = p_token
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now());

  if link_owner is null then
    return null;
  end if;

  return jsonb_build_object(
    'rank', private.points_report(link_owner)->>'rank',
    'days',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', d.log_date,
          'weight_kg', d.weight_kg,
          'bedtime', to_char(d.bedtime, 'HH24:MI'),
          'wake_time', to_char(d.wake_time, 'HH24:MI'),
          'sleep_minutes', d.sleep_minutes,
          'steps', d.steps,
          'junk_meals', d.junk_meals,
          'food', jsonb_build_object(
            'kcal', f.kcal,
            'protein_g', f.protein_g, 'protein_unknown', f.protein_unknown,
            'carbs_g', f.carbs_g, 'carbs_unknown', f.carbs_unknown,
            'fat_g', f.fat_g, 'fat_unknown', f.fat_unknown,
            'fibre_g', f.fibre_g, 'fibre_unknown', f.fibre_unknown
          ),
          'fluids', jsonb_build_object(
            'total_ml', fl.total_ml,
            'sugary_ml', fl.sugary_ml,
            'kcal', fl.kcal,
            'kcal_unknown', fl.kcal_unknown
          ),
          'cardio', c.sessions
        )
        order by d.log_date desc
      )
      from public.days d
      cross join lateral (
        select
          coalesce(sum(i.kcal), 0) as kcal,
          coalesce(sum(i.protein_g), 0) as protein_g, count(*) filter (where i.protein_g is null) as protein_unknown,
          coalesce(sum(i.carbs_g), 0) as carbs_g, count(*) filter (where i.carbs_g is null) as carbs_unknown,
          coalesce(sum(i.fat_g), 0) as fat_g, count(*) filter (where i.fat_g is null) as fat_unknown,
          coalesce(sum(i.fibre_total_g), 0) as fibre_g, count(*) filter (where i.fibre_total_g is null) as fibre_unknown
        from public.food_items i
        where i.day_id = d.id
      ) f
      cross join lateral (
        select
          coalesce(sum(x.ml), 0) as total_ml,
          coalesce(sum(x.ml) filter (where x.drink_type = 'sugary_drink'), 0) as sugary_ml,
          coalesce(sum(x.kcal), 0) as kcal,
          count(*) filter (where x.kcal is null and x.drink_type in ('maad_water', 'sugary_drink', 'other')) as kcal_unknown
        from public.fluids x
        where x.day_id = d.id
      ) fl
      cross join lateral (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'type', s.cardio_type,
              'minutes', s.minutes,
              'start_time', to_char(s.start_time, 'HH24:MI'),
              'description', s.description
            )
            order by s.start_time
          ),
          '[]'::jsonb
        ) as sessions
        from public.cardio_sessions s
        where s.day_id = d.id
      ) c
      where d.user_id = link_owner
        and d.confirmed_at is not null
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_shared_progress(text) from public;
grant execute on function public.get_shared_progress(text) to anon, authenticated;
