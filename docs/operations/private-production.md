# Private Production Operations

This runbook is for the owner-operated `private-production` environment: one
workspace, one steady user, and bursts of at most three users. The deployment
provider and credentials are supplied outside this repository. CRM content and
secret values must never be pasted into commands, tickets, or logs.

## Before Every Release

1. Confirm the deployment secret store is reachable by the owner and that its
   audit/history view contains no unexpected access.
2. Confirm the recovery archive location is encrypted at rest and its key is
   independently recoverable. Set the three `PRIVATE_PRODUCTION_*` confirmation
   variables only for the preflight invocation; they are attestations, not key
   material.
3. Supply the deployment configuration and secret variables listed by
   `docs/planning/private-production-profile.json`. Run:

   ```text
   deno task ops preflight
   ```

   Continue only when the single JSON result has `"state":"ready"` and an empty
   `issues` array. A blocked result names a safe issue code and corrective
   action without reflecting the rejected value.
4. Run the owning release gates once: formatting, lint, type/static checks,
   contracts, production coverage, schema matrix, production image build, and
   the three-browser cataloged flows. Do not promote a retry-only browser pass.
5. Stop API and worker writes. Verify no process can mutate PostgreSQL or object
   storage, then set `PRIVATE_PRODUCTION_WRITES_QUIESCED=true` for this command:

   ```text
   deno task ops recovery backup <utc-release-archive-id>
   ```

   Continue only on exit zero. Keep the archive on the encrypted recovery
   boundary, apply 30-day retention, and unset the quiescence confirmation.
6. Record the release revision and archive ID in the deployment provider's
   release history. Neither is a secret; do not record connection details.

## Release And Abort

Use the Dokploy procedure below after the checks above, with API and worker
writes stopped during migration. Resume writes only after migrate exits zero and
gateway readiness is healthy.

### Dokploy: kinship.homelaboss.com

The GitHub source uses `compose.dokploy.yaml` as a standalone Compose file. It
extends the six base services and adds a preflight, a private RustFS service,
and a one-shot bucket/user initializer. Retain the same Dokploy Compose project
name on every rollout: its PostgreSQL and object named volumes are durable. Do
not use `down --volumes`, Docker prune, or a fresh project name to redeploy.

Configure the domain with HTTPS and Let's Encrypt, targeting `gateway:8080`.
Only gateway joins external `dokploy-network`; API, renderer, database, and
storage have no public ports. The inherited gateway TLS listener on loopback
8443 remains available. The gateway trusts `X-Forwarded-For` only from the
Traefik address in `GATEWAY_TRUSTED_PROXY` (AUD-G4): the gateway image renders
its reviewed `gateway/dokploy-proxy.conf` template with that one value, and no
file mount is involved. Set it in `runtime.env` to the exact address Traefik
uses on `dokploy-network` (observed as `10.0.1.40`; confirm it with
`docker inspect` on the Traefik container), and reverify it whenever the proxy
is recreated. It has no default: Compose refuses to render without it, and the
preflight refuses anything but one exact IPv4 or IPv6 address, so a Docker
subnet, a hostname, or a list never reaches nginx. An old
`../files/dokploy-proxy.conf` file mount is no longer read; remove it.

Use Dokploy File Mounts for `../files/runtime.env`, `../files/ca.crt`,
`../files/gateway.crt`, `../files/gateway.key`,
`../files/storage/rustfs_cert.pem`, and `../files/storage/rustfs_key.pem`. Give
the non-root service users read access to their mounted certificates and keys.
The private storage certificate must include DNS SAN `kinship-storage`. API and
worker use `DENO_CERT` to trust the private CA; neither disables certificate
verification. Keep private keys and the independently recoverable CA key outside
source control.

