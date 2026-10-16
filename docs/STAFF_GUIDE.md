# Staff guide

For the people who use the system day to day. Each section is one role. A person can hold several roles; you only see
the menu items and buttons your roles allow.

**Two rules that apply to everyone**
- The person who prepares something can never be the person who approves it. If a button is greyed out with a note about
  "same person", ask a colleague to do that step.
- Nothing is deleted. Mistakes are fixed with a correction that someone else approves, and every change is recorded in
  **History**.

## Signing in for the first time
1. Your administrator gives you a one-time **invitation code** in person or by phone.
2. On the sign-in page choose **Create account**, enter your name, the same email address the administrator used, a
   password of at least 8 characters, and the invitation code.
3. You are signed in with the roles the administrator chose. If the code is refused, ask for a new one: codes work once,
   for one email address, for 7 days.
4. Finance staff, approvers and administrators: set up **two-step sign-in** under **Settings** (scan the QR code with an
   authenticator app) and keep the recovery codes somewhere safe. They are shown only once.

Language (English or Amharic), the Ethiopian or Gregorian calendar and light or dark mode are in the top bar.

---

## Property staff
You look after buildings, units, renters and agreements.

**Add a building and its units.** Buildings & units → *Add building*: name, city and sub-city, address, caretaker and
phone, notes, and the floors (type them separated by commas, for example "Ground, 1st, 2nd"). Pick the building, then
*Manage building* to correct its details, rename floors, add floors, and attach or view each **floor plan**. *Add unit*
takes the floor, unit number, area (m²), category, rate per m², starting status (vacant or under maintenance) and notes.
Every unit card has *Edit unit*; the area and rate of a leased unit are locked, because they change through an
agreement term so issued bills never move. To load many units at once use **Import data** (a spreadsheet; the system
checks every row first and imports nothing if any row is wrong).

