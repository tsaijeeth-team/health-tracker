-- =====================================================================
-- Health Tracker: database change for build step 6
--
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- Adds one rule: soluble + insoluble fibre cannot be more than total fibre.
-- (001_init.sql already checks each part on its own against the total.)
-- A blank part counts as 0 for this rule. If total fibre is blank, the
-- rule does not apply.
-- =====================================================================

alter table public.food_items
  add constraint fibre_parts_within_total check (
    fibre_total_g is null
    or coalesce(fibre_soluble_g, 0) + coalesce(fibre_insoluble_g, 0) <= fibre_total_g
  );
