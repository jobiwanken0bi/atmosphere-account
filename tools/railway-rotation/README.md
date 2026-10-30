# Railway credential rotation

Permanent operator tool for all Railway projects. DNS migration stays **on hold**.
Run from your own interactive terminal:

```sh
python3 /Users/joebasser/Cursor/atmosphere-account/tools/railway-rotation/rotate-secrets.py
```

Each invocation handles one credential group and stops. Re-run the same command
after deployment to verify the replacement. Only type `COMPLETE` after the
affected feature works and the old credential has been revoked at its issuer.
The next invocation selects the next ready group. Blank secret input cancels
the whole group before any write; Ctrl-C stops and preserves previous receipts.

```sh
python3 /Users/joebasser/Cursor/atmosphere-account/tools/railway-rotation/rotate-secrets.py --status
python3 /Users/joebasser/Cursor/atmosphere-account/tools/railway-rotation/rotate-secrets.py --list
```

## Storage and recovery

Source code and tests live in this directory. Inventory, progress, and receipts
live in `state/`, which is Git-ignored, owner-only (`0700` directory, `0600`
files), and survives normal temporary-directory cleanup. Back up this entire
directory using your normal encrypted computer backup. No raw credential values
are saved here. Receipts contain target IDs, timestamps, deployment IDs, status,
and high-entropy API-key fingerprints used for runtime comparison.

No secret belongs in a command argument, chat, `.env` file, log, or tracked file.
Paste only its value into the hidden prompt, without quotes or `NAME=`. Input
requires a TTY and core dumps are disabled. Requests with secret values use
stdin, captured output, and redacted errors. Railway CLI sign-in provides access;
ambient `RAILWAY_TOKEN` and `RAILWAY_API_TOKEN` overrides are ignored.

The restored history did not include the old temporary receipts. Earlier work
is not assumed complete. Audit steps retain historical/deleted credentials and
external consumers for review.

## Inventory

The initial inventory command reads all currently accessible projects,
environments, shared variables, services, and project-token metadata:

```sh
python3 /Users/joebasser/Cursor/atmosphere-account/tools/railway-rotation/refresh-inventory.py
```

During inspection, existing values are held only in memory. Saved output
contains names, references, secret paths, and opaque same-value group IDs, never
raw values or password hashes. Unclassified settings, historical/deleted
credentials, registry credentials, audit activity, and external consumers remain
explicit review tasks. A failed/partial inventory blocks rotation. Refresh is
refused after rotation progress exists, preventing silent receipt loss or a
change to a reviewed consumer plan.

The 15 known provider procedures are definitions, not a completeness claim.
Additional shared copies, nested JSON credentials, reference sources, missing
targets, and unhealthy deployments require review before those procedures run.

## Verification and limits

Provider replacements update only listed existing variables. Credential pairs
are written together per service. Writes are recorded before requests; ambiguous
outcomes stop for reconciliation and are never retried automatically. A receipt
for a replacement blocks a second paste of that group. Successful deployment
alone is insufficient: the helper requires a new successful deployment and a
matching runtime fingerprint, then an owner-attested feature check and issuer
revocation. Provider validation is automatic for Stripe account/mode and the
moderation Railway project-token scope; other provider checks remain explicit.

The script cannot create every provider's key or revoke every old key. Use the
provider link shown by the tool, and keep the overlap as short as verification
requires. For evidence of active misuse, stop and prioritize immediate revocation;
accept a short outage rather than continuing to use a compromised credential.
Never roll back to an exposed credential.

Postgres/Redis steps are inventoried but gated until every reference, pasted URL,
and external consumer has been reviewed. Supported incident rotation is Railway
Database → Config → Connection → Regenerate, followed by redeploying all clients.
Changing only a password variable does not rotate the database. The current Deno
deployment and other outside clients must be included. Encryption, identity,
session, webhook, and coordinated service secrets each need their own procedure;
they are tracked as incomplete and cannot be silently skipped or marked done.

The tool does not start recurring jobs. After incident cleanup, tested provider
procedures can be scheduled individually with separate scoped access and alerts.

## Offline verification

```sh
python3 tools/railway-rotation/test-replacement-helper.py
python3 tools/railway-rotation/test-incident-workflow.py
python3 tools/railway-rotation/test-durable-storage.py
```

No infrastructure or DNS mutation occurs in these tests. Independent Claude
approval is required before merging source changes, per the owner's AGENTS.md.
