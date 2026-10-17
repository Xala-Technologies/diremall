# Prompt: turn the Dire Mall app into a multi-tenant SaaS platform

Copy everything below the line into a coding AI (Claude Code, for example) opened in the root of this repository.

---

You are a principal engineer who has built and run multi-tenant B2B SaaS products. Your job has two parts, in this order:

1. **Understand this application completely**, from the code, tests and docs, and prove it with a written report.
2. **Design and implement the conversion** of this single-company app into a multi-tenant SaaS platform, in safe phases, without breaking what already works.

Do not start part 2 until part 1 is written and I have replied. Do not guess: when the code or the docs answer a question, read them; when they do not, ask me.

## The product, and the goal

The app today is a rental management system for one company: **Dire Mall** in Dire Dawa, Ethiopia. It manages buildings, floors and units, renters, leases (agreements) with approval, monthly bills, payments with a three-step check, deposits, bank statement matching, utilities (meters and shared costs), SMS reminders, reports, spreadsheet import for go-live, staff access with roles, and an audit history. It is bilingual (English and Amharic) and uses the Ethiopian calendar. Money is integer santim (1 ETB = 100 santim).

The goal: **many rental and mall companies each get their own workspace** with their own dashboard, their own users, buildings, renters, bills, settings, SMS sender and branding, and **no company can ever see or affect another company's data**. A small **platform team** (I will call the role *platform admin*) runs the whole thing: creates and suspends companies, sees usage and health across companies, supports customers, and manages plans and limits, without being able to read tenants' business data by default.

## Part 1: understand the app (read before you design)

Read, in this order, and take notes as you go:

- `README.md`, `docs/STAFF_GUIDE.md`, `docs/SECURITY.md`, `docs/MIGRATION.md`, `docs/BACKUP.md`, `docs/BRAND.md`.
- `convex/schema.ts`: every table, field and index.
- `convex/lib/access.ts`, `convex/lib/scope.ts`, `convex/lib/signup.ts`, `convex/auth.ts`, `convex/users.ts`, `convex/invites.ts`: how identity, roles, building scope, sign-up, invitations and access requests work today.
- The money flow: `convex/billing.ts`, `convex/payments.ts`, `convex/lib/ledger.ts`, `convex/lib/billing.ts`, `convex/deposits.ts`, `convex/bank.ts`, `convex/utilities.ts`, `convex/agreements.ts`, `convex/removals.ts`, `convex/imports.ts`.
- Reporting and jobs: `convex/reports.ts`, `convex/integrity.ts`, `convex/crons.ts`, `convex/smsQueue.ts`, `convex/smsSend.ts`, `convex/lib/sms.ts`, `convex/lib/smsTemplates.ts`, `convex/backup.ts`, `scripts/*`.
- The screens under `src/app/(app)/**`, `src/components/**`, `src/lib/**` (dictionary, i18n, formats).
- All tests under `tests/`. Pay special attention to `tests/scope.test.ts` (access isolation), `tests/fuzz.test.ts` (random operations plus a books health check after every step), `tests/audit.test.ts`, `tests/messages.test.ts` and `tests/i18n.test.ts`. Run `npm test` and `npx tsc --noEmit` and report the result.

### Facts I already know that matter for multi-tenancy (verify each one in the code, and correct me where I am wrong)

- There is **no tenant concept**. The only data boundary is `users.buildingScope` ("all" or a list of building ids), enforced in `canSeeBuilding`, `assertBuilding`, `assertUnitVisible` and `assertRenterVisible`.
- **Singletons and global keys:** the `organization` table holds one row (legal name, TIN, bank accounts, bill note). The `settings` table is one global key/value store (tariffs, SMS rules, MFA rule, warning days) and also holds **global counters** through `nextSeq` (`invoiceSeq:<period>`, `receiptSeq:<year>`). Bill and receipt numbers are therefore global.
- **SMS gateway credentials are environment variables** (`SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER`, `SMS_WEBHOOK_SECRET`) shared by everyone. SMS templates (`smsTemplates`) are global.
- **Many queries read whole tables** with `.collect()` and filter in code (reports, lists, `buildingOverview`, `integrity.scan`, `sendReminders`, `generate`, SMS jobs). Indexes are not prefixed by any tenant key.
- **Cron jobs** (`convex/crons.ts`) act on every row of every table.
- **Users:** one `users` row per person, with `roles` and `buildingScope` on it. Email is the sign-in identity (Convex Auth Password provider). Sign-up creates a pending access request that an access admin approves. The first account becomes super admin (`BOOTSTRAP_ADMIN_EMAIL`).
- **Files** live in Convex storage and are served through short-lived tickets after a role and building check.
- **Timezone and calendar** assumptions are Ethiopian: quiet hours and "today" use UTC+3, dates are stored as UTC midnights, the Ethiopian calendar is a display option. Currency is ETB.
- **Maker-checker rules** (the person who prepared something cannot approve it) are enforced on the server.
- **Backups** are a full-deployment export (`scripts/backup.mjs`), not per company.
- Deployment: Next.js on Vercel, one Convex deployment, one production deploy key in GitHub and Vercel secrets.

