# Running Dire Mall as a multi-company platform

Many rental and mall companies share one deployment. Each company has its own people, buildings, renters, bills, settings, SMS gateway and numbering. A company can never see or change another company's records: every record carries its company, and every server function checks it (`tests/tenants.test.ts` calls every public function as a member of one company against another company's ids).

## Roles
- **Platform team** (`users.platformRole`): creates, suspends, cancels and deletes companies; sets plans and limits; sees usage and counts of problems. They open `/platform`. They cannot read a company's records unless they start a *support session* (read only, with a reason, 5 to 120 minutes). The company sees each session in Settings → Data and privacy and a banner while it is open.
- **Company staff**: roles and building scope per company (a person can belong to several companies and switch).

## Environment variables (Convex)
| Name | Purpose |
|---|---|
| `BOOTSTRAP_PLATFORM_EMAIL` | The first account with this address becomes platform admin. |
| `SECRETS_ENC_KEY` | 32 random bytes, base64. Encrypts each company's SMS gateway key. Without it gateway keys cannot be saved. |
| `PLATFORM_REQUIRE_MFA` | `1` to require two-step sign-in for platform team members. |
| `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER`, `SMS_WEBHOOK_SECRET` | Optional shared gateway used by companies that have none of their own. |

Next.js: `NEXT_PUBLIC_PLATFORM_NAME` (shown on the sign-in page).

## Onboarding a company
1. `/platform/companies` → **New company**: name, short name, first administrator's email, plan, currency, timezone.
2. Give the one-time code (valid 14 days) to that person. They sign up with the email and the code and become the company's administrator.
3. They finish the setup list in Settings, add staff by invitation or by sharing the company join code (every request still needs approval).

## Plans and limits
Plan presets set limits for units, staff seats and SMS per month; any limit can be set by hand (0 = none). Limits are enforced on the server with a clear message. A suspended, cancelled or trial-ended company is read only (it can still export its data).

## Leaving and deleting
Companies can download a complete copy of their records (Settings → Data and privacy). A company must be cancelled before the platform can delete it; deletion removes every record and file and cannot be undone.

## Migrating an existing single-company deployment
Deploy, then run once: `npx convex run tenancy:moveIntoCompany '{"name":"Dire Mall","slug":"dire-mall"}'`. It tags all existing records with the new company and gives existing staff their memberships. Check Settings and the audit log afterwards.
