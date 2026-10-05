-- =====================================================================
-- Health Tracker: database change 005 (food units)
--
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- Food can now be entered as an amount + unit: g, mg, ml, piece, tsp, tbsp.
--   amount          what you typed, e.g. 2 (max 2 decimals)
--   unit            g / mg / ml / piece / tsp / tbsp
--   grams_per_unit  only for ml, piece, tsp, tbsp, e.g. 50 g per piece
-- weight_g stays the main number (totals, recent-food scaling, share page).
-- The DATABASE calculates it: weight_g = amount x grams per unit
-- (mg: amount / 1000; g: amount). No rounding at all, so 3 x 33.33 is
-- exactly 99.99. Whatever weight the app sends is replaced.
--
-- Old entries are NOT rewritten (that would break the lock on confirmed
-- days). They keep amount/unit blank and simply count as grams.
-- The existing confirm-lock covers these new columns automatically.
-- =====================================================================

alter table public.food_items
  add column amount          numeric check (amount > 0 and amount <= 5000000 and amount = round(amount, 2)),
  add column unit            text    check (unit in ('g', 'mg', 'ml', 'piece', 'tsp', 'tbsp')),
  add column grams_per_unit  numeric check (grams_per_unit > 0 and grams_per_unit <= 1000 and grams_per_unit = round(grams_per_unit, 2));

alter table public.food_items
  -- Old rows: all three blank. New rows: amount and unit together.
  add constraint food_amount_and_unit_together check ((amount is null) = (unit is null)),
  -- g and mg never take grams per unit; ml, piece, tsp, tbsp always do.
  add constraint food_grams_per_unit_rule check (
    case when unit in ('ml', 'piece', 'tsp', 'tbsp') then grams_per_unit is not null
         else grams_per_unit is null end
  );

-- Fills weight_g from amount + unit on every insert and update.
-- Rows without an amount (old entries, or an older cached app) keep the weight they were given.
create or replace function private.food_weight_from_units()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Incomplete input (e.g. piece without grams per unit) is left alone,
  -- so the named rule above refuses it with a clear message.
  if new.amount is not null and (new.unit in ('g', 'mg') or new.grams_per_unit is not null) then
    new.weight_g := case new.unit
      when 'g'  then new.amount
      when 'mg' then new.amount / 1000
      else new.amount * new.grams_per_unit
    end;
  end if;
  return new;
end;
$$;

create trigger food_weight_from_units
  before insert or update on public.food_items
  for each row execute function private.food_weight_from_units();

revoke all on all functions in schema private from public, anon, authenticated;
