# Moving from the old records to the system

How to bring Dire Mall's existing buildings, renters, leases and unpaid balances in, and prove the numbers match.

## Before you start
1. Take a backup of the deployment you are loading into (`node scripts/backup.mjs`, see `docs/BACKUP.md`). If something
   goes wrong you can restore.
2. Collect the old records in spreadsheets: units, renters, current and past leases, and what each renter owes today.
3. Decide the **go-live date**: the day the old books stop and the system takes over. Get the arrears list as at the end
   of the day before. Nobody should record new payments in the old books after that.
4. An **approver** must run the last two imports (leases and opening balances). They bypass the normal review, so they are
   limited to approvers and every row is recorded in History.

## The order matters
Each step needs the one before it. In the app: **Import data**, then the tab named below. Every tab has a *Download a
template* button with example rows, and every file is checked in full before anything is saved. If a single row has a
problem, nothing is saved and each problem is listed by row.

| Step | Tab | What it needs | What you get |
|---|---|---|---|
| 1 | Units | building, floor, unit, area, category, rate | the buildings, floors and units |
| 2 | Renters | name, TIN (company) or ID number (individual), phone | the renter register |
| 3 | Agreements | unit, renter, start, end, rent, deposit | current **and past** leases, with deposits |
| 4 | Opening balances | renter, amount owed, original due date | unpaid rent as bills, prepayments as credit |

### Step 3, agreements
- One row per lease. Name the renter by **TIN** (exact) or by name. If two renters share a name, use the TIN. If the same
  unit number exists in two buildings, fill in the building column.
- Dates can be written 2025-09-01 or 01/09/2025 (day first). Rent basis is *per m2* (the amount is the rate per m²) or
  *fixed* (the amount is the monthly rent). Due day is 1 to 28 (5 if left empty).
- *Deposit* is what the lease requires; *deposit paid* is what the mall actually holds today. Leave *deposit paid* empty
  if it was paid in full.
- Yearly increase and "every (months)" are optional and match the lease's escalation clause.
- A lease whose end date has passed is saved as **expired**; all others as **active**. Units are marked occupied from the
  start date of an active lease.
- Leases on the same unit must not overlap. Import past leases too if a renter still owes money from one (step 4 needs a
  lease to attach the balance to).
- The old signed contract can be attached later, once, from the agreement page, even though the lease is already active.

### Step 4, opening balances
- One row per unpaid bill: renter, amount, and the **original due date** (so arrears ageing is correct from the first day).
  A row without a due date takes the go-live date.
- A **negative** amount is money the renter paid in advance; it becomes credit on their account.
- If a renter has leases on several units, fill in the unit column.
- Each amount owed becomes an issued bill numbered `OPEN-00001`, `OPEN-00002`… with the period "Opening balance". Find
  them in **Bills → Opening balance**. They can be paid, and reminded, like any bill. They do not count as revenue of any
  month and do not stop the real monthly bill from being prepared.
- A file can safely be run twice: bills and credits that are already in are recognised and refused.

Files over 150 rows are saved in groups. If a group fails, the earlier groups stay saved and the screen says how many;
choose the same file again and the saved rows are skipped.

## Proving the numbers
After step 4, compare with the old books:
1. **Reports → Arrears ageing**: the total and each renter's balance should equal the old arrears list.
2. **Reports → Rent roll**: units, renters and monthly rent should equal the old rent roll.
3. **Overview → Deposits held** should equal the old deposit ledger.
4. Open three or four renters at random and check their statement.
Fix differences with a corrected file or, for a single bill, a normal correction (an approver approves it).

## What is not carried over
- **Payment history.** Only the balance as at go-live comes in, not the individual old payments.
- **Meter readings.** Enter each meter's first reading in **Utilities**; later bills use the difference.
- **Scanned contracts and renter documents.** Attach them from the agreement and renter pages.
- **Contract text and notes** that do not fit a column.

## On go-live day
1. Backup. 2. Run steps 1 to 4 (or only 3 and 4 if units and renters were loaded earlier). 3. Prove the numbers.
4. Turn on two-step sign-in for finance staff and approvers. 5. Fill in Settings → Organisation. 6. From now on record every
payment in the system, and do not use the old books.
