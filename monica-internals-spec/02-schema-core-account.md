# Database Schema: Account, Users, Billing, Import/Export

Tenant, identity, billing, import/export, compliance, and audit tables.

Each column lists the latest migration source that created or changed it. `Null` is inferred from migration chains; older legacy rows may still violate assumptions before cleanup migrations ran.

## `accounts`

Tenant/account root. Most user-owned records carry `account_id` and cascade from this table.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_06_07_234741_create_account_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_06_07_234741_create_account_table.php#L17) |
| `api_key` | `string` | no | `` |  | Legacy per-account API key. | [source](../monica-4.x/database/migrations/2016_06_07_234741_create_account_table.php#L18) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2016_06_07_234741_create_account_table.php#L19) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2016_06_07_234741_create_account_table.php#L19) |
| `stripe_id` | `string` | yes | `` |  | Stripe customer/subscription/item id depending on table. | [source](../monica-4.x/database/migrations/2017_06_19_105842_add_stripe_fields_to_users.php#L16) |
| `trial_ends_at` | `timestamp` | yes | `` |  | Stripe/Cashier trial end timestamp. | [source](../monica-4.x/database/migrations/2017_06_19_105842_add_stripe_fields_to_users.php#L19) |
| `number_of_invitations_sent` | `integer` | yes | `` |  | Counter of invitations sent by this account. | [source](../monica-4.x/database/migrations/2017_06_20_121345_add_invitations_statistics.php#L16) |
| `has_access_to_paid_version_for_free` | `boolean` | no | `false` |  | Boolean/status flag used by UI and services. | [source](../monica-4.x/database/migrations/2017_08_21_224835_remove_paid_limitations_for_current_users.php#L18) |
| `default_time_reminder_is_sent` | `string` | no | `12:00` |  | Account default HH:MM time for reminder email scheduling. | [source](../monica-4.x/database/migrations/2018_01_15_105858_create_additional_reminders_table.php#L50) |
| `legacy_free_plan_unlimited_contacts` | `boolean` | no | `false` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_08_18_180426_add_legacy_free_plan.php#L18) |
| `default_gender_id` | `unsignedInteger` | yes | `` | FK -> genders.id (set null) | Default gender row for newly-created contacts in the account. | [source](../monica-4.x/database/migrations/2019_02_17_112452_add_default_gender.php#L19) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |
| `pm_type` | `string` | yes | `` |  | Payment method/card brand after Cashier rename. | [source](../monica-4.x/database/migrations/2022_04_25_165338_cashier_stripe_rename_plan.php#L24) |
| `pm_last_four` | `string(4)` | yes | `` |  | Last four digits of the payment method after Cashier rename. | [source](../monica-4.x/database/migrations/2022_04_25_165338_cashier_stripe_rename_plan.php#L25) |

Foreign keys:
- `default_gender_id` -> `genders.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_02_17_112452_add_default_gender.php#L20)).

## `users`

Login identities inside an account. Stores authentication, MFA, display, locale, and preference data.

Created/last recreated at [source](../monica-4.x/database/migrations/2014_10_12_000000_create_users_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2014_10_12_000000_create_users_table.php#L17) |
| `first_name` | `string` | no | `` |  | Given name for a user/contact. | [source](../monica-4.x/database/migrations/2014_10_12_000000_create_users_table.php#L18) |
| `last_name` | `string` | no | `` |  | Family name for a user/contact. | [source](../monica-4.x/database/migrations/2014_10_12_000000_create_users_table.php#L19) |
| `email` | `string` | no | `` | unique | Email address. | [source](../monica-4.x/database/migrations/2014_10_12_000000_create_users_table.php#L21) |
| `password` | `string` | no | `` |  | Hashed password or encrypted secret, depending on table context. | [source](../monica-4.x/database/migrations/2014_10_12_000000_create_users_table.php#L22) |
| `remember_token` | `string(100)` | yes | `` |  | Laravel remember-me token. | [source](../monica-4.x/database/migrations/2014_10_12_000000_create_users_table.php#L23) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2014_10_12_000000_create_users_table.php#L24) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2014_10_12_000000_create_users_table.php#L24) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L610) |
| `timezone` | `string` | yes | `` |  | User timezone string used for date display and reminders. | [source](../monica-4.x/database/migrations/2016_06_08_003006_add_account_info_table.php#L21) |
| `locale` | `string` | no | `en` |  | User locale code used for translations. | [source](../monica-4.x/database/migrations/2016_06_08_003006_add_account_info_table.php#L22) |
| `fluid_container` | `string` | no | `false` |  | UI layout preference. | [source](../monica-4.x/database/migrations/2016_07_25_133835_add_width_field.php#L17) |
| `metric` | `string` | no | `fahrenheit` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2016_10_28_002518_add_metric_to_settings.php#L17) |
| `contacts_sort_order` | `string` | no | `firstnameAZ` |  | Contact list sort preference. | [source](../monica-4.x/database/migrations/2017_02_08_025358_add_sort_preferences_to_users.php#L17) |
| `currency_id` | `unsignedInteger` | yes | `$dollarResult` | FK -> currencies.id (set null) | Foreign key to `currencies`; default currency for user or money row. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L611) |
| `invited_by_user_id` | `unsignedInteger` | yes | `` | FK -> users.id (set null) | User that invited this user/invitation. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L612) |
| `name_order` | `string` | no | `firstname_lastname_nickname` |  | Display order preference for contact names. | [source](../monica-4.x/database/migrations/2018_06_14_212502_change_default_name_order_user_table.php#L16) |
| `google2fa_secret` | `string(256)` | yes | `` |  | Encrypted/encoded TOTP secret for 2FA. | [source](../monica-4.x/database/migrations/2020_05_08_072433_google2fa_column_size.php#L16) |
| `dashboard_active_tab` | `string` | no | `calls` |  | Dashboard selected tab preference. | [source](../monica-4.x/database/migrations/2017_12_31_114224_add_dashboard_tab_to_users.php#L17) |
| `gifts_active_tab` | `string` | no | `ideas` |  | Gift tab selected preference. | [source](../monica-4.x/database/migrations/2018_01_17_230820_add_gift_tab_view_to_users.php#L17) |
| `profile_active_tab` | `string` | no | `notes` |  | Default contact profile tab preference. | [source](../monica-4.x/database/migrations/2018_09_05_025008_add_default_profile_view.php#L17) |
| `profile_new_life_event_badge_seen` | `boolean` | no | `false` |  | Whether the user dismissed the new life-event badge. | [source](../monica-4.x/database/migrations/2018_09_05_025008_add_default_profile_view.php#L18) |
| `email_verified_at` | `timestamp` | yes | `` |  | Email verification timestamp. | [source](../monica-4.x/database/migrations/2018_10_28_165814_email_verified.php#L18) |
| `temperature_scale` | `string` | yes | `celsius` |  | Weather temperature unit preference. | [source](../monica-4.x/database/migrations/2018_12_29_091017_default_temperature_scale.php#L19) |
| `admin` | `boolean` | no | `false` |  | Boolean admin flag. | [source](../monica-4.x/database/migrations/2019_01_17_093812_add_admin_user.php#L17) |
| `me_contact_id` | `unsignedInteger` | yes | `` | FK -> contacts.id (set null) | Contact row representing the user themself. | [source](../monica-4.x/database/migrations/2019_08_13_160332_add_me_contact_on_user.php#L17) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `me_contact_id` -> `contacts.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_08_13_160332_add_me_contact_on_user.php#L18)).
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L613)).
- `currency_id` -> `currencies.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L614)).
- `invited_by_user_id` -> `users.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L615)).

## `invitations`

Pending invitations for additional account users.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_06_17_153814_refactor_user_table.php#L31).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_06_17_153814_refactor_user_table.php#L32) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L354) |
| `invited_by_user_id` | `unsignedInteger` | no | `` | FK -> users.id (cascade) | User that invited this user/invitation. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L355) |
| `email` | `string` | no | `` |  | Email address. | [source](../monica-4.x/database/migrations/2017_06_17_153814_refactor_user_table.php#L35) |
| `invitation_key` | `string` | no | `` |  | Opaque key used to accept an invitation. | [source](../monica-4.x/database/migrations/2017_06_17_153814_refactor_user_table.php#L36) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_06_17_153814_refactor_user_table.php#L37) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_06_17_153814_refactor_user_table.php#L37) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L356)).
- `invited_by_user_id` -> `users.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L357)).

## `recovery_codes`

2FA recovery codes for users.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_11_30_154729_recovery_codes.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_11_30_154729_recovery_codes.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_11_30_154729_recovery_codes.php#L18) |
| `user_id` | `unsignedInteger` | no | `` | FK -> users.id (cascade) | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2018_11_30_154729_recovery_codes.php#L19) |
| `recovery` | `string` | no | `` |  | 2FA recovery code value. | [source](../monica-4.x/database/migrations/2018_11_30_154729_recovery_codes.php#L20) |
| `used` | `boolean` | no | `false` |  | Whether a recovery code has been consumed. | [source](../monica-4.x/database/migrations/2018_11_30_154729_recovery_codes.php#L21) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_11_30_154729_recovery_codes.php#L22) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_11_30_154729_recovery_codes.php#L22) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_11_30_154729_recovery_codes.php#L23)).
- `user_id` -> `users.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_11_30_154729_recovery_codes.php#L24)).

## `terms`

Versioned legal/compliance policy documents.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_05_07_070458_create_terms_table.php#L17).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_05_07_070458_create_terms_table.php#L18) |
| `term_version` | `string` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_05_07_070458_create_terms_table.php#L19) |
| `term_content` | `mediumText` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_05_07_070458_create_terms_table.php#L20) |
| `privacy_version` | `string` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_05_07_070458_create_terms_table.php#L21) |
| `privacy_content` | `mediumText` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_05_07_070458_create_terms_table.php#L22) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_05_07_070458_create_terms_table.php#L23) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_05_07_070458_create_terms_table.php#L23) |

## `term_user`

Pivot recording which user/account accepted which terms and from what IP.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_05_07_070458_create_terms_table.php#L26).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L589) |
| `user_id` | `unsignedInteger` | no | `` | FK -> users.id (cascade) | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L590) |
| `term_id` | `unsignedInteger` | no | `` | FK -> terms.id (cascade) | Foreign key/reference id for `term` in this table's domain. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L591) |
| `ip_address` | `string` | yes | `` |  | IP address captured for sessions, audit/compliance, or API usage. | [source](../monica-4.x/database/migrations/2018_05_07_070458_create_terms_table.php#L30) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_05_07_070458_create_terms_table.php#L31) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_05_07_070458_create_terms_table.php#L31) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L592)).
- `user_id` -> `users.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L593)).
- `term_id` -> `terms.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L594)).

## `modules`

Per-account feature-module toggles shown on contact profiles.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_04_04_222608_create_account_modules_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_04_04_222608_create_account_modules_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L390) |
| `key` | `string` | no | `` |  | Stable module/cache/job key depending on table context. | [source](../monica-4.x/database/migrations/2018_04_04_222608_create_account_modules_table.php#L19) |
| `translation_key` | `string` | no | `` |  | Translation key for default labels instead of raw text. | [source](../monica-4.x/database/migrations/2018_04_04_222608_create_account_modules_table.php#L20) |
| `active` | `boolean` | no | `1` |  | Boolean active flag. | [source](../monica-4.x/database/migrations/2018_04_04_222608_create_account_modules_table.php#L21) |
| `delible` | `boolean` | no | `0` |  | Whether the user may delete the row. Monica uses the misspelled column name. | [source](../monica-4.x/database/migrations/2018_04_04_222608_create_account_modules_table.php#L22) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_04_04_222608_create_account_modules_table.php#L23) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_04_04_222608_create_account_modules_table.php#L23) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L391)).

## `default_contact_modules`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_04_04_220850_create_default_modules_table.php#L17).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_04_04_220850_create_default_modules_table.php#L18) |
| `key` | `string` | no | `` |  | Stable module/cache/job key depending on table context. | [source](../monica-4.x/database/migrations/2018_04_04_220850_create_default_modules_table.php#L19) |
| `translation_key` | `string` | no | `` |  | Translation key for default labels instead of raw text. | [source](../monica-4.x/database/migrations/2018_04_04_220850_create_default_modules_table.php#L20) |
| `delible` | `boolean` | no | `0` |  | Whether the user may delete the row. Monica uses the misspelled column name. | [source](../monica-4.x/database/migrations/2018_04_04_220850_create_default_modules_table.php#L21) |
| `active` | `boolean` | no | `1` |  | Boolean active flag. | [source](../monica-4.x/database/migrations/2018_04_04_220850_create_default_modules_table.php#L22) |
| `migrated` | `boolean` | no | `0` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_04_04_220850_create_default_modules_table.php#L23) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_04_04_220850_create_default_modules_table.php#L24) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_04_04_220850_create_default_modules_table.php#L24) |

## `subscriptions`

Laravel Cashier subscription records for account billing.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_06_19_105842_add_stripe_fields_to_users.php#L22).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_06_19_105842_add_stripe_fields_to_users.php#L23) |
| `account_id` | `integer` | no | `` |  | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2017_06_19_105842_add_stripe_fields_to_users.php#L24) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2017_06_19_105842_add_stripe_fields_to_users.php#L25) |
| `stripe_id` | `string` | no | `` |  | Stripe customer/subscription/item id depending on table. | [source](../monica-4.x/database/migrations/2017_06_19_105842_add_stripe_fields_to_users.php#L26) |
| `quantity` | `integer` | yes | `` |  | Subscription item quantity. | [source](../monica-4.x/database/migrations/2020_11_01_000001_create_subscription_items_table.php#L17) |
| `trial_ends_at` | `timestamp` | yes | `` |  | Stripe/Cashier trial end timestamp. | [source](../monica-4.x/database/migrations/2017_06_19_105842_add_stripe_fields_to_users.php#L29) |
| `ends_at` | `timestamp` | yes | `` |  | Subscription end/cancel timestamp. | [source](../monica-4.x/database/migrations/2017_06_19_105842_add_stripe_fields_to_users.php#L30) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_06_19_105842_add_stripe_fields_to_users.php#L31) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_06_19_105842_add_stripe_fields_to_users.php#L31) |
| `stripe_status` | `string` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2019_08_14_091427_update_stripe_columns.php#L24) |
| `stripe_price` | `string` | no | `` |  | Stripe price id after Cashier rename from `stripe_plan`. | [source](../monica-4.x/database/migrations/2022_04_25_165338_cashier_stripe_rename_plan.php#L17) |

## `subscription_items`

Laravel Cashier subscription item rows after Cashier upgrade.

Created/last recreated at [source](../monica-4.x/database/migrations/2020_11_01_000001_create_subscription_items_table.php#L20).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `bigIncrements` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2020_11_01_000001_create_subscription_items_table.php#L21) |
| `subscription_id` | `unsignedBigInteger` | no | `` |  | Foreign key/reference id for `subscription` in this table's domain. | [source](../monica-4.x/database/migrations/2020_11_01_000001_create_subscription_items_table.php#L22) |
| `stripe_id` | `string` | no | `` | index | Stripe customer/subscription/item id depending on table. | [source](../monica-4.x/database/migrations/2020_11_01_000001_create_subscription_items_table.php#L23) |
| `quantity` | `integer` | yes | `` |  | Subscription item quantity. | [source](../monica-4.x/database/migrations/2022_04_25_165338_cashier_stripe_rename_plan.php#L30) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2020_11_01_000001_create_subscription_items_table.php#L26) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2020_11_01_000001_create_subscription_items_table.php#L26) |
| `stripe_price` | `string` | no | `` |  | Stripe price id after Cashier rename from `stripe_plan`. | [source](../monica-4.x/database/migrations/2022_04_25_165338_cashier_stripe_rename_plan.php#L20) |
| `stripe_product` | `string` | yes | `` |  | Stripe product id. | [source](../monica-4.x/database/migrations/2022_04_25_165338_cashier_stripe_rename_plan.php#L29) |

## `export_jobs`

Async export job metadata for SQL/JSON downloads.

Created/last recreated at [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `bigIncrements` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L17) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L18) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L19) |
| `user_id` | `unsignedInteger` | no | `` | FK -> users.id (cascade) | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L20) |
| `type` | `string(4)` | no | `` |  | Type/category discriminator string. | [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L21) |
| `status` | `string(6)` | yes | `` |  | State string; meaning depends on table, e.g. gift or export status. | [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L22) |
| `location` | `string(6)` | yes | `` |  | Filesystem disk/location for export artifact. | [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L23) |
| `filename` | `string(256)` | yes | `` |  | Stored filename/path for import/export artifacts. | [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L24) |
| `started_at` | `datetime` | yes | `` |  | Export job start timestamp. | [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L25) |
| `ended_at` | `datetime` | yes | `` |  | Export job completion timestamp. | [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L26) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L27) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L27) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L28)).
- `user_id` -> `users.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2022_01_01_202745_add_export_jobs.php#L29)).

## `import_jobs`

vCard/CSV import job metadata.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L334) |
| `user_id` | `unsignedInteger` | no | `` | FK -> users.id (cascade) | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L335) |
| `type` | `string` | no | `vcard` |  | Type/category discriminator string. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L20) |
| `contacts_found` | `integer` | yes | `` |  | Number of contacts parsed from import file. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L21) |
| `contacts_skipped` | `integer` | yes | `` |  | Number of contacts skipped. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L22) |
| `contacts_imported` | `integer` | yes | `` |  | Number of contacts successfully imported. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L23) |
| `filename` | `string` | yes | `` |  | Stored filename/path for import/export artifacts. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L24) |
| `started_at` | `date` | yes | `` |  | Export job start timestamp. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L25) |
| `ended_at` | `date` | yes | `` |  | Export job completion timestamp. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L26) |
| `failed` | `boolean` | no | `0` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L27) |
| `failed_reason` | `mediumText` | yes | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L28) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L29) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L29) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L336)).
- `user_id` -> `users.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L337)).

## `import_job_reports`

Per-contact import result rows for an import job.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L32).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L33) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L312) |
| `user_id` | `unsignedInteger` | no | `` | FK -> users.id (cascade) | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L313) |
| `import_job_id` | `unsignedInteger` | no | `` | FK -> import_jobs.id (cascade) | Foreign key to `import_jobs`. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L314) |
| `contact_information` | `mediumText` | no | `` |  | Serialized imported contact information/report details. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L37) |
| `skipped` | `boolean` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L38) |
| `skip_reason` | `string` | yes | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L39) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L40) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_06_27_134704_create_import_table.php#L40) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L315)).
- `user_id` -> `users.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L316)).
- `import_job_id` -> `import_jobs.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L317)).

## `audit_logs`

Account audit/event log rows, optionally about a contact.

Created/last recreated at [source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `bigIncrements` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L18) |
| `author_id` | `unsignedInteger` | yes | `` | FK -> users.id (set null) | User who caused an audit log event. | [source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L19) |
| `about_contact_id` | `unsignedInteger` | yes | `` | FK -> contacts.id (set null) | Contact the audit log is about, if any. | [source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L20) |
| `author_name` | `string` | no | `` |  | Snapshot of author name at audit time. | [source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L21) |
| `action` | `string` | no | `` |  | Audit action key. | [source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L22) |
| `objects` | `text` | no | `` |  | Serialized audit object payload. | [source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L23) |
| `audited_at` | `datetime` | no | `` |  | Domain timestamp of the audited action. | [source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L24) |
| `should_appear_on_dashboard` | `boolean` | no | `false` |  | Whether to show this audit item in dashboard timelines. | [source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L25) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L26) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L26) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L27)).
- `author_id` -> `users.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L28)).
- `about_contact_id` -> `contacts.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2020_02_03_015403_create_audit_log_table.php#L29)).

## `api_usage`

Daily API usage counters by account/user/IP.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_09_13_095923_add_tracking_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_09_13_095923_add_tracking_table.php#L17) |
| `url` | `string` | no | `` |  | External URL. | [source](../monica-4.x/database/migrations/2017_09_13_095923_add_tracking_table.php#L18) |
| `method` | `string` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_09_13_095923_add_tracking_table.php#L19) |
| `client_ip` | `string` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_09_13_095923_add_tracking_table.php#L20) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_09_13_095923_add_tracking_table.php#L21) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_09_13_095923_add_tracking_table.php#L21) |

## `currencies`

Global currency list used by users, debts, and gifts.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_06_10_155349_create_currencies_data.php#L17).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_06_10_155349_create_currencies_data.php#L18) |
| `iso` | `string` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_06_10_155349_create_currencies_data.php#L19) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2017_06_10_155349_create_currencies_data.php#L20) |
| `symbol` | `string` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_06_10_155349_create_currencies_data.php#L21) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_05_16_214222_add_timestamps_to_currencies.php#L17) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_05_16_214222_add_timestamps_to_currencies.php#L17) |
