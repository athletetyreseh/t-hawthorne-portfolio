# Visitor Badge Desk

This is the source for the desk at `https://t-hawthorne.com/badges`. The roster, individual badge pages, checkout and badge-specific return are public. History, spreadsheets, visitor details, owner assignments and ID photos require Cloudflare Access **and** an owner or a `badge_desk` permission in the portfolio's private workspace. The Pages Function checks the signed Access JWT; a browser header or an authenticated account without a grant is not enough. A person who has a badge URL can check out or return that badge.

The 13 printable QR codes use the production domain. Existing printed labels still contain their old URLs; print and replace those labels after the new desk has been verified.

## Photo retention

A photo is optional and becomes inaccessible 72 hours after its checkout, even if cleanup is delayed. The separately deployed retention Worker runs every five minutes to delete expired objects and clear their photo references. Scheduling and service delays can mean physical deletion occurs a little after the 72-hour cutoff. The private R2 bucket **must also have a 3-day object-expiration lifecycle rule**; it removes orphan uploads when an upload or database operation fails. Do not use the photo bucket for anything else. Checkout history remains after photos are deleted.

## Build and local preview

The portfolio's Pages project currently uses a blank build command and serves `portfolio-site/`. `functions/_shared/badge-desk.generated.js` is intentionally checked in, so Pages can compile the Functions without changing that configuration. It contains only source assets and the empty Excel template, never visitor data. After any badge source or artwork change:

```sh
python3 -m venv /tmp/badge-build
/tmp/badge-build/bin/pip install -r badge-desk/requirements-build.txt
/tmp/badge-build/bin/python badge-desk/scripts/build.py
/tmp/badge-build/bin/python badge-desk/scripts/build.py --check
npm run test:badge-desk
node badge-desk/scripts/preview.mjs --port 4188
```

Preview data is in memory and disappears on exit. Set `BADGE_LOCAL_ADMIN=1` only for a local preview of history; it is not a production authentication mechanism. Node 24 or newer is needed for the preview and test adapter. The code shipped to Cloudflare does not use that adapter. The desktop and mobile checkout, return, print layout, and spreadsheet have been checked locally; physical print fit and scanner testing must still be done on the actual printer and badges.

## Cloudflare setup before switching traffic

These steps require access to the existing Cloudflare account. **Do not merge or activate this feature until the resources, retention, Access paths and data migration are ready.** Keep existing portfolio settings and bindings intact.

1. Create a dedicated D1 database, for example `visitor-badge-desk`, and a dedicated private R2 bucket, for example `visitor-badge-desk-id-photos`. Disable public access to the bucket. In the bucket's lifecycle settings, configure expiration of all objects **3 days after upload**, including orphan objects. Verify the rule is enabled.
2. Add a D1 binding named `DB` and an R2 binding named `BUCKET` to the Pages project without changing `SCHEDULER_DB` or `LIFE_MANAGER_PHOTOS`. When `wrangler.jsonc` is the authoritative Pages configuration, append entries like these using the actual D1 ID and bucket name (do not replace the existing arrays):

   ```json
   { "binding": "DB", "database_name": "visitor-badge-desk", "database_id": "ACTUAL_D1_ID", "migrations_dir": "badge-desk/drizzle" }
   { "binding": "BUCKET", "bucket_name": "visitor-badge-desk-id-photos" }
   ```

   Add the first object to `d1_databases` and the second to `r2_buckets`. Configure separate preview bindings or leave them unbound so branch previews cannot alter production checkout data.
3. Apply the three D1 migrations in order, including the partial unique index and rate-limit table. With the D1 configuration above and an authenticated Wrangler installation:

   ```sh
   npx wrangler d1 migrations apply visitor-badge-desk --remote
   ```

