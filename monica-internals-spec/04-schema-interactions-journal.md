# Database Schema: Interactions, Journal, Relationships

Interaction and relationship tables: activities, calls, notes, conversations, gifts, tasks, reminders, journal, life events, special dates, relationship graph, emotions, and pets.

Each column lists the latest migration source that created or changed it. `Null` is inferred from migration chains; older legacy rows may still violate assumptions before cleanup migrations ran.

## `activities`

Shared account activity/interactions that can involve multiple contacts and appear in the journal.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_11_01_014353_create_activities_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_11_01_014353_create_activities_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_01_11_142944_add_foreign_keys_to_activities.php#L34) |
| `activity_type_id` | `unsignedInteger` | yes | `` | FK -> activity_types.id (set null) | Foreign key to `activity_types`. | [source](../monica-4.x/database/migrations/2019_01_11_142944_add_foreign_keys_to_activities.php#L35) |
| `description` | `longText` | yes | `` |  | Longer description or note text for this row. | [source](../monica-4.x/database/migrations/2016_11_01_014353_create_activities_table.php#L21) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2016_11_01_014353_create_activities_table.php#L25) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2016_11_01_014353_create_activities_table.php#L25) |
| `summary` | `string` | no | `` |  | Short activity summary. | [source](../monica-4.x/database/migrations/2017_05_04_185921_add_title_to_activities.php#L17) |
| `happened_at` | `date` | no | `` |  | When an activity or life event occurred. | [source](../monica-4.x/database/migrations/2019_01_11_183717_change_activities_date_type.php#L21) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_01_11_142944_add_foreign_keys_to_activities.php#L36)).
- `activity_type_id` -> `activity_types.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_01_11_142944_add_foreign_keys_to_activities.php#L37)).

## `activity_contact`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_10_19_134816_create_activity_contact_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `activity_id` | `unsignedInteger` | no | `` | FK -> activities.id (cascade) | Foreign key to `activities`. | [source](../monica-4.x/database/migrations/2017_10_19_134816_create_activity_contact_table.php#L17) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2017_10_19_134816_create_activity_contact_table.php#L18) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_01_11_142944_add_foreign_keys_to_activities.php#L54) |

Foreign keys:
- `activity_id` -> `activities.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2017_10_19_134816_create_activity_contact_table.php#L20)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2017_10_19_134816_create_activity_contact_table.php#L21)).
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_01_11_142944_add_foreign_keys_to_activities.php#L55)).

## `activity_statistics`

Yearly per-contact denormalized activity counts.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_01_31_025849_add_activity_statistics_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_01_31_025849_add_activity_statistics_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L150) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L151) |
| `year` | `integer` | no | `` |  | Calendar year for a statistic row. | [source](../monica-4.x/database/migrations/2017_01_31_025849_add_activity_statistics_table.php#L20) |
| `count` | `integer` | no | `` |  | Aggregate count. | [source](../monica-4.x/database/migrations/2017_01_31_025849_add_activity_statistics_table.php#L21) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_01_31_025849_add_activity_statistics_table.php#L22) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_01_31_025849_add_activity_statistics_table.php#L22) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L152)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L153)).

## `activity_type_categories`

Per-account grouping for activity types.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L193).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L194) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L195) |
| `name` | `string` | yes | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L196) |
| `translation_key` | `string` | yes | `` |  | Translation key for default labels instead of raw text. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L197) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L198) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L198) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L199)).

## `activity_types`

