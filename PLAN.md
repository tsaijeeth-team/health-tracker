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
- **Missed confirm (−20 points):** a day counts as missed if it is not confirmed by 23:59 India time on the
  7th day after it. Example: 5 Oct must be confirmed by 12 Oct, 23:59 IST.
- A logged gym session earns +10 points (see step 12).
- The "earlier days not confirmed" notice already follows this rule: "last day to confirm" on the 7th day after,
  "over 7 days" from the 8th day (India time).

## Look & colours

- Main colour: deep red #B91C1C. Used for the top bar, primary buttons, selected options, the app icon ("HT" on red).
- In dark mode, red buttons get a light-red outline (#F87171) so they stand out from the dark page.
- Status colours keep their meaning and never look like the main colour:
  - Calorie and 4 L bars: green → amber → red.
  - Errors: ⚠ sign + pale-red box with a thick left border. Warnings: ⚠ sign + amber box or pill.
  - Success ("Saved ✓", "Last export: today", Confirmed): green.
  - Delete / switch-off buttons: outlined pale-red, never filled like the main buttons.
- Every text/background pair checked for contrast (WCAG: 4.5:1 for text, 3:1 for buttons) in light and dark mode.

## Install & backup

- Installable on Android (Chrome menu → Install app). Opens full screen with the red "HT" icon.
- Opens without internet; a ⚠ banner says changes can't be saved offline. Health data is never stored on the phone
  by the app's offline helper; database requests always go to the internet.
- "Share & backup" screen: Full backup (.json, everything incl. notes, no share-link secrets) and Daily summary
  (.csv, one row per day, blanks stay blank). Files stay on the device. Reads all rows in pages of 1,000.
- "Last export: N days ago" (remembered per device), amber ⚠ after 7 days or if never exported on this device.

## Security (step 11)

- Secret scan of the entire git history: no keys, passwords or tokens ever committed; `.env.example` never had values.
- `npm audit`: 0 known vulnerabilities (re-run before each release).
- No risky code patterns (no raw HTML injection, no eval, no logging of data).
- Server headers (vercel.json) on every page: Content-Security-Policy (only this site's code; data only to this
  Supabase project; no eval; no framing), X-Robots-Tag noindex, Referrer-Policy no-referrer, X-Frame-Options DENY,
  X-Content-Type-Options nosniff, Permissions-Policy (no camera/mic/location/payment/usb), HSTS.
- CSP tested: all browser test suites pass with zero violations; injected code, foreign scripts and sending data to
  other sites are blocked and reported.
- Live check (`supabase/live_check.sql`, 34 checks, rollback only) includes a read-only security audit of the real
  database: every table has owner-only rules, visitors can reach no table, visitors can call only
  `get_shared_progress`, private helpers unreachable, privileged functions have a fixed search path.
- Known, accepted limits: the share token appears in Vercel's request logs (only the owner's Vercel account sees them);
  the database owner can still change rules in the Supabase dashboard; export files are unencrypted health data and
  must be kept private.

## Share page (read-only, confirmed days only)

- **Shown:** weight, food totals (including drink kcal), fluid totals (water / sugary / total vs 4 L), steps, cardio, sleep times, junk meals.
- **Hidden:** porn, gaming hours, snoring, gasping, stress, energy, pulse, notes, sleep quality, nap minutes, afternoon sleepiness, Naam Jaap.
- Fields not listed are hidden by default.
- Food totals = kcal (food + drinks), protein, carbs, fat, fibre ("at least … (n unknown)"). Individual food items hidden.
- Cardio = type, minutes, start time and the "Other" description. Sleep = bedtime, wake time, duration.
- All confirmed days, newest first.
- Links: label (only the owner sees it), expiry Never / 7 days / 30 days, Copy, Preview, Switch off.
  Switching off is immediate and permanent (the database refuses re-activation). Tokens never change.
- A bad, expired or switched-off link shows the same "This link is not valid" message.
- The database function `get_shared_progress(token)` is the only thing a viewer can call; it returns an
  allow-list of fields for confirmed days of the link's owner (migration 004).
- Search engines are told not to index any page: `noindex` meta tag plus an `X-Robots-Tag` header on every
  page (vercel.json). Pages also send no referrer.
- **Later (points step):** add the owner's current rank to the share page.

## Database

- Setup files, each run once in the Supabase SQL Editor, in order:
  - `supabase/migrations/001_init.sql`
  - `supabase/migrations/002_fibre_sum.sql`
  - `supabase/migrations/003_other_descriptions.sql`
  - `supabase/migrations/004_share_function.sql`
- Attack tests: `supabase/tests/` (run only on a local throwaway database, never in Supabase).
- Live check: `supabase/live_check.sql` (safe to run in Supabase: one transaction ending in ROLLBACK; nothing is saved).

## Step 12: Gym log + progressive overload graph (must be live by 18 Oct 2026)

The owner joins the gym on 19 Oct 2026, so this step must be merged and live by 18 Oct.

**Gym session**
- Date, start time
- Muscle groups (multi-select): chest, back, shoulders, arms, legs, core

**Exercises**
- Picked from a saved exercise list the owner can add to. No free-text duplicates
  (e.g. "Bench press" and "bench press " count as the same exercise).
- Each exercise in a session: sets, each with reps and weight (kg), plus an optional note per exercise.

**Graph per exercise over time**
- Top-set weight
- Total volume = sum of sets × reps × weight
- Estimated 1-rep max

**Points:** a logged gym session earns +10 points (points step).

**Decisions (owner, 5 Oct 2026):**
1. **Estimated 1-rep max (e1RM):** Epley, weight × (1 + reps ÷ 30), using only sets with ≤ 10 reps.
   A 1-rep set's e1RM is the weight lifted. The session's e1RM is the highest value among its eligible sets.
   - If every set in a session has more than 10 reps, that session has no e1RM point (the e1RM graph shows a gap);
     top set and volume are still shown for that session. (Confirmed by owner.)
   - 0 kg (bodyweight) sets give no e1RM; they show total reps only. (Confirmed by owner.)
2. **Top set:** the heaviest weight in the session; if tied, the set with more reps.
3. **Bodyweight exercises:** 0 kg is allowed; their graph also shows total reps per session.
4. **Locking:** a gym session locks when its day is confirmed (same as food, drinks and cardio).

## Not in version 1

Food database, charts (except the gym graph in step 12), points/rank system, lab results, reminders, offline saving.

## Build steps

1. Accounts (Supabase, Vercel): done
2. Empty app live on Vercel: done
3. Database tables + security rules: done
4. Login (owner only): done
5. Day screen: body, sleep, stress, steps: done
6. Food log + kcal bar: done
7. Fluids + cardio: done
8. Confirm & lock + notes: done
9. Share links + read-only page: done
10. PWA install + data export: done
11. Security check, go live
12. Gym log + progressive overload graph (live by 18 Oct 2026)
