/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agreements from "../agreements.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as backup from "../backup.js";
import type * as bank from "../bank.js";
import type * as billing from "../billing.js";
import type * as crons from "../crons.js";
import type * as deposits from "../deposits.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as imports from "../imports.js";
import type * as invites from "../invites.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_billing from "../lib/billing.js";
import type * as lib_bulk from "../lib/bulk.js";
import type * as lib_ethiopianCalendar from "../lib/ethiopianCalendar.js";
import type * as lib_ledger from "../lib/ledger.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_period from "../lib/period.js";
import type * as lib_scope from "../lib/scope.js";
import type * as lib_signup from "../lib/signup.js";
import type * as lib_sms from "../lib/sms.js";
import type * as lib_smsTemplates from "../lib/smsTemplates.js";
import type * as lib_smsText from "../lib/smsText.js";
import type * as lib_totp from "../lib/totp.js";
import type * as lib_units from "../lib/units.js";
import type * as lib_validate from "../lib/validate.js";
import type * as loadtest from "../loadtest.js";
import type * as mfa from "../mfa.js";
import type * as migrations from "../migrations.js";
import type * as payments from "../payments.js";
import type * as properties from "../properties.js";
import type * as removals from "../removals.js";
import type * as renters from "../renters.js";
import type * as reports from "../reports.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as smsQueue from "../smsQueue.js";
import type * as smsSend from "../smsSend.js";
import type * as users from "../users.js";
import type * as utilities from "../utilities.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agreements: typeof agreements;
  audit: typeof audit;
  auth: typeof auth;
  backup: typeof backup;
  bank: typeof bank;
  billing: typeof billing;
  crons: typeof crons;
  deposits: typeof deposits;
  files: typeof files;
  http: typeof http;
  imports: typeof imports;
  invites: typeof invites;
  "lib/access": typeof lib_access;
  "lib/billing": typeof lib_billing;
  "lib/bulk": typeof lib_bulk;
  "lib/ethiopianCalendar": typeof lib_ethiopianCalendar;
  "lib/ledger": typeof lib_ledger;
  "lib/money": typeof lib_money;
  "lib/period": typeof lib_period;
  "lib/scope": typeof lib_scope;
  "lib/signup": typeof lib_signup;
  "lib/sms": typeof lib_sms;
  "lib/smsTemplates": typeof lib_smsTemplates;
  "lib/smsText": typeof lib_smsText;
  "lib/totp": typeof lib_totp;
  "lib/units": typeof lib_units;
  "lib/validate": typeof lib_validate;
  loadtest: typeof loadtest;
  mfa: typeof mfa;
  migrations: typeof migrations;
  payments: typeof payments;
  properties: typeof properties;
  removals: typeof removals;
  renters: typeof renters;
  reports: typeof reports;
  seed: typeof seed;
  settings: typeof settings;
  smsQueue: typeof smsQueue;
  smsSend: typeof smsSend;
  users: typeof users;
  utilities: typeof utilities;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