Per-account activity type definitions.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L202).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L203) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L204) |
| `activity_type_category_id` | `unsignedInteger` | no | `` | FK -> activity_type_categories.id (cascade) | Foreign key to `activity_type_categories`. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L205) |
| `name` | `string` | yes | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L206) |
| `translation_key` | `string` | yes | `` |  | Translation key for default labels instead of raw text. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L207) |
| `location_type` | `string` | yes | `` |  | Activity type location behavior/category. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L208) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L209) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L209) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L210)).
- `activity_type_category_id` -> `activity_type_categories.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L211)).

## `default_activity_type_categories`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L18).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L19) |
| `translation_key` | `string` | no | `` |  | Translation key for default labels instead of raw text. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L20) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L21) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L21) |

## `default_activity_types`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L24).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L25) |
| `default_activity_type_category_id` | `integer` | no | `` |  | Foreign key/reference id for `default_activity_type_category` in this table's domain. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L26) |
| `translation_key` | `string` | no | `` |  | Translation key for default labels instead of raw text. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L27) |
| `location_type` | `string` | no | `` |  | Activity type location behavior/category. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L28) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L29) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_07_03_204220_create_default_activity_type_groups_table.php#L29) |

## `calls`

Logged phone/communication calls with a contact and optional emotions.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_07_12_014244_create_calls_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_07_12_014244_create_calls_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L170) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L171) |
| `called_at` | `dateTime` | no | `` |  | Datetime of a logged call. | [source](../monica-4.x/database/migrations/2017_07_12_014244_create_calls_table.php#L20) |
| `content` | `mediumText` | yes | `` |  | Message or call content. | [source](../monica-4.x/database/migrations/2017_07_12_014244_create_calls_table.php#L21) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_07_12_014244_create_calls_table.php#L22) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_07_12_014244_create_calls_table.php#L22) |
| `contact_called` | `boolean` | no | `false` |  | Whether the contact called the user or the user called the contact. | [source](../monica-4.x/database/migrations/2018_12_08_233140_add_who_called_to_calls.php#L17) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L172)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L173)).

## `emotion_call`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_12_09_145956_create_emotion_call_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_12_09_145956_create_emotion_call_table.php#L17) |
| `call_id` | `unsignedInteger` | no | `` | FK -> calls.id (cascade) | Foreign key/reference id for `call` in this table's domain. | [source](../monica-4.x/database/migrations/2018_12_09_145956_create_emotion_call_table.php#L18) |
| `emotion_id` | `unsignedInteger` | no | `` | FK -> emotions.id (cascade) | Foreign key to `emotions`. | [source](../monica-4.x/database/migrations/2018_12_09_145956_create_emotion_call_table.php#L19) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2018_12_09_145956_create_emotion_call_table.php#L20) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_12_09_145956_create_emotion_call_table.php#L21) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_12_09_145956_create_emotion_call_table.php#L21) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_09_145956_create_emotion_call_table.php#L22)).
- `call_id` -> `calls.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_09_145956_create_emotion_call_table.php#L23)).
- `emotion_id` -> `emotions.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_09_145956_create_emotion_call_table.php#L24)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_09_145956_create_emotion_call_table.php#L25)).

## `emotion_activity`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2019_01_22_034555_create_emotion_activity_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_01_22_034555_create_emotion_activity_table.php#L17) |
| `activity_id` | `unsignedInteger` | no | `` | FK -> activities.id (cascade) | Foreign key to `activities`. | [source](../monica-4.x/database/migrations/2019_01_22_034555_create_emotion_activity_table.php#L18) |
| `emotion_id` | `unsignedInteger` | no | `` | FK -> emotions.id (cascade) | Foreign key to `emotions`. | [source](../monica-4.x/database/migrations/2019_01_22_034555_create_emotion_activity_table.php#L19) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2019_01_22_034555_create_emotion_activity_table.php#L20) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2019_01_22_034555_create_emotion_activity_table.php#L20) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_01_22_034555_create_emotion_activity_table.php#L21)).
- `activity_id` -> `activities.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_01_22_034555_create_emotion_activity_table.php#L22)).
- `emotion_id` -> `emotions.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_01_22_034555_create_emotion_activity_table.php#L23)).

## `emotions`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L31).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L32) |
| `emotion_primary_id` | `unsignedInteger` | no | `` | FK -> emotions_primary.id (cascade) | Foreign key to `emotions_primary`. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L33) |
| `emotion_secondary_id` | `unsignedInteger` | no | `` | FK -> emotions_secondary.id (cascade) | Foreign key to `emotions_secondary`. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L34) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L35) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L36) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L36) |

Foreign keys:
- `emotion_primary_id` -> `emotions_primary.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L37)).
- `emotion_secondary_id` -> `emotions_secondary.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L38)).

## `emotions_primary`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L17).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L18) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L19) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L20) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L20) |

## `emotions_secondary`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L23).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L24) |
| `emotion_primary_id` | `unsignedInteger` | no | `` | FK -> emotions_primary.id (cascade) | Foreign key to `emotions_primary`. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L25) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L26) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L27) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L27) |

Foreign keys:
- `emotion_primary_id` -> `emotions_primary.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_09_023232_add_emotions_table.php#L28)).

