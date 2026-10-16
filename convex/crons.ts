import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("queue due reminders", { hourUTC: 5, minuteUTC: 0 }, internal.smsQueue.queueDueReminders, {});
crons.daily("queue expiry warnings", { hourUTC: 5, minuteUTC: 10 }, internal.smsQueue.queueExpiryWarnings, {});
// hourly, so a lease that ends or starts at midnight is reflected on the unit board within the hour, not the next day
crons.interval("expire agreements", { hours: 1 }, internal.smsQueue.expireAgreements, {});
crons.interval("refresh unit status", { hours: 1 }, internal.smsQueue.refreshUnits, {});
crons.interval("send queued sms", { minutes: 5 }, internal.smsSend.dispatch, {});
export default crons;