### Deliverable of part 1: a "System understanding report"

Write it to `docs/saas/01-system-understanding.md`. It must contain:

1. An **entity relationship map** (a Mermaid diagram plus a table): every table, what it belongs to, its lifecycle states, and every foreign key.
2. The **business flows** as step lists with the exact functions and roles involved: lease from draft to termination; month-end billing; payment from recorded to applied, reversed or voided; deposit receipt, deduction and refund; utilities and shared costs; bank matching; go-live import; sign-up and access requests; SMS queue and retries; deletion and archiving rules.
3. The **authorization model**: every role, what it may do, where it is checked, and the building-scope rules.
4. A **tenancy impact inventory**: every place that would leak or mix data between companies if two companies shared one database today. For each, give file and function, why it is unsafe, and the fix. Include global counters, global settings, global templates, env-based SMS credentials, full-table scans, crons, storage files, audit log, invitations, access requests, bank statements, reports, the integrity scan, imports, removals, backups and email uniqueness. Be exhaustive: I will check this list against the code.
5. **Assumptions baked in** that a second company in another country could break (currency, calendar, timezone, VAT, language, numbering, date formats, phone formats, TIN rules, working-week and holidays).
6. A list of **what is already good and must be kept**: money as integers, immutable issued bills, ledger invariants, maker-checker, the health check and random-operation tests, error-message and label guard tests.
7. Open questions for me.

Stop here and wait for my reply.

## Part 2: design and implement the SaaS conversion

### Design decisions to make and defend (propose a default for each, with trade-offs, and ask me where the choice is mine)

1. **Tenancy model.** My default expectation: a single Convex deployment with a tenant (`orgId`) on every business table, not one deployment per company. Argue for or against this for our scale (tens to low hundreds of companies, each with up to a few thousand units), cost, noisy neighbours, per-tenant backup and restore, data residency, and the Convex limits we already work around (4,096 reads per function).
2. **Identity and membership.** A person can work for more than one company (a consultant, an accountant), so prefer a `memberships` table (user, company, roles, building scope, status) over putting roles on `users`. Decide how email, sign-in, MFA, language and the active company work, how a user switches company, and how invitations and access requests become company-scoped. Keep the access-request flow: a new person asks, a company administrator decides and picks the role.
3. **The platform admin.** A separate role and a separate console (for example `/platform`) that is not reachable from a company login. Capabilities: create, suspend, reactivate and cancel companies; set plan and limits; see usage and health per company (counts and totals, never line-item business data by default); manage platform staff; read the platform audit log; run the books health check for a company; export a company's data. **Support access** to a company's data must be explicit, time-boxed, reason-required, visible to the company, and audited. Platform admins are never created by the normal sign-up flow.
4. **Company lifecycle and onboarding.** States: invited, trial, active, past due, suspended (read only), cancelled (export window), deleted. A guided onboarding for a new company: legal details, first building, currency, timezone and calendar, language, tax settings, staff invitations, optional import. A company's first administrator is created by the invitation the platform sends, not by "first sign-up wins".
5. **Plans, limits and billing.** Plans with limits (units, staff seats, SMS per month, storage), enforced on the server with clear messages, and usage metering. Choose a billing approach that works for Ethiopian customers (local payment methods and invoices may matter more than card billing); keep the billing integration behind an interface so it can change. The platform needs its own invoices and receipts for subscriptions.
6. **Per-company configuration.** Move everything that is global today into per-company settings: organisation profile, tariffs, SMS rules and templates, MFA rule, bill and receipt number formats and counters, currency, timezone, calendar default, working language, tax (VAT) settings, logo and brand colour, optional custom domain or subdomain.
7. **SMS per company.** Per-company gateway credentials stored encrypted (never in plain text, never in logs, never shown again after saving), a per-company sender name, quotas, delivery webhooks that identify the company, and templates seeded per company from platform defaults with the company able to edit them.
8. **Isolation enforcement.** Propose a mechanism that makes a cross-tenant leak hard to write by accident: for example, wrapper functions for queries and mutations that resolve the caller's active membership and company once, an index on `(orgId, …)` for every table, helper functions that load a document and assert it belongs to the caller's company, and a lint or test that fails when a function touches a table without an org check. Every id coming from the client must be re-validated against the company. Document the rules a developer follows.
9. **Performance at multi-tenant scale.** Replace full-table `.collect()` scans with indexed, company-scoped reads and pagination. Make cron and scheduled jobs iterate companies in batches with per-company cursors and failure isolation, so one company's bad data cannot stop the others.
10. **Files and storage.** Company-scoped file ownership and access checks on every ticket, quotas, and clean deletion when a company is deleted.
11. **Backups, export and deletion.** Per-company export (a complete, documented archive) and a restore path; a retention and deletion policy; the platform-wide backup stays.
12. **Observability and operations.** Per-company error and usage views for the platform team, rate limits per company, health checks, and an incident-friendly audit trail.
13. **Internationalisation beyond Ethiopia.** Currency, timezone, calendar, number and phone formats, TIN or tax-id validation rules, and languages become company settings. Keep English and Amharic, and make adding a language a data and dictionary change.
14. **Security.** Threat-model the new surface (tenant confusion, privilege escalation to platform admin, support-access abuse, enumeration of company ids, webhook spoofing, invitation theft) and list mitigations. Keep two-step sign-in. Keep the rule that secrets are never written to files or chat.

