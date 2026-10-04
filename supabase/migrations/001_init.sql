-- =====================================================================
-- Health Tracker: database setup (build step 3)
--
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- Contains structure and rules only. No personal data.
--
-- What it does:
--   1. Creates the tables.
--   2. Owner-only access (row level security): only the logged-in owner
--      can read or write rows. Logged-out visitors get nothing.
--   3. Confirm-lock: once a day is confirmed, nothing about it can change.
--      Notes can be added but never edited or deleted.
--   4. Data checks that reject impossible values.
--   "Today" is always worked out in Asia/Kolkata time.
-- =====================================================================

-- Helper functions live in a private schema that the website cannot call.
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- "Today" in India time
-- ---------------------------------------------------------------------
create or replace function private.today_ist()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- One row per date: everything that happens once a day.
create table public.days (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date              date not null,

  -- Body
  weight_kg             numeric check (weight_kg > 0 and weight_kg < 400 and weight_kg = round(weight_kg, 1)),

  -- Sleep (logged on the wake-up date)
  bedtime               time,
  wake_time             time,
  sleep_minutes         integer generated always as (
                          case
                            when bedtime is null or wake_time is null then null
                            else (extract(epoch from (wake_time - bedtime)) / 60)::integer
                                 + case when wake_time < bedtime then 1440 else 0 end
                          end
                        ) stored,
  sleep_quality         smallint check (sleep_quality between 1 and 5),
  snoring               boolean,
  gasping               boolean,
  afternoon_sleepiness  boolean,
  nap_minutes           smallint check (nap_minutes between 0 and 720),

  -- Workout
  steps                 integer check (steps between 0 and 200000),

  -- Stress and habits
  stress                smallint check (stress between 1 and 10),
  energy                smallint check (energy between 1 and 10),
  resting_pulse         smallint check (resting_pulse between 25 and 250),
  gaming_hours          numeric check (gaming_hours between 0 and 24 and gaming_hours = round(gaming_hours, 2)),
  porn                  boolean,
  naam_jaap             boolean,
  junk_meals            smallint check (junk_meals between 0 and 20),

  -- Lock: empty = editable; set = confirmed and locked forever.
  confirmed_at          timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (user_id, log_date),
  constraint bedtime_differs_from_wake_time check (bedtime is null or wake_time is null or bedtime <> wake_time)
);

-- Many rows per day: each food eaten.
create table public.food_items (
  id                 uuid primary key default gen_random_uuid(),
  day_id             uuid not null references public.days (id) on delete cascade,
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  meal               text not null check (meal in ('wake_up', 'breakfast', 'lunch', 'snack', 'dinner', 'pre_sleep', 'other')),
  food               text not null check (length(btrim(food)) between 1 and 200),
  weight_g           numeric not null check (weight_g > 0 and weight_g <= 5000),
  weight_state       text not null check (weight_state in ('raw', 'cooked')),
  kcal               numeric not null check (kcal >= 0 and kcal <= 10000),
  protein_g          numeric check (protein_g >= 0 and protein_g <= 1000),
  carbs_g            numeric check (carbs_g >= 0 and carbs_g <= 1000),
  fat_g              numeric check (fat_g >= 0 and fat_g <= 1000),
  -- Fibre: blank = unknown. Never estimated.
  fibre_total_g      numeric check (fibre_total_g >= 0 and fibre_total_g <= 500),
  fibre_soluble_g    numeric check (fibre_soluble_g >= 0 and fibre_soluble_g <= 500),
  fibre_insoluble_g  numeric check (fibre_insoluble_g >= 0 and fibre_insoluble_g <= 500),
  is_hunger_addon    boolean not null default false,
  data_source        text check (data_source in ('label', 'ifct', 'usda', 'research', 'other')),
  created_at         timestamptz not null default now(),

  constraint soluble_within_total check (fibre_total_g is null or fibre_soluble_g is null or fibre_soluble_g <= fibre_total_g),
  constraint insoluble_within_total check (fibre_total_g is null or fibre_insoluble_g is null or fibre_insoluble_g <= fibre_total_g)
);

