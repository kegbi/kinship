# Files, Jobs, And External Services

## Filesystem Model

Monica stores file metadata in SQL and file bytes in Laravel storage disks. The default disk is `FILESYSTEM_DISK`, falling back to the legacy `DEFAULT_FILESYSTEM`, then `public` ([config/filesystems.php](../monica-4.x/config/filesystems.php#L17)). Supported configured disks are `local`, `public`, and `s3` ([config/filesystems.php](../monica-4.x/config/filesystems.php#L32)). Storage visibility defaults to private, with authenticated proxy delivery through Monica ([config/filesystems.php](../monica-4.x/config/filesystems.php#L66)).

Main file folders:

| Folder | SQL metadata | Writer | Notes |
|---|---|---|---|
| `photos/` | `photos`, `contact_photo`, `gift_photo`, `contacts.avatar_photo_id` | `App\Services\Account\Photo\UploadPhoto` | Accepts uploaded image files or base64/data-url image data. Stores generated path in `photos.new_filename` ([source](../monica-4.x/app/Services/Account/Photo/UploadPhoto.php#L74)). |
| `documents/` | `documents` | `App\Services\Contact\Document\UploadDocument` | Stores arbitrary uploaded files with size, extension, MIME type, original name, and generated path ([source](../monica-4.x/app/Services/Contact/Document/UploadDocument.php#L48)). |
| `avatars/` | `contacts.avatar_*`, optional `photos` | avatar services/jobs | Generated/default/uploaded avatars are referenced from contact avatar columns. |
| `temp/` | none or `export_jobs` while running | export/import jobs | SQL/JSON export services first write local temp files before moving them to configured storage ([source](../monica-4.x/app/Jobs/ExportAccount.php#L58)). |
| `exports/` | `export_jobs` | `App\Jobs\ExportAccount` | Final SQL/JSON exports are stored on the configured filesystem and downloaded by export job UUID. |

`StorageController` authorizes file downloads by checking that the requested `avatars`, `photos`, or `documents` path belongs to the authenticated user's account, then streams the file from the configured disk ([source](../monica-4.x/app/Http/Controllers/StorageController.php#L28)).

## Export Pipeline

Export is web-only, under `/settings/export*`. `Settings\ExportController` creates an `export_jobs` row and dispatches `ExportAccount` for SQL or JSON ([source](../monica-4.x/app/Http/Controllers/Settings/ExportController.php#L33)). `ExportAccount` chooses `SqlExportAccount` or `JsonExportAccount`, writes a temp file, moves it to the configured disk, updates `export_jobs.location` and `export_jobs.filename`, then marks the job done ([source](../monica-4.x/app/Jobs/ExportAccount.php#L48)).

SQL export is hard-coded table-by-table in `SqlExportAccount`. It uses `INSERT IGNORE` statements filtered by `account_id`, disables foreign key checks around the export, and writes only selected columns ([source](../monica-4.x/app/Services/Account/Settings/SqlExportAccount.php#L60)). JSON export serializes through `App\ExportResources\Account\Account` and nested export resources, with version metadata and UUID-based references ([source](../monica-4.x/app/Services/Account/Settings/JsonExportAccount.php#L47)).

Important export limitation: the SQL export list is not identical to the final schema. For example, final CardDAV fields such as `contacts.address_book_id`, `contacts.vcard`, and `contacts.distant_etag` exist in migrations, while the SQL exporter uses an older hard-coded contact column list ([source](../monica-4.x/app/Services/Account/Settings/SqlExportAccount.php#L450)). A compatibility importer should accept Monica SQL exports, raw SQL backups, and JSON exports as different input profiles.

## Import Pipeline

The user-facing import feature focuses on vCard. Import data creates `import_jobs` and `import_job_reports`, stores uploaded file metadata, and dispatches vCard/contact import jobs. The relevant classes are:

- `App\Console\Commands\ImportVCards`, `ImportCSV`, `ImportAccounts` for CLI import paths.
- `App\Jobs\AddContactFromVCard` for queued vCard contact creation.
- `App\Services\VCard\ImportVCard` and `ExportVCard` for vCard mapping.
- `App\Services\DavClient\*` for CardDAV subscription synchronization.

For a new app, Monica's SQL export should be treated as a transport format, not the only canonical representation. Raw database backups may include data not reachable from the export UI.

## Queue Jobs

Laravel queue support is configured for `sync`, `database`, `beanstalkd`, `sqs`, and `redis`, defaulting to `QUEUE_CONNECTION` or legacy `QUEUE_DRIVER` ([config/queue.php](../monica-4.x/config/queue.php#L16)). Database queues use `jobs`, `failed_jobs`, and `job_batches`.

Important job classes:

| Job | Purpose |
|---|---|
| `ExportAccount` | Generate SQL/JSON export and update `export_jobs`. |
| `AddContactFromVCard` | Import a contact from vCard data. |
| `GetGPSCoordinate` | Geocode a `places` row. |
| `GetWeatherInformation` | Fetch weather for a geocoded place. |
| `SynchronizeAddressBooks` | Synchronize remote CardDAV address books. |
| `Dav\GetVCard`, `PushVCard`, `UpdateVCard`, `DeleteVCard` | Remote DAV object operations. |
| `Reminder\NotifyUserAboutReminder` | Send reminder notifications. |
| `StayInTouch\ScheduleStayInTouch` | Schedule stay-in-touch reminders. |
| `Avatars\*` | Generate/update/move default, Gravatar, and uploaded avatars. |
| `AuditLog\LogAccountAudit` | Write audit log entries asynchronously. |

## Scheduled Commands

The Laravel scheduler is defined in `app/Console/Kernel.php`. Monica wraps scheduled commands through `CronEvent`, storing command run state in `crons` so commands run only when due ([source](../monica-4.x/app/Console/Kernel.php#L35)).

| Frequency | Command | Data affected |
|---|---|---|
| Daily | `queue:prune-batches` | `job_batches` cleanup. |
| Hourly | `send:reminders` | `reminder_outbox`, notifications/email. |
| Hourly | `send:stay_in_touch` | contacts with stay-in-touch settings and reminder scheduling. |
| Hourly | `monica:davclients` | `addressbook_subscriptions`, contacts/vCard sync. |
| Daily | `monica:calculatestatistics` | `statistics`, denormalized counters. |
| Daily | `monica:ping` | version ping to Monica server when enabled. |
| Daily | `monica:clean` | cleanup of temporary/expired records. |
| Weekly | `monica:updategravatars` | contact avatar/Gravatar cache. |
| Daily | `model:prune` | Eloquent prunable records. |

## External Services And Config

| Service | Purpose | Config/source |
|---|---|---|
| Stripe / Laravel Cashier | Paid plan billing, subscriptions, payment methods, invoices | `services.stripe` ([source](../monica-4.x/config/services.php#L32)), `cashier.php`, `accounts`, `subscriptions`, `subscription_items`. |
| Mailgun/Postmark/SES/SMTP/sendmail | Email delivery for auth, reminders, invitations, exports, notifications | `mail.php` and `services.php` ([source](../monica-4.x/config/mail.php#L14)). |
| S3-compatible storage | Optional storage backend for photos, documents, exports | `filesystems.s3` ([source](../monica-4.x/config/filesystems.php#L43)). |
| Redis/Memcached/database cache | Cache, queue, session infrastructure | `database.php`, `cache.php`, `queue.php`. |
| Laravel Passport | OAuth2 and personal access tokens | OAuth tables and `passport.php`. |
| WebAuthn / Google2FA | MFA using FIDO2/WebAuthn, legacy U2F, and TOTP | `webauthn.php`, `google2fa.php`, `webauthn_keys`, `u2f_key`, `users.google2fa_secret`. |
| LaravelSabre / SabreDAV | CardDAV and CalDAV server | `laravelsabre.php`, `DAVServiceProvider` ([source](../monica-4.x/app/Providers/DAVServiceProvider.php#L87)). |
| LocationIQ | Geocoding addresses to latitude/longitude | `LOCATION_IQ_API_KEY`, `LOCATIONIQ_URL`; service builds `/search.php` query ([source](../monica-4.x/app/Services/Instance/Geolocalization/GetGPSCoordinate.php#L62)). |
| WeatherAPI | Weather JSON for geocoded places | `WEATHERAPI_KEY`, `WEATHERAPI_URL`; service writes `weather.weather_json` ([source](../monica-4.x/app/Services/Instance/Weather/GetWeatherInformation.php#L71)). |
| Gravatar | Avatar lookup from contact email | `GetGravatarURL` checks existence and returns Gravatar URL ([source](../monica-4.x/app/Services/Contact/Avatar/GetGravatarURL.php#L27)). |
| Adorable Avatars | Legacy generated avatar URL scheme | `GetAdorableAvatarURL` returns `{size}/{uuid}.png` ([source](../monica-4.x/app/Services/Contact/Avatar/GetAdorableAvatarURL.php#L24)). |
| Sentry | Error reporting, breadcrumbs, optional PII/tracing | `sentry.php` ([source](../monica-4.x/config/sentry.php#L3)). |
| Version server | Optional version ping | `weekly_ping_server_url` in `config/monica.php` ([source](../monica-4.x/config/monica.php#L57)). |

## Data Retention Implications

- File bytes are not embedded in SQL exports. A migration/import tool needs both the SQL/JSON export and the storage disk contents if users expect documents/photos/avatars to continue working.
- The database only knows generated storage paths and original filenames. Missing files should be surfaced as broken attachments, not fatal import failures.
- For privacy-first replacement architecture, Stripe, Sentry, LocationIQ, WeatherAPI, Gravatar, and version ping should all be optional adapters with explicit user/instance consent.