## `notes`

Free-form notes attached to contacts, with favorite support.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_06_30_185050_create_notes_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_06_30_185050_create_notes_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L408) |
| `body` | `mediumText` | no | `` |  | Main note/body text. | [source](../monica-4.x/database/migrations/2016_06_30_185050_create_notes_table.php#L22) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2016_06_30_185050_create_notes_table.php#L29) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2016_06_30_185050_create_notes_table.php#L29) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L409) |
| `is_favorited` | `boolean` | no | `0` |  | Boolean/status flag used by UI and services. | [source](../monica-4.x/database/migrations/2017_12_01_113748_update_notes.php#L17) |
| `favorited_at` | `date` | yes | `` |  | Timestamp for this table-specific event. | [source](../monica-4.x/database/migrations/2017_12_01_113748_update_notes.php#L18) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L410)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L411)).

## `conversations`

Messaging thread with a contact, usually through a contact field type/channel.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L18) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L19) |
| `contact_field_type_id` | `unsignedInteger` | no | `` | FK -> contact_field_types.id (cascade) | Foreign key to `contact_field_types`. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L20) |
| `happened_at` | `datetime` | no | `` |  | When an activity or life event occurred. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L21) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L22) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L22) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L23)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L24)).
- `contact_field_type_id` -> `contact_field_types.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L25)).

## `messages`

Individual messages inside conversations.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L28).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L29) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L30) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L31) |
| `conversation_id` | `unsignedInteger` | no | `` | FK -> conversations.id (cascade) | Foreign key to `conversations`. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L32) |
| `content` | `longText` | no | `` |  | Message or call content. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L33) |
| `written_at` | `datetime` | no | `` |  | Datetime when a message was written. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L34) |
| `written_by_me` | `boolean` | no | `` |  | Boolean indicating the message author is the Monica user. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L35) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L36) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L36) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `conversation_id` -> `conversations.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L37)).
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L38)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_07_26_104306_create-conversations.php#L39)).

## `debts`