-- Many rows per day: each drink.
create table public.fluids (
  id          uuid primary key default gen_random_uuid(),
  day_id      uuid not null references public.days (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  drink_time  time not null,
  drink_type  text not null check (drink_type in (
                'water', 'lemonade_stevia', 'lassi', 'maad_water', 'black_coffee',
                'green_tea', 'milk', 'sugary_drink', 'other')),
  ml          integer not null check (ml > 0 and ml <= 5000),
  -- Only maad water, sugary drinks and "other" may carry kcal.
  kcal        numeric check (kcal >= 0 and kcal <= 5000),
  is_sugary   boolean generated always as (drink_type = 'sugary_drink') stored,
  created_at  timestamptz not null default now(),

  constraint kcal_only_for_allowed_drinks check (kcal is null or drink_type in ('maad_water', 'sugary_drink', 'other'))
);

-- Many rows per day: each cardio session.
create table public.cardio_sessions (
  id           uuid primary key default gen_random_uuid(),
  day_id       uuid not null references public.days (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cardio_type  text not null check (cardio_type in (
                 'walk', 'brisk_walk', 'run', 'cycle', 'swim', 'skipping', 'stairs', 'other')),
  minutes      integer not null check (minutes > 0 and minutes <= 1440),
  start_time   time not null,
  created_at   timestamptz not null default now()
);

-- Notes: can be added at any time, even to a locked day. Never edited or deleted.
create table public.day_notes (
  id          uuid primary key default gen_random_uuid(),
  day_id      uuid not null references public.days (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body        text not null check (length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);

-- Read-only share links. The viewer page itself is added in build step 9.
create table public.share_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- 64 random hex characters: practically impossible to guess.
  token       text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  label       text check (length(label) <= 100),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index food_items_day_id_idx      on public.food_items (day_id);
create index fluids_day_id_idx          on public.fluids (day_id);
create index cardio_sessions_day_id_idx on public.cardio_sessions (day_id);
create index day_notes_day_id_idx       on public.day_notes (day_id);
create index share_links_user_id_idx    on public.share_links (user_id);

-- ---------------------------------------------------------------------
-- 2. Owner-only access (row level security)
-- ---------------------------------------------------------------------

alter table public.days            enable row level security;
alter table public.food_items      enable row level security;
alter table public.fluids          enable row level security;
alter table public.cardio_sessions enable row level security;
alter table public.day_notes       enable row level security;
alter table public.share_links     enable row level security;

-- Start from zero permissions, then grant only what the app needs.
revoke all on public.days, public.food_items, public.fluids, public.cardio_sessions,
              public.day_notes, public.share_links
  from anon, authenticated;

grant select, insert, update, delete on public.days, public.food_items, public.fluids,
                                        public.cardio_sessions, public.share_links
  to authenticated;
-- Notes: add and read only.
grant select, insert on public.day_notes to authenticated;

create policy "owner manages own days" on public.days
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner manages own food" on public.food_items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.days d where d.id = day_id and d.user_id = (select auth.uid()))
  );

create policy "owner manages own fluids" on public.fluids
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.days d where d.id = day_id and d.user_id = (select auth.uid()))
  );

create policy "owner manages own cardio" on public.cardio_sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.days d where d.id = day_id and d.user_id = (select auth.uid()))
  );

create policy "owner reads own notes" on public.day_notes
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "owner adds own notes" on public.day_notes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.days d where d.id = day_id and d.user_id = (select auth.uid()))
  );

create policy "owner manages own share links" on public.share_links
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 3. Confirm-lock (runs inside the database on every change)
-- ---------------------------------------------------------------------

-- Rules for the days table.
create or replace function private.guard_days()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.confirmed_at is not null then
      raise exception 'Day % is confirmed and locked: it cannot be deleted.', old.log_date;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.confirmed_at is not null then
      raise exception 'A day must be saved before it can be confirmed.';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.confirmed_at is not null then
    raise exception 'Day % is confirmed and locked: values cannot be changed.', old.log_date;
  end if;
  if new.user_id <> old.user_id then
    raise exception 'A day cannot be moved to another user.';
  end if;
  if new.confirmed_at is not null then
    if new.log_date > private.today_ist() then
      raise exception 'Day % is in the future (India time) and cannot be confirmed yet.', new.log_date;
    end if;
    new.confirmed_at := now();  -- server clock, cannot be faked by the phone
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_days
  before insert or update or delete on public.days
  for each row execute function private.guard_days();

-- Rules for food, fluids and cardio: no change of any kind on a locked day.
create or replace function private.guard_day_children()
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
      from public.days d
      where d.id = old.day_id and d.confirmed_at is not null
      for share;
    if found then
      raise exception 'Day % is confirmed and locked: entries cannot be changed or removed.', locked_date;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select d.log_date into locked_date
      from public.days d
      where d.id = new.day_id and d.confirmed_at is not null
      for share;
    if found then
      raise exception 'Day % is confirmed and locked: entries cannot be added.', locked_date;
    end if;
    return new;
  end if;

  return old;
end;
$$;

create trigger guard_food_items
  before insert or update or delete on public.food_items
  for each row execute function private.guard_day_children();

create trigger guard_fluids
  before insert or update or delete on public.fluids
  for each row execute function private.guard_day_children();

create trigger guard_cardio_sessions
  before insert or update or delete on public.cardio_sessions
  for each row execute function private.guard_day_children();

-- Notes are permanent once written (applies even in the Supabase dashboard).
create or replace function private.guard_day_notes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Notes are permanent: they cannot be edited or deleted.';
end;
$$;

create trigger guard_day_notes
  before update or delete on public.day_notes
  for each row execute function private.guard_day_notes();

-- Bulk-wipe protection for locked data (TRUNCATE skips row triggers).
create or replace function private.block_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Bulk deletion is disabled on this table.';
end;
$$;

create trigger block_truncate_days            before truncate on public.days            for each statement execute function private.block_truncate();
create trigger block_truncate_food_items      before truncate on public.food_items      for each statement execute function private.block_truncate();
create trigger block_truncate_fluids          before truncate on public.fluids          for each statement execute function private.block_truncate();
create trigger block_truncate_cardio_sessions before truncate on public.cardio_sessions for each statement execute function private.block_truncate();
create trigger block_truncate_day_notes       before truncate on public.day_notes       for each statement execute function private.block_truncate();

-- The website must never call the private helpers directly.
revoke all on all functions in schema private from public, anon, authenticated;
