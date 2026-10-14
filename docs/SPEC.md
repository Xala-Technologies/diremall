# Dire Mall Rental Management: Build Spec (v0.1)

Sources: Xala proposal v3.0 (25 Sep 2026) and the Sey Software proposal (16 Sep 2026, a competing bid).
The MRI Software page was used only as a feature checklist. Nothing is copied from it.

## 1. Scope

**In release 1 (recommended scope)**
| Module | Must do |
|---|---|
| Buildings and units | Building > floor > unit. Area m², category (Office/Retail/Storage/Residential), rate per m², status (Vacant/Occupied/Maintenance), floor plan attachments |
| Renters and documents | Individual or company. TIN, business licence, contacts, legal representative, document store |
| Agreements | Draft > review (a different user) > signed copy attached > active. Overlap check. Renewals keep term history. Move-in/out handover (keys, condition, readings) |
| Rent and bills | Recurring charge generation per period, finance review before issue, immutable issued bills, approved corrections, print |
| Payments and deposits | Record > confirm (a different user) > apply to bill. Partial payments, overpayment credit, deposits held separately |
| Utilities and shared costs | Sub-meter readings (approve outliers, handle meter reset), allocation of generator/cleaning/security by area or contract rule, vacant share goes to owner |
| Arrears | Aging buckets 30/60/90+ by unit and renter |
| Bank statement import | File import, suggested match, confirm link (never creates a new payment) |
| SMS | Due reminders, payment acknowledgment, expiry warnings. Status tracking. No debt reminder once paid |
| Reports and dashboard | KPIs, Rent Roll, Tenant Ledger, Vacancy, Aging, Revenue, month-end pack. Excel/PDF/CSV. Screen totals equal export totals |
| Security | RBAC, audit log, 2FA for privileged users, encrypted documents, daily backups with a restore test |

**Out of release 1:** direct bank/Telebirr/CBE Birr APIs, renter self-service portal, maintenance job tracking, e-signatures, interactive floor plans, native mobile app, offline mode, general accounting, payroll.

**Planning assumptions:** one organisation, ETB only, 1-5 buildings, up to 1,000 units, about 25 concurrent users, up to 250k historical records.

## 2. Roles
Property staff · Finance staff · Approver · Management/Auditor (read-only) · Access admin (cannot approve financial items).
The maker-checker rule is enforced in code: the creator of an agreement, refund or correction can never approve it.

## 3. Domain model (core tables)
`organization, user, role_assignment (user, role, building scope), building, floor, unit, renter, renter_document, agreement, agreement_term (effective-dated), deposit, charge_rule, billing_period, invoice, invoice_line, invoice_adjustment, payment, payment_allocation, credit, meter, meter_reading, shared_cost, shared_cost_allocation, bank_statement_entry, bank_match, sms_message, audit_log, idempotency_key`

Design rules:
- Money is stored as integer minor units, or NUMERIC(14,2). Never floats.
- Issued invoices are immutable. Changes go through `invoice_adjustment` (reason, approver, revised balance).
- `agreement_term` is effective-dated, so an October rent change leaves the September invoice untouched.
- Invoice generation is idempotent, with a unique key on (agreement, charge, period).
- Payment lifecycle: `recorded -> confirmed -> applied`. Only `applied` reduces a bill.
- Deposits are a separate ledger and never reduce rent due.
- Access control is checked on the server against the user's building scope, for every read and every export.
- Dates are stored in UTC/Gregorian. The UI shows Ethiopian calendar as an option (to be confirmed).

## 4. Acceptance tests (taken from the proposal, used as the test suite)
1. 150 m² × 2,300 ETB = 345,000 ETB/month.
2. Pay 200,000 on 345,000 leaves 145,000 due.
3. Pay 360,000 on 345,000 leaves 15,000 credit.
4. Electricity: 150 kWh × 6 = 900 ETB.
5. Shared cost: 12,000 over 150/100/50 m² gives 6,000 / 4,000 / 2,000. If the 50 m² unit is vacant, the owner carries 2,000.
6. Dashboard example: bills 1,010,000 · confirmed payments 810,000 · applied 750,000 · unapplied 60,000 · outstanding 260,000 · deposits 50,000 shown separately.
7. Overlapping active agreements are rejected.
8. Re-running billing for the same period creates no duplicates.
9. A user cannot open another building's unit by editing the URL or by exporting.
10. A bank match of 250,000 does not add 250,000 to collections.
11. Restore from backup, then the financial totals still reconcile.

## 5. Recommended architecture
- **App:** Next.js (App Router) + TypeScript, server-side rendering, responsive for phone/tablet/desktop
- **DB:** PostgreSQL (row-level scoping, transactions, point-in-time recovery via WAL)
- **ORM/migrations:** Prisma or Drizzle
- **Auth:** email + password, TOTP 2FA for privileged roles, server-side sessions that can be revoked
- **Files:** S3-compatible object storage, private, signed URLs
- **Jobs:** queue (pg-boss or BullMQ) for invoice generation, SMS, reminders, backups
- **SMS:** provider adapter interface (provider to be decided, depends on Dire Mall's account)
- **Exports:** server-generated XLSX/CSV/PDF from the same query as the screen
- **Hosting:** to be decided (Ethiopian data-residency and cost vs the 15-minute RPO / 4-hour RTO targets)
- **Tests:** unit tests for billing and allocation maths, plus e2e tests for the acceptance list above

## 6. Build order
1. Skeleton: auth, roles, building scope, audit log
2. Buildings, units, renters, documents
3. Agreements and term history
4. Billing engine and invoices (with tests 1, 7, 8)
5. Payments, allocation, deposits, credits (tests 2, 3)
6. Utilities and shared costs (tests 4, 5)
7. Arrears, reports, dashboard, exports (test 6)
8. Bank import and matching (test 10)
9. SMS
10. Data migration tooling, backups and restore drill, hardening

## 7. Open questions for Dire Mall
- Languages (Amharic, Afan Oromo, English) and calendar (Ethiopian vs Gregorian)?
- VAT/turnover tax treatment and invoice or receipt legal format?
- Part-month, rent-free and escalation rules? Is rent fixed or per m², or both?
- Shared-cost policy for vacant units?
- Who pays for SMS and hosting? Which SMS provider?
- Is Proclamation 1320/2024 compliance a checklist (fields, notice periods) or only record-keeping? We need the text of the relevant articles.
- Bank statement formats (CBE, Awash, etc.)?
- Existing data: spreadsheets or paper? Quality?

## 8. Notes on the two proposals
- The Sey Software bid (350,000 ETB, 45 working days, 6-month warranty) and the Xala proposal (12-16 weeks, 90-day warranty, price TBD) disagree on timeline and warranty. Xala's own document says it did not adopt the Sey bid's financial terms.
- 45 working days is unrealistic for this scope. The Xala estimate of 12-16 weeks with two developers is more credible.