Money owed by or to contacts.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_05_30_023116_create_money_table.php#L15).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_05_30_023116_create_money_table.php#L16) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L237) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L238) |
| `in_debt` | `string` | no | `no` |  | Direction flag: whether the contact owes the user or the user owes the contact. | [source](../monica-4.x/database/migrations/2017_05_30_023116_create_money_table.php#L19) |
| `status` | `string` | no | `inprogress` |  | State string; meaning depends on table, e.g. gift or export status. | [source](../monica-4.x/database/migrations/2017_05_30_023116_create_money_table.php#L20) |
| `amount` | `integer(13,2)` | no | `` |  | Money amount stored in decimal form after currency migration. | [source](../monica-4.x/database/migrations/2020_04_24_212138_update_amount_format.php#L54) |
| `reason` | `longText` | yes | `` |  | Reason for a debt or breakup, depending on table context. | [source](../monica-4.x/database/migrations/2017_05_30_023116_create_money_table.php#L22) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_05_30_023116_create_money_table.php#L23) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_05_30_023116_create_money_table.php#L23) |
| `currency_id` | `unsignedInteger` | yes | `` | FK -> currencies.id (set null) | Foreign key to `currencies`; default currency for user or money row. | [source](../monica-4.x/database/migrations/2020_04_24_212138_update_amount_format.php#L30) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L239)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L240)).
- `currency_id` -> `currencies.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2020_04_24_212138_update_amount_format.php#L31)).

## `gifts`

Gift ideas, offered gifts, and received gifts for contacts.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_12_13_133945_add_gifts_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_12_13_133945_add_gifts_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L291) |
| `url` | `longText` | yes | `` |  | External URL. | [source](../monica-4.x/database/migrations/2016_12_13_133945_add_gifts_table.php#L24) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2016_12_13_133945_add_gifts_table.php#L29) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2016_12_13_133945_add_gifts_table.php#L29) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2017_02_05_041740_change_gifts_table.php#L17) |
| `comment` | `longText` | yes | `` |  | User-entered comment or annotation. | [source](../monica-4.x/database/migrations/2017_02_05_041740_change_gifts_table.php#L18) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L292) |
| `is_for` | `unsignedInteger` | yes | `` | FK -> contacts.id (set null) | Boolean/status flag used by UI and services. | [source](../monica-4.x/database/migrations/2019_12_21_100315_change_gift_status.php#L47) |
| `status` | `string(8)` | no | `idea` |  | State string; meaning depends on table, e.g. gift or export status. | [source](../monica-4.x/database/migrations/2019_12_21_100315_change_gift_status.php#L48) |
| `date` | `datetime` | yes | `` |  | Generic date/date-time interpreted by the table context. | [source](../monica-4.x/database/migrations/2019_12_21_100315_change_gift_status.php#L49) |
| `currency_id` | `unsignedInteger` | yes | `` | FK -> currencies.id (set null) | Foreign key to `currencies`; default currency for user or money row. | [source](../monica-4.x/database/migrations/2020_04_24_212138_update_amount_format.php#L61) |
| `amount` | `integer` | yes | `` |  | Money amount stored in decimal form after currency migration. | [source](../monica-4.x/database/migrations/2020_04_24_212138_update_amount_format.php#L87) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L293)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L294)).
- `is_for` -> `contacts.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_12_21_100315_change_gift_status.php#L51)).
- `currency_id` -> `currencies.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2020_04_24_212138_update_amount_format.php#L62)).

## `gift_photo`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2019_12_21_194559_add_photo_gift.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `photo_id` | `unsignedInteger` | no | `` | FK -> photos.id (cascade) | Foreign key/reference id for `photo` in this table's domain. | [source](../monica-4.x/database/migrations/2019_12_21_194559_add_photo_gift.php#L17) |
| `gift_id` | `unsignedInteger` | no | `` | FK -> gifts.id (cascade) | Foreign key/reference id for `gift` in this table's domain. | [source](../monica-4.x/database/migrations/2019_12_21_194559_add_photo_gift.php#L18) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2019_12_21_194559_add_photo_gift.php#L19) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2019_12_21_194559_add_photo_gift.php#L19) |

Foreign keys:
- `photo_id` -> `photos.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_21_194559_add_photo_gift.php#L21)).
- `gift_id` -> `gifts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_21_194559_add_photo_gift.php#L22)).

## `tasks`

Tasks that may be account-wide or attached to a contact; exported to CalDAV VTODO.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_06_28_191025_create_tasks_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_06_28_191025_create_tasks_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L561) |
| `title` | `string` | no | `` |  | Title or short user-facing label. | [source](../monica-4.x/database/migrations/2016_06_28_191025_create_tasks_table.php#L20) |
| `description` | `longText` | yes | `` |  | Longer description or note text for this row. | [source](../monica-4.x/database/migrations/2016_06_28_191025_create_tasks_table.php#L21) |
| `completed_at` | `dateTime` | yes | `` |  | Datetime when a task was completed. | [source](../monica-4.x/database/migrations/2016_06_28_191025_create_tasks_table.php#L23) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2016_06_28_191025_create_tasks_table.php#L25) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2016_06_28_191025_create_tasks_table.php#L25) |
| `contact_id` | `unsignedInteger` | yes | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L562) |
| `completed` | `boolean` | no | `0` |  | Boolean task completion flag. | [source](../monica-4.x/database/migrations/2017_11_27_202857_change_tasks_table_structure.php#L18) |
| `uuid` | `uuid` | yes | `` |  | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2019_01_18_142032_add_dav_uuid.php#L24) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L563)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L564)).

## `reminders`

Recurring or one-off reminders about contacts/special dates.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L111).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L112) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_01_05_202557_add_foreign_keys_to_reminder.php#L34) |
| `title` | `string(60000)` | yes | `` |  | Title or short user-facing label. | [source](../monica-4.x/database/migrations/2016_12_28_150831_change_title_column.php#L16) |
| `description` | `longText` | yes | `` |  | Longer description or note text for this row. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L116) |
| `frequency_type` | `string` | no | `` |  | Reminder recurrence unit such as day/week/month/year. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L117) |
| `frequency_number` | `integer` | yes | `` |  | Reminder recurrence interval. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L118) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L122) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L122) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2019_01_05_202557_add_foreign_keys_to_reminder.php#L35) |
| `initial_date` | `date` | no | `` |  | First/anchor date for a reminder recurrence. | [source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L19) |
| `delible` | `boolean` | no | `true` |  | Whether the user may delete the row. Monica uses the misspelled column name. | [source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L20) |
| `inactive` | `boolean` | no | `false` |  | Reminder disabled flag. | [source](../monica-4.x/database/migrations/2019_01_06_150143_add_inactive_flag_to_reminders.php#L17) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_01_05_202557_add_foreign_keys_to_reminder.php#L36)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_01_05_202557_add_foreign_keys_to_reminder.php#L37)).

## `reminder_rules`

Per-account notification lead-time rules.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L41).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L42) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_01_05_202748_add_foreign_key_to_reminder_rule.php#L35) |
| `number_of_days_before` | `integer` | no | `` |  | Lead time in days for reminder notifications. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L44) |
| `active` | `boolean` | no | `true` |  | Boolean active flag. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L45) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L46) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L46) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_01_05_202748_add_foreign_key_to_reminder_rule.php#L36)).

## `reminder_outbox`

Scheduled reminder notifications generated from reminders and rules.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L41).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L42) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L43) |
| `reminder_id` | `unsignedInteger` | no | `` | FK -> reminders.id (cascade) | Foreign key to `reminders`. | [source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L44) |
| `user_id` | `unsignedInteger` | no | `` | FK -> users.id (cascade) | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L45) |
| `planned_date` | `date` | no | `` |  | Date/time a reminder notification is planned to be sent. | [source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L46) |
| `nature` | `string` | no | `reminder` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L47) |
| `notification_number_days_before` | `integer` | yes | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L48) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L49) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L49) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L50)).
- `reminder_id` -> `reminders.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L51)).
- `user_id` -> `users.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_22_200413_add_reminder_initial_date_to_reminders.php#L52)).

## `reminders_sent`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L28).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L29) |
| `account_id` | `integer` | no | `` |  | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L30) |
| `contact_id` | `integer` | no | `` |  | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L31) |
| `reminder_id` | `integer` | yes | `` |  | Foreign key to `reminders`. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L32) |
| `title` | `mediumText` | no | `` |  | Title or short user-facing label. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L33) |
| `description` | `longText` | no | `` |  | Longer description or note text for this row. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L34) |
| `html_sent_content` | `longText` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L35) |
| `sent_date` | `datetime` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L36) |
| `scheduled_number_days_before` | `integer` | yes | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L37) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L38) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L38) |

## `journal_entries`

Polymorphic journal timeline linking days, entries, and activities.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L25).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L26) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L373) |
| `date` | `dateTime` | no | `` |  | Generic date/date-time interpreted by the table context. | [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L28) |
| `journalable_id` | `integer` | no | `` |  | Polymorphic id for the object represented in the journal. | [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L29) |
| `journalable_type` | `string` | no | `` |  | Polymorphic class name for the object represented in the journal. | [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L30) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L31) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L31) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L374)).

## `entries`

Manual journal text entries.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_02_12_134220_create_entries_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_02_12_134220_create_entries_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L256) |
| `title` | `string` | yes | `` |  | Title or short user-facing label. | [source](../monica-4.x/database/migrations/2017_02_12_134220_create_entries_table.php#L19) |
| `post` | `longText` | no | `` |  | Journal entry text content. | [source](../monica-4.x/database/migrations/2017_02_12_134220_create_entries_table.php#L20) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_02_12_134220_create_entries_table.php#L21) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_02_12_134220_create_entries_table.php#L21) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L257)).

## `days`

Daily mood/rating records in the journal.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L219) |
| `date` | `date` | no | `` |  | Generic date/date-time interpreted by the table context. | [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L19) |
| `rate` | `integer` | no | `` |  | Daily journal rating value. | [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L20) |
| `comment` | `mediumText` | yes | `` |  | User-entered comment or annotation. | [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L21) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L22) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_12_13_115857_create_day_table.php#L22) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L220)).

## `life_event_categories`

Per-account groupings for life event types.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L43).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L44) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L45) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L46) |
| `default_life_event_category_key` | `string` | yes | `` |  | Default value/key copied or used when creating account data. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L47) |
| `core_monica_data` | `boolean` | no | `0` |  | Marks default/seeded rows that came from Monica rather than custom user-created rows. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L48) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L49) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L49) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L50)).

## `life_event_types`

Per-account life-event type definitions; can carry JSON schemas for specific fields.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L53).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L54) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L55) |
| `life_event_category_id` | `unsignedInteger` | no | `` | FK -> life_event_categories.id (cascade) | Foreign key to `life_event_categories`. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L56) |
| `name` | `string` | yes | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2020_05_31_091556_custom_life_event_types.php#L18) |
| `default_life_event_type_key` | `string` | yes | `` |  | Default value/key copied or used when creating account data. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L58) |
| `core_monica_data` | `boolean` | no | `0` |  | Marks default/seeded rows that came from Monica rather than custom user-created rows. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L59) |
| `specific_information_structure` | `text` | yes | `` |  | JSON schema/structure describing life-event type-specific fields. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L60) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L61) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L61) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L62)).
- `life_event_category_id` -> `life_event_categories.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L63)).

## `life_events`

Timeline events for a contact, optionally tied to a reminder and with JSON details.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L66).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L67) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L68) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L69) |
| `life_event_type_id` | `unsignedInteger` | no | `` | FK -> life_event_types.id (cascade) | Foreign key to `life_event_types`. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L70) |
| `name` | `string` | yes | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L71) |
| `note` | `mediumText` | yes | `` |  | Free-text note attached to this event. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L72) |
| `happened_at` | `dateTime` | no | `` |  | When an activity or life event occurred. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L73) |
| `happened_at_month_unknown` | `boolean` | no | `false` |  | Whether the life-event month is intentionally unknown. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L74) |
| `happened_at_day_unknown` | `boolean` | no | `false` |  | Whether the life-event day is intentionally unknown. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L75) |
| `specific_information` | `text` | yes | `` |  | JSON payload for type-specific life-event details. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L76) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L77) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L77) |
| `reminder_id` | `unsignedInteger` | yes | `` | FK -> reminders.id (set null) | Foreign key to `reminders`. | [source](../monica-4.x/database/migrations/2019_01_05_203201_add_foreign_key_for_reminder_in_life-events_table.php#L35) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L78)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L79)).
- `life_event_type_id` -> `life_event_types.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L80)).
- `reminder_id` -> `reminders.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_01_05_203201_add_foreign_key_for_reminder_in_life-events_table.php#L36)).

## `default_life_event_categories`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L19).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L20) |
| `translation_key` | `string` | no | `` |  | Translation key for default labels instead of raw text. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L21) |
| `migrated` | `boolean` | no | `0` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L22) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L23) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L23) |

