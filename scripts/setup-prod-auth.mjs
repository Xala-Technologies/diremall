#!/usr/bin/env node
// Sets the sign-in keys and site address on the PRODUCTION Convex deployment.
// Run it yourself, signed in to Convex as a member of the team:
//   node scripts/setup-prod-auth.mjs https://rent.diremall.example you@xala.no
// Add --print to only show what would be set, without touching anything.
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2).filter((a) => a !== "--print");
const printOnly = process.argv.includes("--print");
const [siteUrl, adminEmail] = args;
if (!siteUrl || !/^https:\/\//.test(siteUrl)) {
  console.error("Usage: node scripts/setup-prod-auth.mjs https://your-site-address [first-admin-email] [--print]");
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const vars = {
  JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).trim().replace(/\n/g, " "),
  JWKS: JSON.stringify({ keys: [{ use: "sig", ...publicKey.export({ format: "jwk" }) }] }),
  SITE_URL: siteUrl.replace(/\/$/, ""),
  ...(adminEmail ? { BOOTSTRAP_ADMIN_EMAIL: adminEmail.toLowerCase() } : {}),
};

for (const [name, value] of Object.entries(vars)) {
  if (printOnly) { console.log(`would set ${name} (${value.length} characters)`); continue; }
  // NAME=VALUE form: the private key starts with dashes and would otherwise be read as a flag
  const r = spawnSync("npx", ["convex", "env", "set", "--prod", `${name}=${value}`], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) { console.error(`Failed to set ${name}. Are you signed in (npx convex login) and is the production deployment created?`); process.exit(1); }
}
console.log(printOnly ? "Nothing was changed." : "Production sign-in is configured.");
