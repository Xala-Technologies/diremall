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
  }).index("email", ["email"]),

  buildings: defineTable({ name: v.string(), address: v.optional(v.string()) }),
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
  }).index("by_building", ["buildingId"]).index("by_building_number", ["buildingId", "number"]),

  renters: defineTable({
    kind: v.union(v.literal("individual"), v.literal("company")),
    name: v.string(),
    tin: v.optional(v.string()),
    businessLicenseNo: v.optional(v.string()),
    phone: v.string(),
    email: v.optional(v.string()),
    legalRepresentative: v.optional(v.string()),
  }).index("by_name", ["name"]),
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
  }).index("by_unit", ["unitId", "status"]).index("by_renter", ["renterId"]),

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
  })
    .index("by_agreement_period", ["agreementId", "period"]) // idempotency: one original bill per agreement+period
    .index("by_renter", ["renterId"])
    .index("by_period", ["period"]),
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
  }).index("by_renter", ["renterId"]).index("by_status", ["status"]).index("by_reference", ["method", "reference"]),
  paymentAllocations: defineTable({ paymentId: v.id("payments"), invoiceId: v.id("invoices"), amount: money })
    .index("by_invoice", ["invoiceId"]).index("by_payment", ["paymentId"]),
  // positive = credit created from an overpayment, negative = credit consumed by a bill
  renterCredits: defineTable({ renterId: v.id("renters"), paymentId: v.optional(v.id("payments")), invoiceId: v.optional(v.id("invoices")), amount: money })
    .index("by_renter", ["renterId"]).index("by_invoice", ["invoiceId"]),

  deposits: defineTable({
    agreementId: v.id("agreements"),
    required: money,
    held: money,
    deductions: v.array(v.object({ amount: money, reason: v.string(), requestedBy: v.id("users"), approvedBy: v.optional(v.id("users")) })),
    refunded: money,
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
    .index("by_cost", ["sharedCostId"]).index("by_unit", ["unitId"]),

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
  settings: defineTable({ key: v.string(), value: v.number() }).index("by_key", ["key"]),

  bankStatementEntries: defineTable({
    importBatch: v.string(),
    postedAt: ts,
    amount: money,
    reference: v.string(),
    matchedPaymentId: v.optional(v.id("payments")), // matching links evidence; never creates a payment
  }).index("by_batch", ["importBatch"]),

  smsMessages: defineTable({
    renterId: v.id("renters"),
    kind: v.union(v.literal("dueReminder"), v.literal("paymentAck"), v.literal("expiryWarning")),
    body: v.string(),
    status: v.union(v.literal("queued"), v.literal("accepted"), v.literal("delivered"), v.literal("failed"), v.literal("uncertain"), v.literal("cancelled"), v.literal("sending")),
    invoiceId: v.optional(v.id("invoices")),
    agreementId: v.optional(v.id("agreements")),
    dedupeKey: v.optional(v.string()),
  }).index("by_renter", ["renterId"]).index("by_dedupe", ["dedupeKey"]).index("by_status", ["status"]),

  auditLog: defineTable({ actorId: v.id("users"), action: v.string(), entity: v.string(), entityId: v.string(), detail: v.string() })
    .index("by_entity", ["entity", "entityId"]),
});