## `default_life_event_types`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L26).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L27) |
| `default_life_event_category_id` | `unsignedInteger` | no | `` | FK -> default_life_event_categories.id (cascade) | Foreign key/reference id for `default_life_event_category` in this table's domain. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L28) |
| `translation_key` | `string` | no | `` |  | Translation key for default labels instead of raw text. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L29) |
| `specific_information_structure` | `text` | yes | `` |  | JSON schema/structure describing life-event type-specific fields. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L30) |
| `migrated` | `boolean` | no | `0` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L31) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L32) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L32) |

Foreign keys:
- `default_life_event_category_id` -> `default_life_event_categories.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_08_31_020908_create_life_events_table.php#L33)).

## `special_dates`

Normalized contact dates such as birthdays, first-met date, and deceased date.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_12_04_164831_create_ages_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_12_04_164831_create_ages_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L521) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L522) |
| `is_age_based` | `boolean` | no | `0` |  | Whether a special date is age/birthday-like. | [source](../monica-4.x/database/migrations/2017_12_04_164831_create_ages_table.php#L20) |
| `is_year_unknown` | `boolean` | no | `0` |  | Whether the year component of a special date is unknown. | [source](../monica-4.x/database/migrations/2017_12_04_164831_create_ages_table.php#L21) |
| `date` | `date` | no | `` |  | Generic date/date-time interpreted by the table context. | [source](../monica-4.x/database/migrations/2017_12_04_164831_create_ages_table.php#L22) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_12_04_164831_create_ages_table.php#L24) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_12_04_164831_create_ages_table.php#L24) |
| `uuid` | `uuid` | yes | `` |  | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2019_01_18_142032_add_dav_uuid.php#L20) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L523)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L524)).

## `relationship_type_groups`

Per-account relationship category groups.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L45).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L46) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L457) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L48) |
| `delible` | `boolean` | no | `0` |  | Whether the user may delete the row. Monica uses the misspelled column name. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L49) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L50) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L50) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L458)).

## `relationship_types`

Directional relationship labels; stores forward and reverse names.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L35).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L36) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L475) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L38) |
| `name_reverse_relationship` | `string` | no | `` |  | Label to show when traversing relationship in reverse. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L39) |
| `relationship_type_group_id` | `unsignedInteger` | no | `` | FK -> relationship_type_groups.id (cascade) | Foreign key to `relationship_type_groups`. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L476) |
| `delible` | `boolean` | no | `0` |  | Whether the user may delete the row. Monica uses the misspelled column name. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L41) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L42) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L42) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L477)).
- `relationship_type_group_id` -> `relationship_type_groups.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L478)).