### Migration of the existing data

Dire Mall must become **tenant number one** with zero data loss and no downtime that matters. Write a plan and then an idempotent migration (use `@convex-dev/migrations`): create the company, backfill `orgId` on every row of every table, move the singletons into per-company settings and counters (preserving current bill and receipt number sequences so numbers never repeat), convert each user's roles and building scope into a membership, re-run the health check, and prove totals match before and after (arrears, rent roll, deposits, payments, counts). Include a dry run and a rollback or restore step. Make the migration safe to run twice.

### Testing: the bar for "done"

- Keep all existing tests passing at the end of every phase (`npm test`, `npx tsc --noEmit`, `npx next build`).
- **Tenant isolation tests.** Generalise `tests/scope.test.ts`: two or three companies, each with realistic data. A user of company A calls every query (results must contain none of company B's ids or names) and attempts every mutation with company B's ids (all must be refused). Generate this list from the code so a new function cannot be forgotten, and fail the build if a function is not covered or not marked as platform-only.
- **Platform tests.** A company user cannot reach any platform function; a platform admin cannot read business data without a support session; support sessions expire and are audited.
- **Random-operation test across companies.** Extend `tests/fuzz.test.ts` to interleave operations from several companies and run the books health check per company after every step, plus a check that no document references another company's document.
- **Migration test** on a copy of realistic data (use `convex/loadtest.ts` and the seed), comparing before and after totals.
- **Limits and lifecycle tests:** plan limits enforced, suspended company is read only, cancelled company can export, deleted company leaves no data or files behind.
- Add the missing manual checks to a release checklist, including a two-person flow (maker-checker) and the first-company onboarding.

### Working method

1. After part 1 is approved, write `docs/saas/02-architecture.md` (decisions, diagrams, data model changes, API changes, migration plan, risks, rollout) and **wait for my approval**.
2. Then work in small phases, each ending with a green build and a commit. A sensible order: (a) tenant model and membership tables behind the scenes, (b) isolation helpers and the leak-detection test, (c) move settings, counters, templates and SMS credentials per company, (d) convert every module and its indexes, one module at a time, (e) cron and job batching, (f) company onboarding and invitations, (g) platform console and support access, (h) plans, limits and billing, (i) migration of Dire Mall, (j) per-company export and deletion, (k) observability and hardening, (l) documentation and runbooks.
3. After each phase, report what changed, the evidence (tests, the isolation test output, a before-and-after of the health check), what you did not verify, and the next step. Be honest about anything you could not test.
4. Update the staff guide, the README and add a **platform admin guide** and a **company onboarding guide**. Keep Amharic strings flagged for native review.

### Rules of this project (follow them)

- Never add AI or tool attribution anywhere: no co-author trailers in commits, no "generated with" lines in pull requests, code or docs.
- Never create accounts for people, never paste or store secrets or deploy keys in files, chat, logs or commits. Production deploys, production keys and anything that touches the live deployment are done by me; tell me the exact steps.
- Money stays integer santim (or the currency's minor unit). Issued bills stay immutable. Keep maker-checker on the server. Keep building scope as a second layer inside each company.
- Keep every user-facing string in the dictionary in both languages, and keep the tests that guard labels and error messages passing.
- Prefer small, reviewable commits with clear messages. Do not rewrite working modules without a reason you can state.
- If a requirement is ambiguous or a decision is mine, ask a short, specific question with your recommended answer instead of guessing.

Start now with part 1. Produce `docs/saas/01-system-understanding.md`, then stop and wait.
