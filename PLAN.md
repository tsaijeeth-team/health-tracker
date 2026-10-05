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

## Day screen behaviour

- Opens on today (India time). ◀ ▶ arrows, a date picker and "Go to today".
- One **Save** button per day, with "Unsaved changes" / "Saved ✓" status.
- Warns before switching days, logging out or leaving the page with unsaved changes.
- Yes/no questions have three answers: Yes / No / Not answered. Blank is stored as "not answered", never as No.
- Scores (1–5, 1–10) are tap buttons; tapping the selected number again clears it.
- Number fields: blank = not answered (stored empty), never 0. Junk meals 0 means zero junk meals.
- The app checks values with the same limits as the database before saving.

## Food log behaviour

- Each food saves as soon as you tap Add or Update. Delete asks first.
- Totals never treat unknown as 0: "at least 54 g (2 items unknown)".
- Calorie bar: green below 1,800, amber 1,800–2,000, red above 2,000 (warning only).
- Hunger add-ons are tagged and have their own kcal subtotal.
- Recent foods: pick a food logged before (newest entry per food + raw/cooked), enter grams,
  and every value scales from that last entry. kcal rounds to whole numbers, others to 1 decimal.
  Unknown stays unknown. Changing a value by hand stops automatic scaling.
- Fibre: soluble + insoluble cannot exceed total (checked in the app and in the database).

## Fluids & cardio behaviour

- "+ Add drink" opens the form with type Water and the current India time pre-selected,
  and the cursor in the ml box (number keypad on phones). One tap on Add (or Enter) saves.
- No quick-add buttons and no Undo message (removed at the owner's request).
- New drinks and cardio sessions default to the current India time (editable).
- 4 L bar counts all drinks; sugary drinks also shown as their own total.
- Drink kcal (maad water, sugary drink, other) is added to the 2,000 kcal bar. A blank kcal on those types is "unknown".
- Drink type "Other" and cardio type "Other" have an optional description (max 100 characters).
- Drinks and cardio save as soon as you tap Add or Update, like food.

## Confirm & notes behaviour

- "Confirm day…" (today or past days only) opens a full summary of the day, lists every field left
  blank ("not answered"), and warns if it is still today. Buttons: "Go back" / "Confirm & lock forever".
- Confirming is blocked while anything is unsaved. Blank fields are allowed (they stay blank forever).
- The confirm time comes from the database clock and is shown in India time ("🔒 Confirmed 5 Oct 2026, 22:14").
- Notes can be added on any day, including locked days, and can never be edited or deleted.
- Notice at the top: "N earlier days not confirmed", newest first, with links. It counts every date from the
  first logged day up to yesterday that is not confirmed, including dates with nothing logged.
  Each shows "X days left" in a 7-day window; overdue days are red.

## Points system (later step, not built yet)

- **Clean day** = junk meals = 0 AND porn = No AND gaming ≤ 2 h. If any of the three is blank, the day is not clean.
- A day not confirmed within 7 days is penalised.
- **Open question:** exact 7-day boundary. The notice currently treats a day as "last day to confirm" when it is
  7 days old and overdue from 8 days old. Confirm or correct this before building points.

## Share page (read-only, confirmed days only)

- **Shown:** weight, food totals (including drink kcal), fluid totals (water / sugary / total vs 4 L), steps, cardio, sleep times, junk meals.
- **Hidden:** porn, gaming hours, snoring, gasping, stress, energy, pulse, notes, sleep quality, nap minutes, afternoon sleepiness, Naam Jaap.
- Fields not listed are hidden by default.

## Database

- Setup files, each run once in the Supabase SQL Editor, in order:
  - `supabase/migrations/001_init.sql`
  - `supabase/migrations/002_fibre_sum.sql`
  - `supabase/migrations/003_other_descriptions.sql`
- Attack tests: `supabase/tests/` (run only on a local throwaway database, never in Supabase).
- Live check: `supabase/live_check.sql` (safe to run in Supabase: one transaction ending in ROLLBACK; nothing is saved).

## Not in version 1

Food database, charts, gym log, points/rank system, lab results, reminders, offline saving.

## Build steps

1. Accounts (Supabase, Vercel): done
2. Empty app live on Vercel: done
3. Database tables + security rules: done
4. Login (owner only): done
5. Day screen: body, sleep, stress, steps: done
6. Food log + kcal bar: done
7. Fluids + cardio: done
8. Confirm & lock + notes
9. Share links + read-only page
10. PWA install + data export
11. Security check, go live
