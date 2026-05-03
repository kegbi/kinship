# Database Schema: System Platform Tables

Authentication, OAuth, WebAuthn/U2F, cache/session/queue, cron, instance, and aggregate statistics tables.

Each column lists the latest migration source that created or changed it. `Null` is inferred from migration chains; older legacy rows may still violate assumptions before cleanup migrations ran.

## `oauth_access_tokens`

Laravel Passport OAuth access tokens.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_06_01_000002_create_oauth_access_tokens_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `string(100)` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_06_01_000002_create_oauth_access_tokens_table.php#L17) |
| `user_id` | `unsignedBigInteger` | yes | `` | index | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2016_06_01_000002_create_oauth_access_tokens_table.php#L18) |
| `client_id` | `unsignedBigInteger` | no | `` |  | OAuth client foreign key. | [source](../monica-4.x/database/migrations/2016_06_01_000002_create_oauth_access_tokens_table.php#L19) |
| `name` | `string` | yes | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2016_06_01_000002_create_oauth_access_tokens_table.php#L20) |
| `scopes` | `text` | yes | `` |  | OAuth scopes as serialized JSON/text. | [source](../monica-4.x/database/migrations/2016_06_01_000002_create_oauth_access_tokens_table.php#L21) |
| `revoked` | `boolean` | no | `` |  | OAuth flag indicating a token/client/code has been revoked. | [source](../monica-4.x/database/migrations/2016_06_01_000002_create_oauth_access_tokens_table.php#L22) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2016_06_01_000002_create_oauth_access_tokens_table.php#L23) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2016_06_01_000002_create_oauth_access_tokens_table.php#L23) |
| `expires_at` | `dateTime` | yes | `` |  | Expiration datetime. | [source](../monica-4.x/database/migrations/2016_06_01_000002_create_oauth_access_tokens_table.php#L24) |

## `oauth_auth_codes`

Laravel Passport OAuth authorization codes.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_06_01_000001_create_oauth_auth_codes_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `string(100)` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_06_01_000001_create_oauth_auth_codes_table.php#L17) |
| `user_id` | `unsignedBigInteger` | no | `` | index | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2016_06_01_000001_create_oauth_auth_codes_table.php#L18) |
| `client_id` | `unsignedBigInteger` | no | `` |  | OAuth client foreign key. | [source](../monica-4.x/database/migrations/2016_06_01_000001_create_oauth_auth_codes_table.php#L19) |
| `scopes` | `text` | yes | `` |  | OAuth scopes as serialized JSON/text. | [source](../monica-4.x/database/migrations/2016_06_01_000001_create_oauth_auth_codes_table.php#L20) |
| `revoked` | `boolean` | no | `` |  | OAuth flag indicating a token/client/code has been revoked. | [source](../monica-4.x/database/migrations/2016_06_01_000001_create_oauth_auth_codes_table.php#L21) |
| `expires_at` | `dateTime` | yes | `` |  | Expiration datetime. | [source](../monica-4.x/database/migrations/2016_06_01_000001_create_oauth_auth_codes_table.php#L22) |

## `oauth_clients`

Laravel Passport OAuth clients.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_06_01_000004_create_oauth_clients_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `bigIncrements` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_06_01_000004_create_oauth_clients_table.php#L17) |
| `user_id` | `unsignedBigInteger` | yes | `` | index | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2016_06_01_000004_create_oauth_clients_table.php#L18) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2016_06_01_000004_create_oauth_clients_table.php#L19) |
| `secret` | `string(100)` | yes | `` |  | OAuth/shared client secret or encrypted service secret. | [source](../monica-4.x/database/migrations/2020_08_05_184814_upgrade_passport.php#L17) |
| `provider` | `string` | yes | `` |  | OAuth/social auth provider. | [source](../monica-4.x/database/migrations/2020_08_05_184814_upgrade_passport.php#L22) |
| `redirect` | `text` | no | `` |  | OAuth redirect URI list. | [source](../monica-4.x/database/migrations/2016_06_01_000004_create_oauth_clients_table.php#L22) |
| `personal_access_client` | `boolean` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2016_06_01_000004_create_oauth_clients_table.php#L23) |
| `password_client` | `boolean` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2016_06_01_000004_create_oauth_clients_table.php#L24) |
| `revoked` | `boolean` | no | `` |  | OAuth flag indicating a token/client/code has been revoked. | [source](../monica-4.x/database/migrations/2016_06_01_000004_create_oauth_clients_table.php#L25) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2016_06_01_000004_create_oauth_clients_table.php#L26) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2016_06_01_000004_create_oauth_clients_table.php#L26) |

## `oauth_personal_access_clients`

Laravel Passport personal access client registry.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_06_01_000005_create_oauth_personal_access_clients_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `bigIncrements` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_06_01_000005_create_oauth_personal_access_clients_table.php#L17) |
| `client_id` | `unsignedBigInteger` | no | `` |  | OAuth client foreign key. | [source](../monica-4.x/database/migrations/2016_06_01_000005_create_oauth_personal_access_clients_table.php#L18) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2016_06_01_000005_create_oauth_personal_access_clients_table.php#L19) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2016_06_01_000005_create_oauth_personal_access_clients_table.php#L19) |

## `oauth_refresh_tokens`

Laravel Passport refresh tokens.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_06_01_000003_create_oauth_refresh_tokens_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `string(100)` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_06_01_000003_create_oauth_refresh_tokens_table.php#L17) |
| `access_token_id` | `string(100)` | no | `` | index | OAuth access token foreign key. | [source](../monica-4.x/database/migrations/2016_06_01_000003_create_oauth_refresh_tokens_table.php#L18) |
| `revoked` | `boolean` | no | `` |  | OAuth flag indicating a token/client/code has been revoked. | [source](../monica-4.x/database/migrations/2016_06_01_000003_create_oauth_refresh_tokens_table.php#L19) |
| `expires_at` | `dateTime` | yes | `` |  | Expiration datetime. | [source](../monica-4.x/database/migrations/2016_06_01_000003_create_oauth_refresh_tokens_table.php#L20) |

## `webauthn_keys`

WebAuthn/FIDO2 credential records.

Created/last recreated at [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L17) |
| `user_id` | `unsignedInteger` | no | `` | FK -> users.id (cascade) | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L18) |
| `name` | `string` | no | `key` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L20) |
| `credentialId` | `string(255)` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L21) |
| `type` | `string(255)` | no | `` |  | Type/category discriminator string. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L22) |
| `transports` | `text` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L23) |
| `attestationType` | `string(255)` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L24) |
| `trustPath` | `text` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L25) |
| `aaguid` | `text` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L26) |
| `credentialPublicKey` | `text` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L27) |
| `counter` | `integer` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L28) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L29) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L29) |

Foreign keys:
- `user_id` -> `users.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_03_29_163611_add_webauthn.php#L31)).

## `u2f_key`

Legacy U2F key table retained for older installations.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_06_13_000100_create_u2f_key_table.php#L23).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_06_13_000100_create_u2f_key_table.php#L24) |
| `user_id` | `unsigned integer` | no | `` | FK -> users.id, FK -> users.id (cascade) | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2018_06_13_000100_create_u2f_key_table.php#L25) |
| `keyHandle` | `string` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_06_13_000100_create_u2f_key_table.php#L26) |
| `publicKey` | `string` | no | `` | unique | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_06_13_000100_create_u2f_key_table.php#L27) |
| `certificate` | `text` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_06_13_000100_create_u2f_key_table.php#L28) |
| `counter` | `integer` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_06_13_000100_create_u2f_key_table.php#L29) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_06_13_000100_create_u2f_key_table.php#L30) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_06_13_000100_create_u2f_key_table.php#L30) |
| `name` | `string` | no | `key` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2019_01_06_190036_u2f_key_name.php#L17) |

Foreign keys:
- `user_id` -> `users.id`; on delete `not specified` ([source](../monica-4.x/database/migrations/2018_06_13_000100_create_u2f_key_table.php#L34)).
- `user_id` -> `users.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_01_06_135133_update_u2f_key_table.php#L20)).

## `password_resets`

Password reset tokens.

Created/last recreated at [source](../monica-4.x/database/migrations/2014_10_12_100000_create_password_resets_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `email` | `string` | no | `` | index | Email address. | [source](../monica-4.x/database/migrations/2014_10_12_100000_create_password_resets_table.php#L17) |
| `token` | `string` | no | `` | index | Opaque security token or reset token. | [source](../monica-4.x/database/migrations/2014_10_12_100000_create_password_resets_table.php#L18) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2014_10_12_100000_create_password_resets_table.php#L19) |

## `sessions`

Database session store.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_10_19_155800_create_sessions_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `string` | no | `` | unique | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_10_19_155800_create_sessions_table.php#L17) |
| `user_id` | `integer` | yes | `` |  | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2016_10_19_155800_create_sessions_table.php#L18) |
| `ip_address` | `string(45)` | yes | `` |  | IP address captured for sessions, audit/compliance, or API usage. | [source](../monica-4.x/database/migrations/2016_10_19_155800_create_sessions_table.php#L19) |
| `user_agent` | `text` | yes | `` |  | Browser/client user-agent string. | [source](../monica-4.x/database/migrations/2016_10_19_155800_create_sessions_table.php#L20) |
| `payload` | `text` | no | `` |  | Serialized queued job payload. | [source](../monica-4.x/database/migrations/2016_10_19_155800_create_sessions_table.php#L21) |
| `last_activity` | `integer` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2016_10_19_155800_create_sessions_table.php#L22) |

## `cache`

Database cache store.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_10_19_155139_create_cache_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `key` | `string` | no | `` | unique | Stable module/cache/job key depending on table context. | [source](../monica-4.x/database/migrations/2016_10_19_155139_create_cache_table.php#L17) |
| `value` | `text` | no | `` |  | Generic value payload. | [source](../monica-4.x/database/migrations/2016_10_19_155139_create_cache_table.php#L18) |
| `expiration` | `integer` | no | `` |  | Cache expiration timestamp. | [source](../monica-4.x/database/migrations/2016_10_19_155139_create_cache_table.php#L19) |

## `jobs`

Database queue jobs.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_09_10_164406_create_jobs_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `bigIncrements` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_09_10_164406_create_jobs_table.php#L17) |
| `queue` | `string` | no | `` |  | Queue name. | [source](../monica-4.x/database/migrations/2016_09_10_164406_create_jobs_table.php#L18) |
| `payload` | `longText` | no | `` |  | Serialized queued job payload. | [source](../monica-4.x/database/migrations/2016_09_10_164406_create_jobs_table.php#L19) |
| `reserved_at` | `unsignedInteger` | yes | `` |  | Unix timestamp when a queued job was reserved. | [source](../monica-4.x/database/migrations/2016_09_10_164406_create_jobs_table.php#L21) |
| `available_at` | `unsignedInteger` | no | `` |  | Unix timestamp when a queued job becomes available. | [source](../monica-4.x/database/migrations/2016_09_10_164406_create_jobs_table.php#L22) |
| `created_at` | `unsignedInteger` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2016_09_10_164406_create_jobs_table.php#L23) |

## `failed_jobs`

Failed queue job log.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_09_12_014120_create_failed_jobs_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_09_12_014120_create_failed_jobs_table.php#L17) |
| `connection` | `text` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2016_09_12_014120_create_failed_jobs_table.php#L18) |
| `queue` | `text` | no | `` |  | Queue name. | [source](../monica-4.x/database/migrations/2016_09_12_014120_create_failed_jobs_table.php#L19) |
| `payload` | `longText` | no | `` |  | Serialized queued job payload. | [source](../monica-4.x/database/migrations/2016_09_12_014120_create_failed_jobs_table.php#L20) |
| `exception` | `longText` | no | `` |  | Serialized exception text for a failed job. | [source](../monica-4.x/database/migrations/2016_09_12_014120_create_failed_jobs_table.php#L21) |
| `failed_at` | `timestamp` | no | `` |  | Timestamp when a job failed. | [source](../monica-4.x/database/migrations/2016_09_12_014120_create_failed_jobs_table.php#L22) |

## `job_batches`

Laravel queue batch metadata.

Created/last recreated at [source](../monica-4.x/database/migrations/2021_09_27_023405_create_job_batches_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `string` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2021_09_27_023405_create_job_batches_table.php#L17) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2021_09_27_023405_create_job_batches_table.php#L18) |
| `total_jobs` | `integer` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2021_09_27_023405_create_job_batches_table.php#L19) |
| `pending_jobs` | `integer` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2021_09_27_023405_create_job_batches_table.php#L20) |
| `failed_jobs` | `integer` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2021_09_27_023405_create_job_batches_table.php#L21) |
| `failed_job_ids` | `text` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2021_09_27_023405_create_job_batches_table.php#L22) |
| `options` | `mediumText` | yes | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2021_09_27_023405_create_job_batches_table.php#L23) |
| `cancelled_at` | `integer` | yes | `` |  | Timestamp for this table-specific event. | [source](../monica-4.x/database/migrations/2021_09_27_023405_create_job_batches_table.php#L24) |
| `created_at` | `integer` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2021_09_27_023405_create_job_batches_table.php#L25) |
| `finished_at` | `integer` | yes | `` |  | Timestamp for this table-specific event. | [source](../monica-4.x/database/migrations/2021_09_27_023405_create_job_batches_table.php#L26) |

## `crons`

Tracks scheduled command execution metadata.

Created/last recreated at [source](../monica-4.x/database/migrations/2019_05_05_194746_add_cron_schedule.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2019_05_05_194746_add_cron_schedule.php#L17) |
| `command` | `string` | no | `` | unique | Scheduled command name. | [source](../monica-4.x/database/migrations/2019_05_05_194746_add_cron_schedule.php#L18) |
| `last_run` | `timestamp` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2019_05_05_194746_add_cron_schedule.php#L19) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2019_05_05_194746_add_cron_schedule.php#L20) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2019_05_05_194746_add_cron_schedule.php#L20) |

## `instances`

Instance-level metadata and version/check state.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_07_22_153209_create_instance_table.php#L18).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_07_22_153209_create_instance_table.php#L19) |
| `uuid` | `string` | no | `` |  | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2017_07_22_153209_create_instance_table.php#L20) |
| `current_version` | `string` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_07_22_153209_create_instance_table.php#L21) |
| `latest_version` | `string` | yes | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_07_22_153209_create_instance_table.php#L22) |
| `latest_release_notes` | `mediumText` | yes | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_07_22_153209_create_instance_table.php#L23) |
| `number_of_versions_since_current_version` | `integer` | yes | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_07_22_153209_create_instance_table.php#L24) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_07_22_153209_create_instance_table.php#L25) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_07_22_153209_create_instance_table.php#L25) |

## `statistics`

Instance/account aggregate counters used by dashboard/admin/statistics.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_10_21_022941_add_statistics_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_10_21_022941_add_statistics_table.php#L17) |
| `number_of_users` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2016_10_21_022941_add_statistics_table.php#L18) |
| `number_of_contacts` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2016_10_21_022941_add_statistics_table.php#L19) |
| `number_of_notes` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2016_10_21_022941_add_statistics_table.php#L20) |
| `number_of_reminders` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2016_10_21_022941_add_statistics_table.php#L21) |
| `number_of_tasks` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2016_10_21_022941_add_statistics_table.php#L22) |
| `number_of_kids` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2016_10_21_022941_add_statistics_table.php#L23) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2016_10_21_022941_add_statistics_table.php#L24) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2016_10_21_022941_add_statistics_table.php#L24) |
| `number_of_invitations_sent` | `integer` | yes | `` |  | Counter of invitations sent by this account. | [source](../monica-4.x/database/migrations/2017_06_20_121345_add_invitations_statistics.php#L20) |
| `number_of_accounts_with_more_than_one_user` | `integer` | yes | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_06_20_121345_add_invitations_statistics.php#L21) |
| `number_of_import_jobs` | `integer` | yes | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_06_29_211725_add_import_job_to_statistics.php#L16) |
| `number_of_tags` | `integer` | yes | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_07_04_132743_add_tags_to_statistics.php#L16) |
| `number_of_activities` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L17) |
| `number_of_addresses` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L18) |
| `number_of_api_calls` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L19) |
| `number_of_calls` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L20) |
| `number_of_contact_fields` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L21) |
| `number_of_contact_field_types` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L22) |
| `number_of_debts` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L23) |
| `number_of_entries` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L24) |
| `number_of_gifts` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L25) |
| `number_of_oauth_access_tokens` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L26) |
| `number_of_oauth_clients` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L27) |
| `number_of_offsprings` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L28) |
| `number_of_progenitors` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L29) |
| `number_of_relationships` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L30) |
| `number_of_subscriptions` | `integer` | no | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2017_11_27_083043_add_more_statistics.php#L31) |
| `number_of_conversations` | `integer` | yes | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2018_08_29_124804_add_conversations_to_statistics.php#L16) |
| `number_of_messages` | `integer` | yes | `` |  | Denormalized counter used for display/statistics. | [source](../monica-4.x/database/migrations/2018_08_29_124804_add_conversations_to_statistics.php#L17) |