`runtime.env` supplies the generated PostgreSQL/authentication/storage values,
`APP_ENV=production`, `PUBLIC_WEB_ORIGIN=https://kinship.homelaboss.com`,
`OBJECT_STORAGE_HOST=kinship-storage`, `OBJECT_STORAGE_PORT=9000`,
`OBJECT_STORAGE_USE_SSL=true`, the two gateway certificate paths above, and
`GATEWAY_TRUSTED_PROXY`. Keep the owner's SMTP variables in Dokploy's existing
service environment (`.env`), including explicit `SMTP_PORT` and
`SMTP_SECURITY=tls`; Compose refuses missing or empty values so preflight and
both mail-sending processes receive the same settings. Project variables are not
implicitly inherited. Do not print either environment file or resolved
`docker compose config` output.

In the service checkout, use this exact argument order, replacing only the
project placeholder with the existing Dokploy project name:

```text
docker compose -p <existing-project> --project-directory . --env-file ../files/runtime.env --env-file .env -f compose.dokploy.yaml up -d --build --remove-orphans
```

Dokploy's custom command uses the same arguments after its Docker executable.
Dokploy first adds the reviewed domain labels to `compose.dokploy.yaml` in
place; use that converted file. Do not bypass domain conversion with another
unlabelled Compose file. The environment files supply interpolation only;
containers retain explicit per-service variable lists.

For updates, first stop writers with the same Compose prefix and
`stop api
worker`. Take the required quiesced backup, select the reviewed Git
revision in Dokploy, and deploy. Preflight must exit zero before migrations or
storage provisioning proceed. API and worker wait for both successful migration
and storage initialization; web and gateway retain their readiness dependencies.
The initializer uses checksum-pinned official `mc` tooling only in its separate
image, reads administrator secrets from environment and new-user secrets from
stdin, and suppresses tool diagnostics. It creates the named bucket and a
separate application identity with only bucket-scoped object/list permissions.
Root storage credentials never reach API or worker. Re-running initialization
with unchanged credentials is safe; credential rotation needs the independent
rotation procedure, including retirement of the old user.

After deployment, inspect service exit/health states, then run:

```text
deno task ops probe https://kinship.homelaboss.com
```

Verify HTTPS and that the edge negotiates HTTP/2
(`curl -sS -o /dev/null -w '%{http_version}' https://kinship.homelaboss.com/`
prints `2`; see the Gateway Hardening section of the Compose contract), public
authentication links, sign-in/MFA, one person read, one attachment
upload/read/delete, authenticated SMTP delivery, a worker reminder cycle, and
DAV only if enabled. Verify unauthenticated file access is denied. These are
operational acceptance checks, not claims that deployment has passed.

The first release that names the session cookie `__Host-kinship_session`
(AUD-K4) signs every browser out once, because the unprefixed cookie is no
longer read over HTTPS; expect one sign-in per browser after it. Rolling back
past that release signs browsers out once more.

For an application-only rollback with unchanged schema compatibility, stop API
and worker, select the last healthy reviewed Git revision, retain the same
project/volumes/secrets, and deploy with the command above. Rerun preflight and
the post-deployment checks before accepting rollback. Never downgrade the schema
in place. If a release changed persisted data incompatibly, keep writes stopped
and use the isolated restore procedure before promoting a compatible revision.
Retain the failed revision and safe failure codes in Dokploy release history.

### Temporary owner-authorized backup exception

The initial deployment to `kinship.homelaboss.com` has an explicit temporary
owner waiver while an external encrypted recovery destination is unavailable.
Set `KINSHIP_ALLOW_NO_BACKUP=true` only for that authorized period, and set
`PRIVATE_PRODUCTION_SECRET_STORE_READY=true` only after verifying the actual
Dokploy secret store. Leave both archive attestations false. The deployment
preflight prints the original `state: blocked` result and a distinct
`operator.backup_waiver` event with `productionAccepted: false`; it continues
only if `archive-encryption` is the sole issue. Every other preflight failure
still blocks deployment. The ordinary `deno task ops preflight` remains blocked.

This exception does not prove backups, restore, RPO/RTO, rollback, or Phase 11
acceptance. A named volume is not a recovery archive. A destructive or
incompatible-data release has no restore path until backup is available and must
not proceed under this exception. Provision the encrypted external destination,
independently recover its key, complete backup and isolated restore, then remove
the waiver and require ordinary preflight readiness.

