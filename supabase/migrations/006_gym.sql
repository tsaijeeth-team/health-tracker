-- =====================================================================
-- Health Tracker: database change 006, build step 12 (gym log)
--
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- Tables:
--   exercises      your saved exercise list (no duplicates: "Bench press"
--                  and " bench  PRESS" count as the same name). Can be
--                  renamed any time; deleted only if never used.
--   exercise_renames  permanent history of renames (old -> new, when)
--   gym_sessions   ONE per day at most (enforced here, not just in the app)
--   gym_exercises  exercises done in a session, with an optional note
--   gym_sets       sets: reps 1-100, weight 0-500 kg (max 2 decimals)
-- Owner-only rules on every table. Everything about a session locks when
-- its day is confirmed, exactly like food, drinks and cardio.
-- save_gym_session() saves a whole session in one go: all or nothing.
-- =====================================================================

-- ---------- Tables ----------

create table public.exercises (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  -- Lower-case, trimmed, single-spaced: the key that prevents duplicates.
  name_key    text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  created_at  timestamptz not null default now(),
  constraint exercises_unique_name unique (user_id, name_key)
);

-- Every rename, written by the database itself. Permanent: never edited or deleted
-- (it disappears only with its exercise, and only unused exercises can be deleted).
create table public.exercise_renames (
  id           uuid primary key default gen_random_uuid(),
  exercise_id  uuid not null references public.exercises (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  old_name     text not null,
  new_name     text not null,
  renamed_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()  -- same as renamed_at; every table has one (backup export sorts by it)
);

create table public.gym_sessions (
  id             uuid primary key default gen_random_uuid(),
  day_id         uuid not null references public.days (id) on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  start_time     time not null,
  muscle_groups  text[] not null check (
                   cardinality(muscle_groups) between 1 and 6
                   and muscle_groups <@ array['chest', 'back', 'shoulders', 'arms', 'legs', 'core']
                 ),
  created_at     timestamptz not null default now(),
  constraint gym_one_session_per_day unique (day_id)
);

create table public.gym_exercises (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.gym_sessions (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id  uuid not null references public.exercises (id) on delete restrict,
  position     smallint not null check (position between 1 and 50),
  note         text check (length(btrim(note)) between 1 and 500),
  created_at   timestamptz not null default now(),
  constraint gym_exercise_once_per_session unique (session_id, exercise_id)
);

create table public.gym_sets (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.gym_exercises (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  set_number  smallint not null check (set_number between 1 and 50),
  reps        smallint not null check (reps between 1 and 100),
  weight_kg   numeric not null check (weight_kg >= 0 and weight_kg <= 500 and weight_kg = round(weight_kg, 2)),
  created_at  timestamptz not null default now(),
  constraint gym_set_number_unique unique (entry_id, set_number)
);

create index exercise_renames_exercise_id_idx on public.exercise_renames (exercise_id);
create index gym_sessions_day_id_idx       on public.gym_sessions (day_id);
create index gym_exercises_session_id_idx  on public.gym_exercises (session_id);
create index gym_exercises_exercise_id_idx on public.gym_exercises (exercise_id);
create index gym_sets_entry_id_idx         on public.gym_sets (entry_id);

-- ---------- Owner-only access ----------

alter table public.exercises     enable row level security;
alter table public.exercise_renames enable row level security;
alter table public.gym_sessions  enable row level security;
alter table public.gym_exercises enable row level security;
alter table public.gym_sets      enable row level security;

revoke all on public.exercises, public.exercise_renames, public.gym_sessions, public.gym_exercises, public.gym_sets from anon, authenticated;
-- Exercises: add, read, rename (the name only), delete (only if never used: see below).
-- Renaming never touches sets, reps or kg; sessions point to the exercise, not its name.
grant select, insert, delete on public.exercises to authenticated;
grant update (name) on public.exercises to authenticated;
-- Rename history: read only. Rows are written by the database, never by the app.
grant select on public.exercise_renames to authenticated;
grant select, insert, update, delete on public.gym_sessions, public.gym_exercises, public.gym_sets to authenticated;

create policy "owner reads own exercises" on public.exercises
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owner adds own exercises" on public.exercises
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "owner renames own exercises" on public.exercises
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner deletes own exercises" on public.exercises
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "owner reads own rename history" on public.exercise_renames
  for select to authenticated using (user_id = (select auth.uid()));

create policy "owner manages own gym sessions" on public.gym_sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.days d where d.id = day_id and d.user_id = (select auth.uid()))
  );

create policy "owner manages own gym exercises" on public.gym_exercises
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.gym_sessions s where s.id = session_id and s.user_id = (select auth.uid()))
    and exists (select 1 from public.exercises e where e.id = exercise_id and e.user_id = (select auth.uid()))
  );

create policy "owner manages own gym sets" on public.gym_sets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.gym_exercises g where g.id = entry_id and g.user_id = (select auth.uid()))
  );

-- ---------- Exercise rename history and delete rule ----------

-- Records every real name change. Runs with the database's rights because the app
-- itself may not write history rows. Time comes from the server clock.
create or replace function private.record_exercise_rename()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name is distinct from old.name then
    insert into public.exercise_renames (exercise_id, user_id, old_name, new_name)
      values (new.id, new.user_id, old.name, new.name);
  end if;
  return new;
end;
$$;

create trigger record_exercise_rename
  after update of name on public.exercises
  for each row execute function private.record_exercise_rename();

-- Delete only if the exercise was never used; otherwise a clear message.
create or replace function private.guard_exercise_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  used int;
begin
  select count(*) into used from public.gym_exercises where exercise_id = old.id;
  if used > 0 then
    raise exception 'Used in % session% — rename instead.', used, case when used = 1 then '' else 's' end;
  end if;
  return old;
