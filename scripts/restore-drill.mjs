// Restore drill: load a backup into a SCRATCH deployment and prove the figures still match.
//   CONVEX_DEPLOY_KEY=<scratch deployment key> node scripts/restore-drill.mjs backups/dire-mall-....zip --replace-everything
//
// This DELETES everything in the deployment the key points at and replaces it with the backup.
// Point it at a scratch deployment, never production. Without --replace-everything it only explains.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const [zip, flag] = process.argv.slice(2);
if (!zip || !existsSync(zip)) { console.error("Usage: node scripts/restore-drill.mjs <backup.zip> --replace-everything"); process.exit(2); }
const sidecar = zip.replace(/\.zip$/, ".fingerprint.json");
if (!existsSync(sidecar)) { console.error(`Missing ${sidecar}: it holds the figures to compare against.`); process.exit(2); }
if (flag !== "--replace-everything") {
  console.error("Refusing: this replaces ALL data in the target deployment. Re-run with --replace-everything on a scratch deployment.");
  process.exit(2);
}
const run = (args) => execFileSync("npx", ["convex", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });

console.log("Importing…");
run(["import", "--replace-all", "--yes", zip]);
const after = JSON.parse(run(["run", "backup:fingerprint"]).trim().replace(/^[^{]*/, ""));
const before = JSON.parse(readFileSync(sidecar, "utf8"));

let bad = 0;
for (const sec of ["counts", "totals"]) {
  for (const k of new Set([...Object.keys(before[sec]), ...Object.keys(after[sec])])) {
    if (before[sec][k] !== after[sec][k]) { bad++; console.log(`MISMATCH ${sec}.${k}: backup ${before[sec][k]} restored ${after[sec][k]}`); }
  }
}
if (bad || before.hash !== after.hash) { console.error(`Restore check FAILED (${bad} differences).`); process.exit(1); }
console.log(`Restore check passed: ${Object.values(after.counts).reduce((a, b) => a + b, 0)} rows and every money total match (${after.hash.slice(0, 12)}).`);
