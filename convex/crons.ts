import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("queue due reminders", { hourUTC: 5, minuteUTC: 0 }, internal.smsQueue.queueDueReminders, {});
crons.daily("queue expiry warnings", { hourUTC: 5, minuteUTC: 10 }, internal.smsQueue.queueExpiryWarnings, {});
crons.daily("expire agreements", { hourUTC: 21, minuteUTC: 0 }, internal.smsQueue.expireAgreements, {});
crons.daily("refresh unit status", { hourUTC: 21, minuteUTC: 5 }, internal.smsQueue.refreshUnits, {});
crons.interval("send queued sms", { minutes: 5 }, internal.smsSend.dispatch, {});
export default crons;