Abort before resuming writes when any of these occurs:

- preflight is blocked or emits malformed/non-redacted output;
- the backup command is non-zero, exceeds the four-hour RTO, or reports an
  archive older than the 24-hour RPO;
- migration, image, readiness, probe, or required browser smoke is non-zero;
- database/object reconciliation reports a missing or extra object;
- a secret, CRM value, credentialed URL, raw query value, or private object key
  appears in operator output;
- the deployed revision, schema version, origin, or object bucket differs from
  the approved release input.

On abort, keep writes stopped, retain the failed deployment logs for at most 30
days, and follow the recovery section. Never run a production data reset.

## Readiness And Local Logs

Run the external HTTPS probe from outside the deployment network:

```text
deno task ops probe https://<public-origin>
```

One healthy response is ready. Three consecutive failures one minute apart are
an incident. Inspect only local structured gateway, API, renderer, worker, and
migration logs. Retain them for 30 days. Search by time, release, normalized
route, status, and safe trace/operation reference; do not enable third-party
telemetry or add CRM identifiers to labels.

## Incident Actions

1. Stop further rollout and note the first failing time, release revision,
   service, safe trace reference, and observable impact.
2. If integrity or credential compromise is possible, stop API and worker writes
   immediately. Otherwise keep the last healthy revision serving while diagnosis
   proceeds.
3. Classify the affected boundary: gateway/TLS, API/auth, PostgreSQL, object
   storage, SMTP, DAV, worker delivery, or recovery archive.
4. Preserve only redacted local logs. Do not preserve request bodies, cookies,
   authorization headers, database URLs, object keys, mail content, or free-form
   CRM errors.
5. Restore into an empty isolated database and object endpoint using the same
   bucket name. The archive keeps schema v14's owners and grants (ADR 0008), so
   first create the roles on the target server with `deno task ops bootstrap`
   (its superuser `DATABASE_URL` and the three `POSTGRES_*_PASSWORD` values).
   Set `PRIVATE_PRODUCTION_ISOLATED_TARGET=true` only for:

   ```text
   deno task ops recovery restore <last-valid-archive-id>
   ```

6. Promote a restored target only when the command exits zero, canonical v10
   verification passes, object reconciliation is exact, and RPO/RTO are met.
   Otherwise discard only that isolated target and try the prior valid archive.
7. After service recovers, verify gateway readiness, sign-in/MFA, one ordinary
   person read, one worker reminder cycle, one file read, mail delivery, and DAV
   only when enabled. Revoke temporary incident access.

For suspected disclosure, rotate the affected credential first, revoke the old
credential, terminate affected sessions where applicable, and inspect local logs
for misuse. Personal data disclosure or loss requires the owner to assess
applicable notification obligations before deleting incident records.

## Secret And Key Rotation

The machine-consumed secret inventory, owner, rotation order, and recovery
dependency live in `docs/planning/private-production-profile.json`. General
rules for every entry are:

1. Create the replacement without revoking the active value.
2. For versioned keysets, add a new active key and retain the prior key for
   decryption/verification. For provider credentials, create a second scoped
   identity when supported.
3. Update the deployment secret store, rerun preflight, restart only affected
   services, then verify the affected boundary.
4. Revoke or remove the old value only after verification and the documented
   overlap window. A failed check restores the previous secret version and
   aborts rotation.
5. Verify recovery of the new value or keyset from a location independent of the
   application host. Record only the rotation date and owner, never the value.

Imported Monica credentials, MFA seeds, recovery codes, sessions, and DAV
secrets are application data, not deployment credentials. They must never be
activated by copying them into the deployment secret store.

## Scheduled Owner Work

- Daily: quiesce writes, create one recovery archive, confirm exit zero, then
  resume writes. Remove only archives older than 30 days after confirming a
  newer valid archive exists.
- After every release: run the HTTPS probe and the post-deploy checks named in
  OPS-001E.
- Monthly: restore the newest archive into an isolated target and verify exact
  database/object reconciliation within four hours.
- At key/provider rotation: follow the per-secret inventory and recovery check
  before retiring old material.
