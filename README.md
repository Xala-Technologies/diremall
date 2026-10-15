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

## Going live

Two pieces: the Convex production deployment (data and functions) and the website host (Vercel).

1. **Convex production.** In the Convex dashboard open the project, switch to *Production*, and create a
   production deploy key (Settings, URL & Deploy Key). Keep it secret; it can change production data.
2. **Website.** In Vercel, import this GitHub repository. Add one environment variable,
   `CONVEX_DEPLOY_KEY` (the production key). The included `vercel.json` makes each deploy push the Convex
   functions and then build the site, and Convex fills in `NEXT_PUBLIC_CONVEX_URL` itself.
3. **Sign-in keys and address.** Once the site has an address, run this yourself while signed in to Convex:

   ```bash
   node scripts/setup-prod-auth.mjs https://your-site-address first-admin@your-company.com
   ```

   It sets the signing keys, `SITE_URL`, and `BOOTSTRAP_ADMIN_EMAIL` so only that address can become
   the first super admin. Use `--print` first to see what it would set.
4. **SMS** (when a provider is chosen): set `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER` and
   `SMS_WEBHOOK_SECRET` on production with `npx convex env set --prod`.
5. **Do not** run `seed:load` on production. It is demo data for the development deployment only.
6. Sign up with the admin email, then add staff under Staff access.

## Data migrations

Bills store their running balance (see `convex/lib/ledger.ts`). After deploying to a deployment that already
has bills created before that change, run once: `npx convex run migrations:backfillInvoices` (add `--prod`
for production). It is safe to run again. A fresh production deployment does not need it.

## Load testing

`convex/loadtest.ts` fills a **development** deployment with a mall-sized data set (about 1,000 units, renters and
leases with 12 months of bills) and removes it again. Everything it creates is tagged "LT".

```bash
npx convex run loadtest:seed     # about 25 seconds
npx convex run loadtest:clear    # about 2 minutes
```

Convex allows 4,096 database lookups per function, so screens must never look up a related record once per row.
Read the whole related table once and use a map (see `convex/lib/bulk.ts`). Bills are issued in groups of 150.

## Two-step sign-in (2FA)

Authenticator-app codes (TOTP, RFC 6238) plus eight one-time recovery codes. Anyone can turn it on under **Settings → Two-step sign-in**. An access admin can switch on **Require for finance, approvers and admins** (only after enrolling themselves), and can reset a colleague who lost their phone from **Staff access**.

- Each new sign-in must pass the second step; until then the server rejects every request (`mfa_required`).
- A code can be used once; five wrong codes lock the second step for five minutes.
- Enrolling, disabling, recovery-code use and resets are written to the audit log.
