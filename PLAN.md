# Health Tracker: Plan and Decisions (Version 1)

A personal daily health-habit tracker. Phone-first web app, installable on Android (PWA).

## Hard rules

1. The code is public. Personal data (weight, food, labs) is never stored in this repository. It lives only in a private Supabase database.
2. Secrets are never committed. Real settings live in Vercel environment variables. `.env.example` holds names only.
3. Free tiers only: Supabase (database + login) and Vercel (hosting).
4. Only the owner can log in and edit. New sign-ups are disabled. Read-only share links are available for viewers.
5. Each day stays editable until the owner presses **Confirm**. After that, the day is locked forever and only new notes can be added.
   The lock is enforced inside the database (row-level security + triggers), not just in the app.

## Time zone

All date logic uses **Asia/Kolkata** (UTC+5:30): what "today" is, day boundaries, and blocking confirmation of future days.
The database works out "today" with its own clock, not the phone's.

## Units

- Body weight: kg, 1 decimal
- Food weight: g
- Fluids: ml

## Daily log fields

**Body**
- Morning weight (kg)

**Food** (many items per day)
- Meal: Wake-up, Breakfast, Lunch, Snack, Dinner, Pre-sleep, Other
- Food name, weight (g)
- Weight state: raw or cooked (required)
- Calories (required); protein, carbs, fat (optional: blank means unknown)
- Fibre: total, plus optional soluble and insoluble. Blank means unknown. Never estimated.
- Hunger add-on (y/n). Stays within the meal it followed.
- Data source (optional): label, IFCT, USDA, research, other
- Running daily kcal vs a 2,000 kcal cap. Warning only. Drink kcal is included.

**Fluids** (many entries per day)
- Time, type, ml
- Types: water, lemonade (stevia), lassi, maad water, black coffee, green tea, milk, sugary drink, other
- Optional kcal field: maad water, sugary drink, other. These kcal count toward the 2,000 kcal total.
- No kcal field: lemonade, lassi, black coffee, green tea, milk. Milk and lassi are already logged as food.
- Green tea with added sugar or honey is logged as "sugary drink".
- All fluids count toward the 4 L target. Sugary drinks are also shown as a separate total. Maad water is not sugary.

**Sleep** (logged on the wake-up date)
- Bedtime, wake time (exact clock times)
- Duration is calculated automatically and handles crossing midnight. Same bedtime and wake time is an error.
- Quality 1–5
- Snoring y/n, gasping y/n
- Afternoon sleepiness y/n
- Nap minutes

**Workout**
- Steps
- Cardio sessions (many per day): type, minutes, start time (exact clock time)
- Cardio types: Walk, Brisk walk, Run, Cycle, Swim, Skipping, Stairs, Other

**Stress and habits**
- Stress 1–10, energy 1–10
- Resting pulse (bpm)
- Gaming hours
- Porn y/n, Naam Jaap y/n
- Junk meals (a count)

**Confirm**
- Locks the day. Notes can be added afterwards but never edited or deleted.

## Share page (read-only, confirmed days only)

- **Shown:** weight, food totals (including drink kcal), fluid totals (water / sugary / total vs 4 L), steps, cardio, sleep times, junk meals.
- **Hidden:** porn, gaming hours, snoring, gasping, stress, energy, pulse, notes, sleep quality, nap minutes, afternoon sleepiness, Naam Jaap.
- Fields not listed are hidden by default.

## Database

- Setup file: `supabase/migrations/001_init.sql` (run once in the Supabase SQL Editor).
- Attack tests: `supabase/tests/` (run only on a local throwaway database, never in Supabase).
- Live check: `supabase/live_check.sql` (safe to run in Supabase: one transaction ending in ROLLBACK; nothing is saved).

## Not in version 1

Food database, charts, gym log, points/rank system, lab results, reminders, offline saving.

## Build steps

1. Accounts (Supabase, Vercel): done
2. Empty app live on Vercel: done
3. Database tables + security rules: done
4. Login (owner only)
5. Day screen: body, sleep, stress, steps
6. Food log + kcal bar
7. Fluids + cardio
8. Confirm & lock + notes
9. Share links + read-only page
10. PWA install + data export
11. Security check, go live
