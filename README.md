# Dire Mall Rentals

Rental management for Dire Mall: buildings and units, renters, agreements, monthly billing,
payments and deposits, utilities and shared costs, arrears, bank statement matching, SMS reminders,
reports. English and Amharic, Gregorian and Ethiopian calendars.

Stack: Next.js (App Router) + Convex (database, functions, auth, file storage, scheduled jobs).

## Run locally

```bash
npm install
npx convex dev          # first run links a Convex project and writes .env.local
npm run dev             # http://localhost:3000
npm test                # domain rules + end-to-end backend tests (no network needed)
```

### One-time Convex auth setup

Convex Auth needs a signing key and the site URL on the deployment:

```bash
npx @convex-dev/auth    # sets JWT_PRIVATE_KEY, JWKS and SITE_URL
```

The first account to sign up becomes super admin. Later sign-ups are inactive until an access admin
enables them under Staff access.

### SMS

Set these on the Convex deployment to send messages (otherwise they stay queued):
`SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER`, and `SMS_WEBHOOK_SECRET` for delivery receipts posted to
`<convex-site-url>/sms/delivery`.

## Layout

- `convex/schema.ts` data model. Money is integer santim.
- `convex/lib/` billing, allocation, calendar and access rules (unit-tested).
- `convex/*.ts` queries and mutations, one file per area. Every function checks role and building scope.
- `src/app/(app)/` screens. `src/lib/dictionary.ts` English/Amharic text.
- `docs/SPEC.md` scope and acceptance examples.

## Rules enforced by the backend

- Whoever prepares an agreement, correction, shared cost, meter reading or deposit deduction cannot approve it.
- Issued bills never change; corrections are approved adjustments with a reason.
- A payment reduces a bill only after it is recorded, confirmed by someone else, then applied.
- Re-running billing never creates a second original bill for the same agreement and period.
- Deposits are a separate ledger. Bank matching links evidence and never adds money.
