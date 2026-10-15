# Backup and restore

## What a backup is
`node scripts/backup.mjs` writes two files to `backups/`:

- `dire-mall-<time>.zip`: a full Convex snapshot export (every table and every uploaded file: contracts, evidence, documents).
- `dire-mall-<time>.fingerprint.json`: row counts per table and the money totals (bills, payments by status, allocations, credits, deposits, bank lines), plus a hash of all of it.

The newest 30 are kept (`KEEP=60` to change). `backups/` is git-ignored. **A backup holds personal and financial data**: keep copies encrypted, off the server, with named people only.

## Taking backups
- By hand: `node scripts/backup.mjs` (uses the deployment your Convex CLI points at).
- Production: set `CONVEX_DEPLOY_KEY` to the **production** key in the environment of the machine that runs it, then run the same command. Never commit the key.
- Schedule it: `.github/workflows/backup.yml` runs it every 6 hours and keeps each backup as a GitHub artifact for 14 days. To switch it on, add the repository secret `CONVEX_DEPLOY_KEY` (Settings, Secrets and variables, Actions) holding the production key, then run the workflow once by hand (Actions, Production backup, Run workflow) and check it succeeds. Anyone who can read the repository can download the artifacts, so keep the repository private, limit who has access, and also copy backups to separate encrypted storage.

## Restore drill (do this before go-live, then every quarter)
1. In the Convex dashboard create a **scratch** deployment (not production). Generate a deploy key for it.
2. Run:
   ```
   CONVEX_DEPLOY_KEY=<scratch key> npx convex deploy          # put the same code on the scratch deployment
   CONVEX_DEPLOY_KEY=<scratch key> node scripts/restore-drill.mjs backups/dire-mall-<time>.zip --replace-everything
   ```
3. The script imports the snapshot, takes a new fingerprint and compares it with the one saved at backup time. It prints `Restore check passed` only if every count and every money total is identical. Any difference is listed and the script exits with an error.
4. Record the date, the backup used, how long it took and the result.

`--replace-everything` deletes all data in the target deployment first. The script refuses to run without it, and you should only ever point it at a scratch deployment.

## Restoring for real
Same import, aimed at the deployment that lost data: stop staff from using the app, run `npx convex import --replace-all <zip>` with that deployment's key, then run `npx convex run backup:fingerprint` and compare with the `.fingerprint.json` beside the zip. People signed in before the restore may need to sign in again.

## What this does and does not give you
- Recovery point = the time of the last backup. Daily backups mean up to a day of entries can be lost. The proposal's 15-minute target is **not** met by exports alone; run backups more often (hourly is cheap at this data size) or check what Convex's paid plans offer for continuous backup, and confirm the target with Dire Mall.
- Recovery time depends on size: at about 1,100 rows the export takes seconds. Time the drill with realistic data (the `loadtest:seed` data is about 1,000 units) and write the result down.
- The drill has not yet been run end to end: no scratch deployment exists yet. Until it has been run once with `Restore check passed`, treat restore as untested.
