# Monica 4.x Internals Specification

This folder documents the local `monica-4.x` archive from a data-portability perspective. The generated schema files come from static migration parsing because this machine does not have PHP/Composer dependencies installed, so no live `artisan migrate` schema dump was possible.

## File Map

- [01-architecture.md](01-architecture.md) - application layout, tenant model, domain map, and high-level data flows.
- [02-schema-core-account.md](02-schema-core-account.md) - account, user, billing, import/export, compliance, audit, and currency tables.
- [03-schema-contacts-profile.md](03-schema-contacts-profile.md) - contact/profile, address, contact field, file, DAV, tag, work, and weather tables.
- [04-schema-interactions-journal.md](04-schema-interactions-journal.md) - activities, calls, notes, conversations, debts, gifts, tasks, reminders, journal, life events, relationships, emotions, and pet data.
- [05-schema-system-platform.md](05-schema-system-platform.md) - OAuth, WebAuthn/U2F, sessions, cache, queue, cron, instance, and statistics tables.
- [06-domain-models.md](06-domain-models.md) - extracted Eloquent model relationships.
- [07-api-surface.md](07-api-surface.md) - public API, authenticated API, web route groups, and DAV endpoints.
- [08-files-jobs-external-services.md](08-files-jobs-external-services.md) - storage layout, imports/exports, queue jobs, scheduled commands, and external services.
- [09-import-compatibility-and-recommendations.md](09-import-compatibility-and-recommendations.md) - SQL backup compatibility notes and recommendations for a replacement app.
- [schema.json](schema.json) - machine-readable schema inventory with columns, inferred types, keys, descriptions, and source links.
- [_generate_schema_docs.py](_generate_schema_docs.py) - repeatable static extractor used to regenerate schema and model relationship docs.

## Scope Notes

The physical database has a long migration history. Some tables are current application data, some are Laravel platform tables, and some are old compatibility tables retained for installations that migrated over time. The SQL export code is not a complete dump of every final column, so a replacement importer should support both Monica's exported SQL format and raw database backups.