4. Copy `badge-desk/retention.wrangler.jsonc.example` to `badge-desk/retention.wrangler.jsonc`, fill in the real database ID and bucket name, and deploy the separate Worker:

   ```sh
   npx wrangler deploy --config badge-desk/retention.wrangler.jsonc
   ```

   Confirm the `*/5 * * * *` Cron Trigger appears in Cloudflare and check Worker logs after a scheduled run. Test with an expired test photo: the object should be deleted and its row's `photo_key` cleared, while an unexpired test photo remains. The generated local retention configuration is ignored by Git.
5. In Cloudflare Zero Trust, create a self-hosted Access application covering the exact paths `/badges/history`, `/badges/api/history`, `/badges/api/history.xlsx`, and `/badges/api/record/*` (including the history path's descendant wildcard if the dashboard requires it). Use an Allow policy, not Bypass. Append its audience tag to the existing comma-separated `CF_ACCESS_AUD`, preserving all existing tags. Keep `CF_ACCESS_TEAM_DOMAIN` and `OWNER_EMAIL` configured, and never enable `SCHEDULER_DEV_BYPASS` in production. The public `/badges`, `/badges/b/*`, `/badges/api/status`, and `/badges/api/badge/*` routes must remain outside the Access application.
6. In `/private/admin/`, grant `Visitor Badge Desk` view or edit permission to the relevant staff. View permits history and photo access; edit also permits private owner/record changes. The owner has access automatically. Confirm an authenticated account without this grant gets 403.
7. Migrate and verify existing records using the procedure below. Then deploy through the portfolio's normal GitHub/Pages workflow. Before allowing live visitor data, check anonymous 401/403 on history, Excel, ID-photo and record endpoints; verify the Activity Log opens the Access sign-in flow; test all public checkouts and returns; check the retention Worker and R2 rule; and verify unrelated portfolio routes.
8. Print with US Letter, actual size/100%, and background colors enabled. Confirm the ruler is one inch, each cutout is 2.65 × 1.80 inches, and scan all 13 physical codes. Check both WAB phone numbers and that **CALL** and badge numbers are red.

The desk also applies an atomic D1-backed limit of 40 public writes per IP per five minutes. Public writes require same-origin requests and bounded request bodies. The stored rate-limit key is a hash, not the raw IP address. Uploads are restricted to JPEG data under 2 MB, and the database prevents two simultaneous active checkouts for the same badge.

## Migration without putting visitor data in Git

A new D1 database and bucket start empty. Keep the old desk available until migration and verification are complete. Stop checkouts on the old desk during the final export, transfer and verification, so new changes are not lost. Export every `checkouts` row from the old desk's Sites database viewer or an authorized Sites database read into a private JSON file containing a `rows` array. Include `id`, `badge`, `first_name`, `last_name`, `phone`, `photo_key`, `checked_out_at`, `returned_at`, and `owner`, including nulls. Obtain any unexpired original R2 objects into a private directory using authorized account access. Never place the JSON, SQL, visitor data or photos inside this repository.

Prepare an import outside the repository (add `--photos-dir /private/path/to/photos` if there are unexpired photos):

```sh
python3 badge-desk/migration/prepare_import.py \
  --source /private/path/checkouts.json \
  --sql /private/path/import.sql \
  --manifest /private/path/photos.json
```

The helper validates IDs, badge names, timestamps, duplicate active badges and photo mappings. It preserves record IDs, UTC timestamps, status and owners. Photos 72 hours old or older are intentionally excluded under the retention policy. Upload each unexpired object from the private photo manifest to the new private bucket under its original key, then execute the generated SQL against the empty new database using authenticated Wrangler:

```sh
npx wrangler d1 execute visitor-badge-desk --remote --file /private/path/import.sql
```

Check total and active counts, compare IDs and owners, verify every unexpired photo is accessible only to authorized staff, and verify expired photos are unavailable. Recheck the old desk for any changes before switching. Securely remove temporary exports when no longer needed. The workbook export alone is not a complete migration source: it deliberately excludes record IDs and image files, and editing it does not update the website.
