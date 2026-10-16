import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// All money fields are integer santim (1 ETB = 100 santim). Timestamps are ms since epoch (UTC).
const money = v.number();
const ts = v.number();

export const role = v.union(
  v.literal("superAdmin"),
  v.literal("propertyManager"),
  v.literal("financeOfficer"),
  v.literal("approver"),
  v.literal("auditor"),
  v.literal("accessAdmin"),
);

export default defineSchema({
  ...authTables,

  // Auth user + staff profile. New sign-ups are inactive until an access admin enables them.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    roles: v.optional(v.array(
      role,
    )),
    buildingScope: v.optional(v.union(v.literal("all"), v.array(v.id("buildings")))),
    active: v.optional(v.boolean()),
    lang: v.optional(v.union(v.literal("en"), v.literal("am"))),
    inviteCode: v.optional(v.string()), // only present for a moment during sign-up; removed as soon as it is checked
    // Someone who signs up without an invitation asks for access. An access admin approves (and picks the roles) or declines.
    accessStatus: v.optional(v.union(v.literal("pending"), v.literal("rejected"))),
    accessNote: v.optional(v.string()), // what the person wrote to the administrator
    requestedAt: v.optional(v.number()),
    decisionReason: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
  }).index("email", ["email"]),

  buildings: defineTable({
    name: v.string(), address: v.optional(v.string()), city: v.optional(v.string()), subCity: v.optional(v.string()),
    contactName: v.optional(v.string()), contactPhone: v.optional(v.string()), notes: v.optional(v.string()),
    archivedAt: v.optional(v.number()), // taken out of service: hidden from every list and picker, its history stays
  }),
  floors: defineTable({ buildingId: v.id("buildings"), label: v.string(), planFileId: v.optional(v.id("_storage")) })
    .index("by_building", ["buildingId"]),

  units: defineTable({
    buildingId: v.id("buildings"),
    floorId: v.id("floors"),
    number: v.string(),
    areaM2: v.number(),
    category: v.union(v.literal("office"), v.literal("retail"), v.literal("storage"), v.literal("residential")),
    ratePerM2: money,
    status: v.union(v.literal("vacant"), v.literal("occupied"), v.literal("maintenance")),
    notes: v.optional(v.string()),
  }).index("by_building", ["buildingId"]).index("by_building_number", ["buildingId", "number"]),

  renters: defineTable({
    kind: v.union(v.literal("individual"), v.literal("company")),
    name: v.string(),
    tin: v.optional(v.string()),
    businessLicenseNo: v.optional(v.string()),
    phone: v.string(),
    email: v.optional(v.string()),
    legalRepresentative: v.optional(v.string()),
    idNumber: v.optional(v.string()), // national ID, Kebele ID or passport (individuals)
    address: v.optional(v.string()),
    contactPerson: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    vatNumber: v.optional(v.string()),
    licenseExpiresAt: v.optional(ts),
    notes: v.optional(v.string()),
    smsLanguage: v.optional(v.union(v.literal("en"), v.literal("am"))), // the language their messages are sent in
    smsOptOut: v.optional(v.boolean()), // never send them automatic messages
  }).index("by_name", ["name"]).index("by_tin", ["tin"]),
  renterDocuments: defineTable({
    renterId: v.id("renters"),
    kind: v.string(),
    fileId: v.id("_storage"),
    uploadedBy: v.id("users"),
  }).index("by_renter", ["renterId"]),

  agreements: defineTable({
    unitId: v.id("units"),
    renterId: v.id("renters"),
    status: v.union(v.literal("draft"), v.literal("inReview"), v.literal("active"), v.literal("expired"), v.literal("terminated")),
    startsAt: ts,
    endsAt: ts,
    signedFileId: v.optional(v.id("_storage")),
    createdBy: v.id("users"),
    approvedBy: v.optional(v.id("users")), // must differ from createdBy
    terminationReason: v.optional(v.string()),
    importedAt: v.optional(ts), // brought in from the old records at go-live: active without going through review
  }).index("by_unit", ["unitId", "status"]).index("by_renter", ["renterId"]).index("by_status", ["status"]),

  // Effective-dated terms: a later rent change never alters already-issued bills.
  agreementTerms: defineTable({
    agreementId: v.id("agreements"),
    effectiveFrom: ts,
    rent: v.union(
      v.object({ kind: v.literal("perM2"), ratePerM2: money }),
      v.object({ kind: v.literal("fixed"), amount: money }),
    ),
    dueDay: v.number(),
    depositAmount: money,
    // e.g. { percent: 10, everyMonths: 12 } raises the rent 10% every 12 months from effectiveFrom
    escalation: v.optional(v.object({ percent: v.number(), everyMonths: v.number() })),
    createdBy: v.id("users"),
  }).index("by_agreement", ["agreementId", "effectiveFrom"]),

  invoices: defineTable({
    number: v.string(),
    agreementId: v.id("agreements"),
    unitId: v.id("units"),
    renterId: v.id("renters"),
    period: v.string(), // "2026-09"
    status: v.union(v.literal("draft"), v.literal("issued")),
    total: money, // immutable once issued; corrections live in invoiceAdjustments
    dueAt: ts,
    issuedBy: v.optional(v.id("users")),
    issuedAt: v.optional(ts),
    // Kept up to date by refreshInvoice() whenever a payment, credit or correction touches the bill,
    // so reports read a number instead of re-adding every payment. Optional only until the backfill has run.
    buildingId: v.optional(v.id("buildings")),
    adjustments: v.optional(money),
    paid: v.optional(money),
    creditUsed: v.optional(money),
    due: v.optional(money),
  })
    .index("by_agreement_period", ["agreementId", "period"]) // idempotency: one original bill per agreement+period
    .index("by_renter", ["renterId"])
    .index("by_period", ["period"])
    .index("by_status_due", ["status", "due"]), // open bills: status = issued and due > 0
  invoiceLines: defineTable({
    invoiceId: v.id("invoices"),
    kind: v.union(v.literal("rent"), v.literal("water"), v.literal("electricity"), v.literal("generator"), v.literal("security"), v.literal("cleaning"), v.literal("other")),
    description: v.string(),
    amount: money,
    calcNote: v.string(), // the calculation as it was done at the time
  }).index("by_invoice", ["invoiceId"]),
  invoiceAdjustments: defineTable({
    invoiceId: v.id("invoices"),
    delta: v.number(),
    reason: v.string(),
    requestedBy: v.id("users"),
    approvedBy: v.optional(v.id("users")),
  }).index("by_invoice", ["invoiceId"]),

  // recorded → confirmed → applied. Only applied money reduces a bill.
  payments: defineTable({
    renterId: v.id("renters"),
    amount: money,
    method: v.union(v.literal("bankDeposit"), v.literal("transfer"), v.literal("telebirr"), v.literal("cbeBirr"), v.literal("cash")),
    reference: v.string(),
    receivedAt: ts,
    status: v.union(v.literal("recorded"), v.literal("confirmed"), v.literal("applied"), v.literal("voided")),
    recordedBy: v.id("users"),
    confirmedBy: v.optional(v.id("users")),
    evidenceFileId: v.optional(v.id("_storage")),
    receiptNumber: v.optional(v.string()),
    payerName: v.optional(v.string()), // who actually paid, when that is not the renter
    notes: v.optional(v.string()),
    confirmedAt: v.optional(ts),
    appliedBy: v.optional(v.id("users")),
    appliedAt: v.optional(ts),
    voidedBy: v.optional(v.id("users")),
    voidedAt: v.optional(ts),
    voidReason: v.optional(v.string()),
  }).index("by_renter", ["renterId"]).index("by_status", ["status"]).index("by_reference", ["method", "reference"]).index("by_amount", ["amount"]).index("by_received", ["receivedAt"]),
  paymentAllocations: defineTable({ paymentId: v.id("payments"), invoiceId: v.id("invoices"), amount: money })
    .index("by_invoice", ["invoiceId"]).index("by_payment", ["paymentId"]),
  // positive = credit created from an overpayment, negative = credit consumed by a bill
  renterCredits: defineTable({ renterId: v.id("renters"), paymentId: v.optional(v.id("payments")), invoiceId: v.optional(v.id("invoices")), amount: money, openingKey: v.optional(v.string()) })
    .index("by_renter", ["renterId"]).index("by_invoice", ["invoiceId"]),

  deposits: defineTable({
    agreementId: v.id("agreements"),
    required: money,
    held: money,
    // a deduction may settle a bill the renter still owes (invoiceId), or cover damage and other costs (no bill)
    deductions: v.array(v.object({ amount: money, reason: v.string(), requestedBy: v.id("users"), approvedBy: v.optional(v.id("users")), invoiceId: v.optional(v.id("invoices")) })),
    refunded: money,
    // how each part of the deposit arrived, so it can be traced to a bank line or a cash receipt
    receipts: v.optional(v.array(v.object({ amount: money, method: v.string(), reference: v.string(), receivedAt: ts, recordedBy: v.id("users") }))),
  }).index("by_agreement", ["agreementId"]),

  meters: defineTable({ unitId: v.id("units"), kind: v.union(v.literal("water"), v.literal("electricity")), serial: v.string() }).index("by_unit", ["unitId"]),
  meterReadings: defineTable({
    meterId: v.id("meters"),
    value: v.number(),
    readAt: ts,
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("flagged")),
    enteredBy: v.id("users"),
    approvedBy: v.optional(v.id("users")),
    isReset: v.boolean(),
  }).index("by_meter", ["meterId", "readAt"]),
  sharedCosts: defineTable({
    buildingId: v.id("buildings"),
    kind: v.union(v.literal("generator"), v.literal("security"), v.literal("cleaning")),
    period: v.string(),
    total: money,
    basis: v.union(v.literal("area"), v.literal("equal")),
    ownerShare: money,
    createdBy: v.id("users"),
    approvedBy: v.optional(v.id("users")),
  }).index("by_building_period", ["buildingId", "period"]),

  sharedCostAllocations: defineTable({ sharedCostId: v.id("sharedCosts"), unitId: v.id("units"), amount: money })
    .index("by_cost", ["sharedCostId"]).index("by_unit", ["unitId"]).index("by_cost_unit", ["sharedCostId", "unitId"]),

  handovers: defineTable({
    agreementId: v.id("agreements"),
    kind: v.union(v.literal("moveIn"), v.literal("moveOut")),
    keys: v.number(),
    condition: v.string(),
    readings: v.optional(v.string()),
    recordedBy: v.id("users"),
    at: ts,
  }).index("by_agreement", ["agreementId"]),

  // key/value configuration: tariffs (santim per unit), sms lead days, counters
  // Sign-up is by invitation: an access admin invites an email address and hands the person a one-time code.
  invites: defineTable({
    email: v.string(),
    codeHash: v.string(),
    roles: v.array(role),
    buildingScope: v.union(v.literal("all"), v.array(v.id("buildings"))),
    createdBy: v.id("users"),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  // A document link is created only after a role and building check, and works for two minutes.
  fileTickets: defineTable({ tokenHash: v.string(), storageId: v.id("_storage"), contentType: v.string(), userId: v.id("users"), expiresAt: v.number() })
    .index("by_hash", ["tokenHash"]).index("by_expiry", ["expiresAt"]),

  // Who the bills and receipts come from: printed on every invoice, receipt and contract. One row.
  organization: defineTable({
    name: v.string(), tin: v.optional(v.string()), vatNumber: v.optional(v.string()), address: v.optional(v.string()), city: v.optional(v.string()),
    phone: v.optional(v.string()), email: v.optional(v.string()),
    bankAccounts: v.optional(v.string()), // where renters pay, one per line: "CBE 1000123456789 Dire Mall PLC"
    invoiceNote: v.optional(v.string()), // printed at the foot of every bill (payment terms, late-payment note)
  }),

  settings: defineTable({ key: v.string(), value: v.number() }).index("by_key", ["key"]),

  // Two-step sign-in. A secret only counts once `enabled`; sessions are marked verified per sign-in.
  mfaSecrets: defineTable({
    userId: v.id("users"),
    secret: v.string(),
    enabled: v.boolean(),
    lastStep: v.optional(v.number()), // a code can be used once
    recovery: v.array(v.string()), // sha-256 of unused recovery codes
    failures: v.number(),
    lockedUntil: v.optional(v.number()),
    lockouts: v.optional(v.number()), // consecutive lockouts; each one lasts longer
  }).index("by_user", ["userId"]),
  mfaSessions: defineTable({ sessionId: v.string(), userId: v.id("users") }).index("by_session", ["sessionId"]).index("by_user", ["userId"]),

  bankStatementEntries: defineTable({
    importBatch: v.string(),
    postedAt: ts,
    amount: money,
    reference: v.string(),
    description: v.optional(v.string()), // the narration printed on the statement
    bank: v.optional(v.string()),
    matchedPaymentId: v.optional(v.id("payments")), // matching links evidence; never creates a payment
    matchedBy: v.optional(v.id("users")),
    matchedAt: v.optional(ts),
    ignoredAt: v.optional(ts), // a line that is not rent (bank charge, transfer between own accounts, …)
    ignoredBy: v.optional(v.id("users")),
    ignoreReason: v.optional(v.string()),
  }).index("by_batch", ["importBatch"]).index("by_payment", ["matchedPaymentId"]).index("by_line", ["postedAt", "amount"]),

  smsMessages: defineTable({
    renterId: v.optional(v.id("renters")), // empty only for a test message to a number typed in
    to: v.optional(v.string()),
    kind: v.union(v.literal("dueReminder"), v.literal("paymentAck"), v.literal("expiryWarning"), v.literal("billIssued"), v.literal("custom")),
    template: v.optional(v.string()), // which template made it: "overdue", "dueSoon", "paymentReceived", "test", "broadcast"…
    lang: v.optional(v.union(v.literal("en"), v.literal("am"))),
    batch: v.optional(v.string()), // messages sent together as one announcement
    urgent: v.optional(v.boolean()), // a test message: sent now, ignoring quiet hours and the daily limit
    attempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
    sendAfter: v.optional(v.number()), // do not send before this time (retry back-off)
    sentAt: v.optional(v.number()),
    segments: v.optional(v.number()),
    body: v.string(),
    status: v.union(v.literal("queued"), v.literal("accepted"), v.literal("delivered"), v.literal("failed"), v.literal("uncertain"), v.literal("cancelled"), v.literal("sending")),
    invoiceId: v.optional(v.id("invoices")),
    agreementId: v.optional(v.id("agreements")),
    dedupeKey: v.optional(v.string()),
  }).index("by_renter", ["renterId"]).index("by_dedupe", ["dedupeKey"]).index("by_status", ["status"]).index("by_batch", ["batch"]),

  // Edited wording of the automatic messages. A kind and language with no row here uses the built-in text.
  smsTemplates: defineTable({ kind: v.string(), lang: v.union(v.literal("en"), v.literal("am")), body: v.string(), enabled: v.boolean(), updatedBy: v.id("users") }).index("by_kind_lang", ["kind", "lang"]),

  auditLog: defineTable({ actorId: v.id("users"), action: v.string(), entity: v.string(), entityId: v.string(), detail: v.string() })
    .index("by_entity", ["entity", "entityId"]),
});
