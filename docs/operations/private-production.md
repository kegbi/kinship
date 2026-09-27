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

OPS-001E supplies the deployment-provider-specific rollout and rollback
commands. Apply those commands only after the checks above, with API and worker
writes still stopped during migration. Resume writes only after migrate exits
zero and gateway readiness is healthy.

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
   bucket name. Set `PRIVATE_PRODUCTION_ISOLATED_TARGET=true` only for:

   ```text
   deno task ops recovery restore <last-valid-archive-id>
   ```

6. Promote a restored target only when the command exits zero, canonical v8
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
