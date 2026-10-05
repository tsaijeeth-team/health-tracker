-- =====================================================================
-- Health Tracker: database change for build step 7
--
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- Adds an optional short description for drink type "Other" and cardio
-- type "Other" (e.g. "coconut water", "badminton").
-- Rules: only allowed when the type is "other"; 1-100 characters; blank
-- is stored as empty (null). The confirm-lock rules apply automatically.
-- =====================================================================

alter table public.fluids
  add column description text,
  add constraint fluids_description_only_for_other check (
    description is null
    or (drink_type = 'other' and length(btrim(description)) between 1 and 100)
  );

alter table public.cardio_sessions
  add column description text,
  add constraint cardio_description_only_for_other check (
    description is null
    or (cardio_type = 'other' and length(btrim(description)) between 1 and 100)
  );