end;
$$;

create trigger guard_exercise_delete
  before delete on public.exercises
  for each row execute function private.guard_exercise_delete();

-- History is permanent, even for the dashboard. It goes only together with its
-- (never used) exercise, or with the whole account.
create or replace function private.guard_exercise_renames()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and (
       not exists (select 1 from public.exercises e where e.id = old.exercise_id)
       or not exists (select 1 from auth.users u where u.id = old.user_id)) then
    return old;
  end if;
  raise exception 'Rename history is permanent: it cannot be changed or removed.';
end;
$$;

create trigger guard_exercise_renames
  before update or delete on public.exercise_renames
  for each row execute function private.guard_exercise_renames();
create trigger block_truncate_exercise_renames before truncate on public.exercise_renames for each statement execute function private.block_truncate();

-- ---------- Confirm-lock for gym data ----------

-- Sessions hang off a day directly: reuse the same rule as food, drinks and cardio.
create trigger guard_gym_sessions
  before insert or update or delete on public.gym_sessions
  for each row execute function private.guard_day_children();

-- Exercises in a session: find the day through the session.
create or replace function private.guard_gym_exercises()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_date date;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select d.log_date into locked_date
      from public.gym_sessions s join public.days d on d.id = s.day_id
      where s.id = old.session_id and d.confirmed_at is not null
      for share of d;
    if found then
      raise exception 'Day % is confirmed and locked: gym entries cannot be changed or removed.', locked_date;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select d.log_date into locked_date
      from public.gym_sessions s join public.days d on d.id = s.day_id
      where s.id = new.session_id and d.confirmed_at is not null
      for share of d;
    if found then
      raise exception 'Day % is confirmed and locked: gym entries cannot be added.', locked_date;
    end if;
    return new;
  end if;
  return old;
end;
$$;

create trigger guard_gym_exercises
  before insert or update or delete on public.gym_exercises
  for each row execute function private.guard_gym_exercises();

-- Sets: find the day through exercise -> session.
create or replace function private.guard_gym_sets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_date date;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select d.log_date into locked_date
      from public.gym_exercises g
      join public.gym_sessions s on s.id = g.session_id
      join public.days d on d.id = s.day_id
      where g.id = old.entry_id and d.confirmed_at is not null
      for share of d;
    if found then
      raise exception 'Day % is confirmed and locked: gym sets cannot be changed or removed.', locked_date;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select d.log_date into locked_date
      from public.gym_exercises g
      join public.gym_sessions s on s.id = g.session_id
      join public.days d on d.id = s.day_id
      where g.id = new.entry_id and d.confirmed_at is not null
      for share of d;
    if found then
      raise exception 'Day % is confirmed and locked: gym sets cannot be added.', locked_date;
    end if;
    return new;
  end if;
  return old;
end;
$$;

create trigger guard_gym_sets
  before insert or update or delete on public.gym_sets
  for each row execute function private.guard_gym_sets();

create trigger block_truncate_gym_sessions  before truncate on public.gym_sessions  for each statement execute function private.block_truncate();
create trigger block_truncate_gym_exercises before truncate on public.gym_exercises for each statement execute function private.block_truncate();
create trigger block_truncate_gym_sets      before truncate on public.gym_sets      for each statement execute function private.block_truncate();

revoke all on all functions in schema private from public, anon, authenticated;

-- ---------- Save a whole session in one go (all or nothing) ----------
-- Runs with the caller's own permissions, so owner-only rules and the lock apply.
-- p_exercises: [{"exercise_id": "...", "note": "..." | null, "sets": [{"reps": 10, "weight_kg": 40}, ...]}, ...]
create or replace function public.save_gym_session(
  p_day_id uuid, p_start_time time, p_muscle_groups text[], p_exercises jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_entry_id   uuid;
  ex         jsonb;
  st         jsonb;
  ex_count   int := 0;
  set_count  int;
begin
  if p_exercises is null or jsonb_typeof(p_exercises) <> 'array' or jsonb_array_length(p_exercises) = 0 then
    raise exception 'Add at least one exercise.';
  end if;

  insert into public.gym_sessions (day_id, start_time, muscle_groups)
    values (p_day_id, p_start_time, p_muscle_groups)
    on conflict (day_id) do update set start_time = excluded.start_time, muscle_groups = excluded.muscle_groups
    returning id into v_session_id;

  delete from public.gym_exercises g where g.session_id = v_session_id;

  for ex in select value from jsonb_array_elements(p_exercises) loop
    ex_count := ex_count + 1;
    insert into public.gym_exercises (session_id, exercise_id, position, note)
      values (v_session_id, (ex->>'exercise_id')::uuid, ex_count, nullif(btrim(ex->>'note'), ''))
      returning id into v_entry_id;
    set_count := 0;
    for st in select value from jsonb_array_elements(coalesce(ex->'sets', '[]'::jsonb)) loop
      set_count := set_count + 1;
      insert into public.gym_sets (entry_id, set_number, reps, weight_kg)
        values (v_entry_id, set_count, (st->>'reps')::smallint, (st->>'weight_kg')::numeric);
    end loop;
    if set_count = 0 then
      raise exception 'Each exercise needs at least one set.';
    end if;
  end loop;

  return v_session_id;
end;
$$;

-- Only the logged-in owner may call it; never logged-out visitors.
revoke all on function public.save_gym_session(uuid, time, text[], jsonb) from public, anon;
grant execute on function public.save_gym_session(uuid, time, text[], jsonb) to authenticated;
