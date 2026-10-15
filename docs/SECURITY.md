# Security review

Review of the server code and browser setup, done before go-live. Findings are split into fixed, still open, and accepted.
This is a code review by the builders, not an independent penetration test. Before real money goes through, an
independent test is worth commissioning.

## What was checked
- **Access control on every server function** (about 110). Each one checks the signed-in user's role, and every function
  that takes an ID or returns a list also checks the user's building scope (units, renters, bills, payments, agreements,
  deposits, meters, reports, bank lines, SMS). No function was found that returns another building's data to a
  building-limited user.
- **Maker-checker rules:** payment confirmation, agreement approval, bill corrections, deposit deductions and refunds,
  reading approvals. The person who prepared an item cannot approve it; this is enforced on the server.
- **Role management:** an access admin cannot change their own roles, create or touch a super admin, and the last super
  admin cannot be demoted or deactivated. Deactivating someone ends their sessions at once.
- **SMS delivery webhook:** needs a secret header, compared in constant time.
- **Two-step sign-in:** every request is refused until the second step passes for that sign-in; codes are single-use.

## Fixed in this review
| Finding | Fix |
|---|---|
| CSV exports could run spreadsheet formulas. A renter named `=HYPERLINK(...)` would execute when finance opened the export in Excel. | Text starting with `= + - @` is prefixed with an apostrophe. Amounts and numbers are unchanged. |
| Two-step lockout was five tries per five minutes, forever (about 1,400 guesses a day). | Each repeat lockout doubles the wait, up to 24 hours. A correct code resets it. |
| No browser security headers. | Content-Security-Policy (blocks framing, plugins, foreign form targets, base-tag tricks), X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, HSTS. |
| With `BOOTSTRAP_ADMIN_EMAIL` set, someone else signing up first stopped the admin from becoming super admin. | The named address becomes super admin while none exists, whoever signed up before. Without the variable, only the very first account ever created. |
| Uploads were only limited by the browser. | The server now rejects anything that is not a PDF, PNG, JPG or WebP, or is over 15 MB, when it is attached to a record. |

## Still open (decide before go-live)
1. **Anyone can create an account, and email addresses are not verified.** New accounts are inactive until an admin
   activates them, but an outsider who registers a colleague's email address first would hold that account's password
   once an admin activates it. Until email verification or an invite flow exists: activate accounts only for people you
   have confirmed in person or by phone, and check the email address character by character. This needs an email provider
   to fix properly.
2. **Download links are not access-checked.** Contracts, evidence and renter documents are served from Convex file
   storage through a link that is only given to users who pass the scope check. The link itself does not expire and
   works for anyone who has it. The proposal asks for private, signed links. The fix is to serve files through an
   authenticated route that checks the user on every download. Worth doing before storing ID copies or licences.
3. **Content-Security-Policy keeps `unsafe-inline` for scripts** because Next.js and the theme bootstrap use inline
   scripts. A per-request nonce would remove this. Framing and plugin attacks are still blocked.
4. **Two-step secrets are stored unencrypted** in the database (Convex encrypts data at rest). Application-level
   encryption would need a key held outside the database.
5. **Rejected uploads leave an unattached file in storage** (the failed request rolls back, including a delete). A small
   clean-up job for unattached files would tidy this.
6. **No independent penetration test, and no automated dependency audit in CI.** A manual `npm audit --omit=dev` found 0 known vulnerabilities on the day of this review. Password guessing is limited only by Convex Auth's own protections.

## Accepted
- Anyone signed in with a role that can read bills can read the building-wide totals for buildings they are scoped to.
  That is the intended access model.
