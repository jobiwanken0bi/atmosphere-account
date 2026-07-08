# Atmosphere Host Account Routing v0.1

Atmosphere Account should be a thin router for account management. The primary
account-management surface is the PDS-owned account page the host publishes, not
an Atmosphere-owned dashboard.

PDS hosts remain responsible for passwords, app grants, sessions, devices,
rotation keys, repo/blob exports, backups, restores, and migrations. Atmosphere
provides host discovery, friendly naming, account selection history, docs,
conformance tests, and a route from the user's Atmosphere account page to
host-owned controls. Atmosphere does not implement the PDS account-management
tools itself.

For a PDS service endpoint like `https://pds.example`, `/account` is the
recommended convention when the host supports the reference account-management
surface:

```txt
https://pds.example/account
```

A host should publish an explicit account-management URL in
`account.atmosphere.host.service` once the destination is known to work.

## Host Service Record

The routing source of truth is the host service record:

```json
{
  "host": "host.example",
  "displayName": "Example Host",
  "serviceEndpoint": "https://pds.host.example",
  "accountManagementUrl": "https://pds.host.example/account",
  "signup": {
    "status": "account.atmosphere.host.defs#signupOpen",
    "url": "https://host.example/signup"
  },
  "createdAt": "2026-06-26T00:00:00.000Z"
}
```

If `accountManagementUrl` is omitted, Atmosphere does not show a direct
host-management button. The host homepage remains a marketing or support link;
it is not used as an account-management fallback.

## Optional Compatibility Manifest

Hosts that want to expose richer compatibility metadata can publish a JSON
manifest at:

```txt
https://host.example/.well-known/atmosphere-host-dashboard.json
```

The `dashboard` name is legacy. This file describes optional compatibility
metadata and deep links; it is not the account-management surface and does not
delegate PDS controls to Atmosphere.

Minimal example:

```json
{
  "version": "atmosphere.hostDashboard.v0.1",
  "host": "host.example",
  "displayName": "Example Host",
  "dashboardUrl": "https://pds.example/account",
  "supportUrl": "https://host.example/support",
  "capabilities": {
    "accountOverview": {
      "state": "supported",
      "href": "https://host.example/account"
    },
    "connectedApps": {
      "state": "supported",
      "href": "https://host.example/account/apps"
    },
    "password": {
      "state": "host_owned",
      "href": "https://host.example/account/security"
    },
    "repoExport": {
      "state": "planned"
    }
  }
}
```

This manifest is not required before Atmosphere can link users to a host's
published account page URL. It should not be used to mirror PDS-owned controls
inside Atmosphere. An example file is available at
`/examples/atmosphere-host-dashboard.example.json`; the JSON schema is available
at `/atmosphere-host-dashboard.schema.json`.

Capability states:

- `supported`: this host supports the standardized route or module.
- `host_owned`: this host owns the workflow, but it is not yet standardized.
- `planned`: Atmosphere expects this to become a standard capability later.
- `unknown`: capability status is not known.

## Capabilities

The v0.1 capability keys are:

- `accountOverview`
- `connectedApps`
- `devices`
- `password`
- `rotationKeys`
- `repoExport`
- `blobExport`
- `backupStatus`
- `restore`
- `migration`
- `support`

Hosts may implement them gradually. Atmosphere must show unsupported or unknown
states honestly and should not imply it can perform host-owned actions.

## Atmosphere Account Page Behavior

Atmosphere `/account` should:

- show the current account, avatar, handle, and friendly host name,
- provide one primary "Manage account at host" route when the host publishes a
  working account page URL,
- show Atmosphere Login picker connections,
- show remembered accounts for this browser,
- hide technical identifiers behind disclosure UI,
- never render first-party controls for PDS OAuth grant revocation, devices,
  passwords, keys, recovery, backup, account deletion, or migration.

Atmosphere-specific sections may include picker connections, saved browser
accounts, developer app registrations, app listings, and reviews. They should be
visibly separate from host-owned account controls.

## Conformance Direction

The first optional manifest conformance slice is available now:

```sh
deno task host:dashboard:check host.example
deno task host:dashboard:check ./static/examples/atmosphere-host-dashboard.example.json --host=host.example
```

The public validator endpoint can validate a published manifest:

```txt
GET /api/hosts/dashboard/validate?host=host.example
GET /api/hosts/dashboard/validate?url=https://host.example/.well-known/atmosphere-host-dashboard.json
```

It can also validate a JSON body directly:

```txt
POST /api/hosts/dashboard/validate?host=host.example
```

The next build cycles should add:

- a mock PDS host,
- a CLI conformance runner,
- host directory badges only after tests pass,
- account-route checks that confirm the published account-management URL is
  reachable.
