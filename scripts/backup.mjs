// Daily backup: a full export (data and uploaded files) plus a fingerprint to check a restore against.
//   node scripts/backup.mjs                 backs up the deployment the Convex CLI points at
//   KEEP=60 node scripts/backup.mjs         keep the newest 60 backups (default 30)
// For production set CONVEX_DEPLOY_KEY (the production key) in the environment first. Never commit that key.
// Backups contain personal and financial data: store them encrypted, off the server, with limited access.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.BACKUP_DIR || "backups";
const keep = Number(process.env.KEEP || 30);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const run = (args) => execFileSync("npx", ["convex", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });

mkdirSync(dir, { recursive: true });
const fp = JSON.parse(run(["run", "backup:fingerprint"]).trim().replace(/^[^{]*/, ""));
const zip = join(dir, `dire-mall-${stamp}.zip`);
run(["export", "--include-file-storage", "--path", zip]);
writeFileSync(zip.replace(/\.zip$/, ".fingerprint.json"), JSON.stringify(fp, null, 2));
console.log(`Backup written: ${zip}\nFingerprint: ${fp.hash}\nRows: ${Object.values(fp.counts).reduce((a, b) => a + b, 0)}`);

// keep the newest backups only
const old = readdirSync(dir).filter((f) => /^dire-mall-.*\.zip$/.test(f)).sort().slice(0, -keep);
for (const f of old) { rmSync(join(dir, f)); rmSync(join(dir, f.replace(/\.zip$/, ".fingerprint.json")), { force: true }); console.log(`Removed old backup ${f}`); }