## `relationships`

Directional edge from one contact to another through a relationship type.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L53).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L54) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L497) |
| `relationship_type_id` | `unsignedInteger` | no | `` | FK -> relationship_types.id (cascade) | Foreign key to `relationship_types`. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L498) |
| `contact_is` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Subject contact in a directional relationship edge. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L499) |
| `of_contact` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Object contact in a directional relationship edge. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L500) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L60) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L60) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L501)).
- `relationship_type_id` -> `relationship_types.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L502)).
- `contact_is` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L503)).
- `of_contact` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L504)).

## `default_relationship_type_groups`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L17) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L18) |
| `delible` | `boolean` | no | `0` |  | Whether the user may delete the row. Monica uses the misspelled column name. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L19) |
| `migrated` | `boolean` | no | `0` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L20) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L21) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L21) |

## `default_relationship_types`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L24).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L25) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L26) |
| `name_reverse_relationship` | `string` | no | `` |  | Label to show when traversing relationship in reverse. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L27) |
| `relationship_type_group_id` | `integer` | no | `` |  | Foreign key to `relationship_type_groups`. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L28) |
| `delible` | `boolean` | no | `0` |  | Whether the user may delete the row. Monica uses the misspelled column name. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L29) |
| `migrated` | `boolean` | no | `0` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L30) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L31) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_03_03_204440_create_relationship_type_table.php#L31) |

## `metadata_love_relationships`

Extra metadata for love/couple relationships.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L18) |
| `relationship_id` | `unsignedInteger` | no | `` | FK -> relationships.id (cascade) | Foreign key to `relationships`. | [source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L19) |
| `is_active` | `boolean` | no | `` |  | Boolean active/archive flag; for contacts, false means archived. | [source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L20) |
| `notes` | `mediumText` | yes | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L21) |
| `meet_date` | `datetime` | yes | `` |  | Love relationship meet date. | [source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L22) |
| `official_date` | `datetime` | yes | `` |  | Love relationship official/start date. | [source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L23) |
| `breakup_date` | `datetime` | yes | `` |  | Love relationship breakup date. | [source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L24) |
| `breakup_reason` | `mediumText` | yes | `` |  | Love relationship breakup reason. | [source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L25) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L26) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L26) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L27)).
- `relationship_id` -> `relationships.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_06_10_191450_add_love_metadata_relationshisp.php#L28)).

## `pets`

Contact-associated pet records.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_12_24_115641_create_pets_table.php#L17).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_12_24_115641_create_pets_table.php#L18) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L436) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L437) |
| `pet_category_id` | `unsignedInteger` | no | `` | FK -> pet_categories.id (cascade) | Foreign key/reference id for `pet_category` in this table's domain. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L438) |
| `name` | `string` | yes | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2017_12_24_115641_create_pets_table.php#L22) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_12_24_115641_create_pets_table.php#L23) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_12_24_115641_create_pets_table.php#L23) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L439)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L440)).
- `pet_category_id` -> `pet_categories.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L441)).

## `pet_categories`

Global pet category vocabulary.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_12_24_115641_create_pets_table.php#L26).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_12_24_115641_create_pets_table.php#L27) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2017_12_24_115641_create_pets_table.php#L28) |
| `is_common` | `boolean` | no | `` |  | Boolean/status flag used by UI and services. | [source](../monica-4.x/database/migrations/2017_12_24_115641_create_pets_table.php#L29) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_12_24_115641_create_pets_table.php#L30) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_12_24_115641_create_pets_table.php#L30) |