**Add a renter.** Renters → *Add renter*. A **company** needs a TIN (10 digits) and can have a business licence number,
the licence expiry date (the renter's page warns when it is close or past), a VAT number and a legal representative. An
**individual** needs an ID number or a TIN. Everyone needs a phone number; you can also record a contact person, a second
phone, an email, an address and notes. Attach the licence, TIN certificate or ID copy while creating, or later on the
renter's page. A TIN can belong to one renter only. Documents are PDF, PNG, JPG or WebP, up to 15 MB. To correct anything
later open the renter and choose *Edit renter*.

**Make an agreement.**
1. Agreements → *New agreement*, or *New agreement* on a vacant unit's card. Choose the unit, renter, dates, rent
   (per m² or a fixed amount), the day rent is due, the deposit and any yearly increase.
2. Attach the **signed copy**.
3. *Submit for review*. An approver then approves it. The unit becomes occupied when the lease starts.
4. At move-in and move-out record the **handover** (keys, condition, meter readings) on the agreement page.
5. To end a lease early use *Terminate*, with a reason. Billing stops from that date.

You cannot approve your own agreements.

**Reading a lease.** Open any agreement. The bar and badge show how long it has left. *Lease account* shows what has been
billed, paid and is still owed or overdue, with the latest bills. Details show the rent being charged today, the next
yearly increase and its date, and who prepared and approved the lease. On the Agreements list, *Ending in 60 days* shows
the leases to renew. **Reports → Lease expiry** lists them for 30 to 365 days with the monthly rent at stake.

**Moving out.** When a lease ends or is terminated, the deposit card stays on the agreement page. If the renter still owes
money on that lease the page says so: request a deduction for it, then an approver approves the deduction and refunds what
is left. **Reports → Deposits** lists every deposit and the refunds due.

**Meter readings.** Utilities → Meters shows every meter for the month: previous reading, this month's reading, usage and
the charge billing will make, with a status: *Ready* (an approved reading this month, so it will be billed), *Waiting*
(entered but not approved), *Flagged* or *Missing* (no reading, so nothing is charged). Check there are no Missing rows
before preparing the month's bills. *Enter reading* shows the last reading and warns if the new value is lower, which sends
it to an approver unless you tick meter reset. Click a meter to see all its readings. The page also tells you how many
occupied units have no meter at all.

**Shared costs.** Utilities → Shared costs: enter the building's generator, security or cleaning total for the month. It is
split across the units by area, the share of vacant units is carried by the owner, and an approver approves it before it
appears on bills. *How it was split* shows each unit's share.

---

## Finance staff
You prepare bills, record money and keep the books right.

**Monthly bills.**
1. Bills → choose the month → *Prepare bills*. This creates a draft for every active agreement. Running it again never
   creates duplicates.
2. Check the drafts. Add a one-off charge to a draft if needed, or discard a draft.
3. *Issue all drafts*. Issued bills cannot be edited. To correct one, request a **correction** with a reason; an approver
   approves it.

The cards at the top show what was billed, collected, still outstanding and overdue for the month. The **Overdue** tab and
the red "Overdue · 12 days" tag show bills past their due date. On each open bill, the wallet icon starts *Record
payment* for that renter and the bell icon sends a reminder SMS (at most one per bill per day). *Remind overdue* sends one
to every overdue bill after you confirm. Open a bill to print it as a proper invoice: it carries the company's legal
details, the renter's details, the line items, the amount in words and where to pay.

**Company details on bills and receipts.** An approver fills in Settings → *Organisation* once: legal name, TIN, VAT
number, address, phone, the bank accounts renters pay into, and a note for the foot of every bill. They are printed on
every bill, receipt and contract.

**Record a payment.** Payments → *Record payment*: choose the renter and you will see their open bills and the total due
(*Use total due* fills the amount). Then the amount, method (bank deposit, transfer, Telebirr, CBE Birr, cash), the bank or
Telebirr reference and the date. Add who paid if it was not the renter, notes, and the slip if you have one. A reference
can only be booked once in the whole mall.

**Payment steps.** *Recorded* → an **approver confirms** it (not the person who recorded it) → you **apply** it. In the
apply window you choose how much of the payment settles each bill; it starts oldest first and you can change it. Whatever is
left stays as credit on the renter's account. Only applied payments reduce what is owed, and a receipt is created when it is
applied. Click any payment to see its full history: who recorded, confirmed and applied it and when, what it paid, the
evidence, and the bank statement line it matches. The cards at the top and the period filter show where every payment
stands.

**Deposits** are held separately and never reduce rent. Receive a deposit on the agreement page; a deduction or refund
needs an approver.

**Bank matching.** Bank matching → *Import statement*. Choose the bank's CSV or Excel file; the system reads the date, narration, reference and
credit columns whatever order they are in, skips money-out rows, and shows a preview (number of deposits, total, anything it
could not read) before anything is saved. Lines already imported before are skipped, so overlapping statements are safe.
Each deposit is then matched in turn:
- **Match** shows payments with exactly the same amount (reference matches are highlighted) and a search box for others.
  Confirming links the statement line to the payment.
- **Record payment** is for money that arrived but was never recorded: it opens the payment form already filled in from the
  line (renter picked from the narration when the name appears) and links the line when you save. The payment still needs
  an approver's confirmation like any other.
- **Ignore** is for bank charges, transfers between your own accounts and anything that is not rent; a reason is required.
Matching only links evidence: it never creates a payment or changes what was collected. An approver can reopen a match.

**Reports.** Reports has the rent roll, vacancy, arrears ageing (30 / 60 / 90+ days), revenue and renter statements, each
with Excel, CSV and PDF export. **Month-end pack** gathers the month in one place. The figures on screen and in the
exports are the same.

---

## Approver
You are the second pair of eyes.
- **Agreements:** review and approve or return for correction. Check the signed copy is attached.
- **Payments:** *Confirm receipt* only when the money is really in the account (the evidence alone is not proof).
- **Corrections to bills** and **deposit deductions and refunds:** approve or reject with the reason in front of you.
- **Meter readings** that were flagged.
- Anything you prepared yourself must be approved by someone else.
- Approvers can also change tariffs and SMS timing in **Settings**.

The Overview page's *Needs attention today* list shows what is waiting for you.

---

## Management and auditors
You can see everything in your buildings but cannot change anything. Use **Overview** for occupancy, billed, collected and
outstanding, **Reports** for detail, and **History** to see who did what and when.

---

## Access admins
You decide who can use the system. You cannot approve financial items unless you are also given that role.
- **Invite someone:** Staff access → *Invite person*. Enter their email, tick roles and buildings, and give them the code
  yourself. Never send it by email or chat. Cancel unused invitations in the *Pending invitations* list.
- **Change or remove access:** click a person. Deactivating someone signs them out at once.
- **Lost phone:** open the person and choose *Reset two-step sign-in*; they set it up again at next sign-in.
- **Require two-step sign-in** for finance staff, approvers and admins: Settings → *Require for finance, approvers and
  admins*. Set up your own first.
- You cannot change your own roles, and only a super admin can create another super admin.

---

## SMS reminders
The system queues reminders before the due date, a thank-you when a payment is applied, and a warning before an agreement
ends. **SMS** shows every message, its type and status; failed ones can be retried one by one or all at once. A renter who
has paid does not get a debt reminder. Each message shows how many SMS **segments** it uses: the operator bills by segment,
and text in Amharic fits only 70 characters in a segment (160 for English), so it costs more.

## If something looks wrong
Do not repeat the action. Note the page, the time and what you clicked, and tell the administrator. History shows what
actually happened.

## Settings
Open **Settings**. Five tabs:
- **Overview**: a setup checklist (organisation details, buildings, units, utility tariffs, SMS gateway, two-step sign-in) with a button into each item.
- **Organisation**: the legal name, TIN, VAT number, contact details, bank accounts and the note printed on every bill. A preview shows how it prints. Approvers edit.
- **Buildings**: the register of buildings. **Add building** and **Manage building** (details, floors, floor plans) live here. Only buildings added here and not archived appear anywhere else in the app. *Archive* takes a building out of service without deleting anything; it is refused while the building has live agreements. *Restore* brings it back.
- **Billing and leases**: electricity and water tariffs and how many days before a lease ends to warn. Reminder days and quiet hours are on the SMS page.
- **Security**: your two-step sign-in, the rule that makes it compulsory for staff, and a shortcut to Staff access.

## Deleting records added by mistake
Records can be deleted for good only while nothing depends on them. Everything else is kept so the books add up. Every deletion is recorded in History.
- **Building** (Settings, Buildings, *Delete*): only if none of its units ever had a lease, meter reading or shared cost. Its empty units and floors go with it. Otherwise use *Archive*.
- **Floor** (Manage building): only an empty floor. **Unit** (Edit unit): only a unit with no leases, readings or shared costs.
- **Renter** (renter page): only a renter with no leases, bills, payments or credit. Their documents and messages go with them.
- **Agreement**: only a draft or one in review. Once approved, it stays on the record and is ended with *Terminate*.
