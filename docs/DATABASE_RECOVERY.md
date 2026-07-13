# Production database recovery

Atmosphere Account's source-of-truth application database is the Railway
Postgres service in the production environment. The attached volume is not, by
itself, a backup.

## Required protection

- Keep Railway daily and weekly volume snapshots enabled, or enable Railway
  Postgres point-in-time recovery (PITR).
- PITR is preferred because a restore creates a sibling Postgres service and
  does not alter the source database.
- Treat the Railway Backups tab as the authoritative schedule and restore-range
  view. Repository configuration cannot currently declare these controls.

## Restore drill

Run at least quarterly and after changing Postgres images or backup policy:

1. Record the source service, volume, current row-count sample, and timestamp.
2. Restore to a new sibling service or staged replacement volume. Never point
   production at it during the drill.
3. Connect read-only and verify schema presence, representative table counts,
   the latest Jetstream cursor, the newest complete `pds_inventory_scan`, and a
   sample login app/host/app listing.
4. Confirm the original service stayed healthy throughout the drill.
5. Delete the disposable restored service/volume after recording the evidence.

For PITR, choose a timestamp several minutes behind current time so WAL replay
is exercised. A successful container start alone is insufficient; the row and
freshness checks above prove that application data was recovered.

## Incident cutover

Do not overwrite the original database first. Restore alongside it, inspect the
recovery point, pause writers if necessary, then change the `Postgres` variable
reference on `web`, `indexer`, and `pds-inventory` together. Run
`deno task smoke:production` and verify the indexer lease before retiring the
old database.
