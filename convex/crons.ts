import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("queue due reminders", { hourUTC: 5, minuteUTC: 0 }, internal.smsQueue.remindersForAll, {});
crons.daily("queue expiry warnings", { hourUTC: 5, minuteUTC: 10 }, internal.smsQueue.expiryWarningsForAll, {});
// hourly, so a lease that ends or starts at midnight is reflected on the unit board within the hour, not the next day
crons.interval("lease and unit status", { hours: 1 }, internal.smsQueue.statusForAll, {});
crons.interval("send queued sms", { minutes: 5 }, internal.smsSend.dispatch, {});
export default crons;
