# Database Schema: Contacts And Profile Data

Person/profile tables and support data for addresses, contact fields, files, DAV, work, tags, and weather.

Each column lists the latest migration source that created or changed it. `Null` is inferred from migration chains; older legacy rows may still violate assumptions before cleanup migrations ran.

## `contacts`

Primary person record. Holds name, profile metadata, special-date pointers, avatar state, CardDAV state, and archive/delete flags.

Created/last recreated at [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L643) |
| `first_name` | `string` | no | `` |  | Given name for a user/contact. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L21) |
| `middle_name` | `string` | yes | `` |  | Middle name for a contact. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L22) |
| `last_name` | `string` | yes | `` |  | Family name for a user/contact. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L23) |
| `first_met_where` | `string` | yes | `` |  | Free-text place/context where the user first met the contact. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L37) |
| `first_met_additional_info` | `longText` | yes | `` |  | Additional free-text first-met narrative. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L38) |
| `job` | `string` | yes | `` |  | Legacy free-text job field on contacts. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L39) |
| `deleted_at` | `timestamp` | yes | `` |  | Soft-delete timestamp. A non-null value hides the row from normal Eloquent queries. | [source](../monica-4.x/database/migrations/2022_01_02_222042_contact_soft_delete.php#L18) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L52) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2016_06_08_005413_create_contacts_table.php#L52) |
| `default_avatar_color` | `string` | no | `` |  | Default avatar background color. | [source](../monica-4.x/database/migrations/2017_01_15_045025_add_colors_to_users.php#L17) |
| `last_talked_to` | `date` | yes | `` |  | Date of last known interaction/conversation with the contact. | [source](../monica-4.x/database/migrations/2017_01_22_142645_add_fields_to_contacts.php#L19) |
| `avatar_file_name` | `string` | yes | `` |  | Stored avatar filename for generated/uploaded avatar variants. | [source](../monica-4.x/database/migrations/2017_02_11_154900_add_avatars_to_contacts.php#L18) |
| `company` | `string` | yes | `` |  | Legacy free-text company field on contacts before normalized companies/occupations. | [source](../monica-4.x/database/migrations/2017_06_13_195740_add_company_to_contacts.php#L17) |
| `gravatar_url` | `string` | yes | `` |  | Cached Gravatar URL. | [source](../monica-4.x/database/migrations/2017_06_29_230523_add_gravatar_url_to_users.php#L17) |
| `avatar_location` | `string` | no | `local` |  | Filesystem disk/path hint for avatar storage. | [source](../monica-4.x/database/migrations/2017_08_16_041431_add_contact_avatar_location.php#L17) |
| `is_partial` | `boolean` | no | `0` |  | Partial contact flag for imported/incomplete data. | [source](../monica-4.x/database/migrations/2017_09_13_191714_add_partial_notion.php#L18) |
| `first_met_through_contact_id` | `integer` | yes | `` |  | Contact through whom this contact was introduced. | [source](../monica-4.x/database/migrations/2017_11_01_122541_add_met_through_to_contacts.php#L21) |
| `is_dead` | `boolean` | no | `0` |  | Whether the contact is deceased. | [source](../monica-4.x/database/migrations/2017_11_02_202601_add_is_dead_to_contacts.php#L17) |
| `has_avatar_bool` | `boolean` | no | `0` |  | Boolean avatar flag after avatar structure migration. | [source](../monica-4.x/database/migrations/2017_11_27_134403_add_new_avatar_to_contacts.php#L18) |
| `has_avatar` | `boolean` | no | `0` |  | Legacy avatar flag/string. | [source](../monica-4.x/database/migrations/2017_11_27_134403_add_new_avatar_to_contacts.php#L33) |
| `avatar_external_url` | `string(400)` | yes | `` |  | External URL for avatar image after later avatar migration. | [source](../monica-4.x/database/migrations/2017_11_27_134403_add_new_avatar_to_contacts.php#L41) |
| `birthday_special_date_id` | `unsignedInteger` | yes | `` | FK -> special_dates.id (set null) | Special date row for birthday. | [source](../monica-4.x/database/migrations/2019_01_05_202938_add_foreign_key_to_contacts.php#L65) |
| `deceased_special_date_id` | `unsignedInteger` | yes | `` | FK -> special_dates.id (set null) | Special date row for deceased date. | [source](../monica-4.x/database/migrations/2019_01_05_202938_add_foreign_key_to_contacts.php#L67) |
| `first_met_special_date_id` | `unsignedInteger` | yes | `` | FK -> special_dates.id (set null) | Foreign key/reference id for `first_met_special_date` in this table's domain. | [source](../monica-4.x/database/migrations/2019_01_05_202938_add_foreign_key_to_contacts.php#L66) |
| `last_consulted_at` | `timestamp` | yes | `` |  | Timestamp when a contact profile was last viewed/consulted. | [source](../monica-4.x/database/migrations/2017_12_10_214545_add_last_consulted_at_to_contacts.php#L18) |
| `gender_id` | `integer` | yes | `` |  | Foreign key/reference id for `gender` in this table's domain. | [source](../monica-4.x/database/migrations/2019_02_20_205744_allow_gender_null.php#L17) |
| `stay_in_touch_frequency` | `integer` | yes | `` |  | Number of days/weeks/months Monica uses for stay-in-touch cadence. | [source](../monica-4.x/database/migrations/2018_04_19_190239_stay_in_touch.php#L17) |
| `stay_in_touch_trigger_date` | `datetime` | yes | `` |  | Next/last date used to trigger stay-in-touch reminders. | [source](../monica-4.x/database/migrations/2018_04_19_190239_stay_in_touch.php#L18) |
| `nickname` | `string` | yes | `` |  | Contact nickname shown alongside formal name. | [source](../monica-4.x/database/migrations/2018_05_16_143631_add_nickname_to_contacts.php#L23) |
| `is_starred` | `boolean` | no | `false` |  | Favorite/star flag for a contact. | [source](../monica-4.x/database/migrations/2018_08_06_145046_add_starred_to_contacts.php#L17) |
| `is_active` | `boolean` | no | `1` |  | Boolean active/archive flag; for contacts, false means archived. | [source](../monica-4.x/database/migrations/2018_09_02_150531_contact_archiving.php#L17) |
| `description` | `string` | yes | `` |  | Longer description or note text for this row. | [source](../monica-4.x/database/migrations/2018_09_13_135926_add_description_field_to_contacts.php#L17) |
| `number_of_views` | `integer` | no | `0` |  | Contact profile view counter. | [source](../monica-4.x/database/migrations/2018_10_01_211757_add_number_of_views.php#L17) |
| `uuid` | `uuid` | yes | `` |  | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2018_11_21_212932_add_contacts_uuid.php#L17) |
| `birthday_reminder_id` | `unsignedInteger` | yes | `` | FK -> reminders.id (set null) | Reminder row associated with birthday. | [source](../monica-4.x/database/migrations/2019_01_05_152329_add_reminder_ids_to_contacts.php#L17) |
| `first_met_reminder_id` | `unsignedInteger` | yes | `` | FK -> reminders.id (set null) | Foreign key/reference id for `first_met_reminder` in this table's domain. | [source](../monica-4.x/database/migrations/2019_01_05_152329_add_reminder_ids_to_contacts.php#L19) |
| `deceased_reminder_id` | `unsignedInteger` | yes | `` | FK -> reminders.id (set null) | Reminder row associated with deceased date. | [source](../monica-4.x/database/migrations/2019_01_05_152329_add_reminder_ids_to_contacts.php#L21) |
| `food_preferences` | `longText` | yes | `` |  | Free-text food/allergy/diet preferences. | [source](../monica-4.x/database/migrations/2019_05_15_205533_rename_preferences.php#L17) |
| `avatar_source` | `string` | no | `default` |  | Avatar source selector: default, gravatar, adorable, photo, or external depending on UI state. | [source](../monica-4.x/database/migrations/2019_08_12_213308_change_avatars_structure.php#L17) |
| `avatar_gravatar_url` | `string(250)` | yes | `` |  | Cached Gravatar avatar URL. | [source](../monica-4.x/database/migrations/2019_08_12_213308_change_avatars_structure.php#L18) |
| `avatar_adorable_uuid` | `uuid` | yes | `` |  | UUID used with the old Adorable Avatars provider. | [source](../monica-4.x/database/migrations/2019_08_12_213308_change_avatars_structure.php#L19) |
| `avatar_adorable_url` | `string(250)` | yes | `` |  | Cached Adorable Avatars URL. | [source](../monica-4.x/database/migrations/2019_08_12_213308_change_avatars_structure.php#L20) |
| `avatar_default_url` | `string(250)` | yes | `` |  | Generated default avatar URL. | [source](../monica-4.x/database/migrations/2019_08_12_213308_change_avatars_structure.php#L21) |
| `avatar_photo_id` | `unsignedInteger` | yes | `` | FK -> photos.id (set null) | Foreign key to `photos` for uploaded avatar. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L644) |
| `address_book_id` | `unsignedBigInteger` | yes | `` | FK -> addressbooks.id (cascade) | Foreign key to local CardDAV address book that owns/imported the contact. | [source](../monica-4.x/database/migrations/2020_03_25_082324_add_contact_address_book_id.php#L17) |
| `vcard` | `mediumText` | yes | `` |  | Serialized vCard data cached for CardDAV. | [source](../monica-4.x/database/migrations/2020_03_25_201407_add_contact_vcard_data.php#L17) |
| `distant_etag` | `string(256)` | yes | `` |  | Remote ETag for subscribed CardDAV contacts. | [source](../monica-4.x/database/migrations/2021_10_11_060512_add_distant_etag.php#L17) |

Foreign keys:
- `birthday_reminder_id` -> `reminders.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_01_05_152329_add_reminder_ids_to_contacts.php#L18)).
- `first_met_reminder_id` -> `reminders.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_01_05_152329_add_reminder_ids_to_contacts.php#L20)).
- `deceased_reminder_id` -> `reminders.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_01_05_152329_add_reminder_ids_to_contacts.php#L22)).
- `birthday_special_date_id` -> `special_dates.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_01_05_202938_add_foreign_key_to_contacts.php#L68)).
- `first_met_special_date_id` -> `special_dates.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_01_05_202938_add_foreign_key_to_contacts.php#L69)).
- `deceased_special_date_id` -> `special_dates.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_01_05_202938_add_foreign_key_to_contacts.php#L70)).
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L645)).
- `avatar_photo_id` -> `photos.id`; on delete `set null` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L646)).
- `address_book_id` -> `addressbooks.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_03_25_082324_add_contact_address_book_id.php#L18)).

## `genders`

Per-account gender vocabulary; contacts reference this instead of old enum gender.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_01_27_014146_add_custom_gender.php#L18).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_01_27_014146_add_custom_gender.php#L19) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L273) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_01_27_014146_add_custom_gender.php#L21) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_01_27_014146_add_custom_gender.php#L22) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_01_27_014146_add_custom_gender.php#L22) |
| `type` | `char(1)` | yes | `` |  | Type/category discriminator string. | [source](../monica-4.x/database/migrations/2019_02_09_200203_add_gender_type.php#L19) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L274)).

## `contact_fields`

Typed contact data values such as email addresses, phone numbers, social URLs, and profile links.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L30).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L31) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L32) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L33) |
| `contact_field_type_id` | `unsignedInteger` | no | `` | FK -> contact_field_types.id (cascade) | Foreign key to `contact_field_types`. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L34) |
| `data` | `string` | no | `` |  | Raw contact field value. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L35) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L36) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L36) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L38)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L39)).
- `contact_field_type_id` -> `contact_field_types.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L40)).

## `contact_field_types`

Per-account definitions for contact field kinds. Defaults are copied from `default_contact_field_types`.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L17).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L18) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L19) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L20) |
| `fontawesome_icon` | `string` | yes | `` |  | Font Awesome icon name shown for a contact field type. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L21) |
| `protocol` | `string` | yes | `` |  | URI protocol prefix for contact fields, e.g. mailto/tel/https. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L22) |
| `delible` | `boolean` | no | `1` |  | Whether the user may delete the row. Monica uses the misspelled column name. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L23) |
| `type` | `string` | yes | `` |  | Type/category discriminator string. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L24) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L25) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L25) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L27)).

## `default_contact_field_types`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L59).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L60) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L61) |
| `fontawesome_icon` | `string` | yes | `` |  | Font Awesome icon name shown for a contact field type. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L62) |
| `protocol` | `string` | yes | `` |  | URI protocol prefix for contact fields, e.g. mailto/tel/https. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L63) |
| `migrated` | `boolean` | no | `0` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L64) |
| `delible` | `boolean` | no | `1` |  | Whether the user may delete the row. Monica uses the misspelled column name. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L65) |
| `type` | `string` | yes | `` |  | Type/category discriminator string. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L66) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L67) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L67) |

## `contact_field_labels`

Reusable labels attached to contact fields or addresses.

Created/last recreated at [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `bigIncrements` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L18) |
| `label_i18n` | `string(20)` | yes | `` |  | Translation key for a predefined label. | [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L19) |
| `label` | `string(500)` | yes | `` |  | Custom label text. | [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L20) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L21) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L21) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L24)).

## `contact_field_contact_field_label`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L27).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `contact_field_label_id` | `unsignedBigInteger` | no | `` | FK -> contact_field_labels.id (cascade) | Foreign key/reference id for `contact_field_label` in this table's domain. | [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L28) |
| `contact_field_id` | `unsignedInteger` | no | `` | FK -> contact_fields.id (cascade) | Foreign key/reference id for `contact_field` in this table's domain. | [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L29) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L30) |

Foreign keys:
- `contact_field_label_id` -> `contact_field_labels.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L32)).
- `contact_field_id` -> `contact_fields.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L33)).
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L34)).

## `addresses`

Connects contacts to normalized places with an optional address display name.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L43).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L44) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L45) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L46) |
| `name` | `string` | yes | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L47) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L53) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L53) |
| `place_id` | `unsignedInteger` | yes | `` | FK -> places.id (cascade) | Foreign key to `places`. | [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L31) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L55)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2017_11_10_174654_create_contact_fields_table.php#L56)).
- `place_id` -> `places.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L32)).

## `places`

Postal/geographical place details shared by addresses and weather cache.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L18) |
| `street` | `string` | yes | `` |  | Street address line. | [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L19) |
| `city` | `string` | yes | `` |  | City/locality. | [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L20) |
| `province` | `string` | yes | `` |  | Province/state/region. | [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L21) |
| `postal_code` | `string` | yes | `` |  | Postal/ZIP code. | [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L22) |
| `country` | `char(3)` | yes | `` |  | Country code/name text, depending on migration stage and helper use. | [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L23) |
| `latitude` | `double` | yes | `` |  | Latitude coordinate. | [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L24) |
| `longitude` | `double` | yes | `` |  | Longitude coordinate. | [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L25) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L26) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L26) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_19_002819_create_places_table.php#L27)).

## `address_contact_field_label`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L37).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `contact_field_label_id` | `unsignedBigInteger` | no | `` | FK -> contact_field_labels.id (cascade) | Foreign key/reference id for `contact_field_label` in this table's domain. | [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L38) |
| `address_id` | `unsignedInteger` | no | `` | FK -> addresses.id (cascade) | Foreign key/reference id for `address` in this table's domain. | [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L39) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L40) |

Foreign keys:
- `contact_field_label_id` -> `contact_field_labels.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L42)).
- `address_id` -> `addresses.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L43)).
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_02_18_211620_add_contact_field_label.php#L44)).

## `companies`

Companies/employers scoped to an account.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_12_24_164256_add_companies_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_12_24_164256_add_companies_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_12_24_164256_add_companies_table.php#L18) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2018_12_24_164256_add_companies_table.php#L19) |
| `website` | `string` | yes | `` |  | Company website URL. | [source](../monica-4.x/database/migrations/2018_12_24_164256_add_companies_table.php#L20) |
| `number_of_employees` | `integer` | yes | `` |  | Company size estimate. | [source](../monica-4.x/database/migrations/2018_12_24_164256_add_companies_table.php#L21) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_12_24_164256_add_companies_table.php#L22) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_12_24_164256_add_companies_table.php#L22) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_24_164256_add_companies_table.php#L23)).

## `occupations`

Employment history and current work records for contacts.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L18) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L19) |
| `company_id` | `unsignedInteger` | no | `` | FK -> companies.id (cascade) | Foreign key to `companies`. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L20) |
| `title` | `string` | no | `` |  | Title or short user-facing label. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L21) |
| `description` | `string(1000)` | yes | `` |  | Longer description or note text for this row. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L22) |
| `salary` | `integer` | yes | `` |  | Free-text or numeric salary field for occupation. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L23) |
| `salary_unit` | `string` | yes | `` |  | Salary cadence/unit such as year/month/hour. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L24) |
| `currently_works_here` | `boolean` | yes | `false` |  | Whether this occupation is current. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L25) |
| `start_date` | `date` | yes | `` |  | Occupation start date. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L26) |
| `end_date` | `date` | yes | `` |  | Occupation end date. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L27) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L28) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L28) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L29)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L30)).
- `company_id` -> `companies.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_24_220019_add_occupations_table.php#L31)).

## `tags`

Account-scoped labels used for contact grouping.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_07_02_155736_create_tags_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2017_07_02_155736_create_tags_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L540) |
| `name` | `string` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2017_07_02_155736_create_tags_table.php#L19) |
| `name_slug` | `string` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2017_07_02_155736_create_tags_table.php#L20) |
| `description` | `mediumText` | yes | `` |  | Longer description or note text for this row. | [source](../monica-4.x/database/migrations/2017_07_02_155736_create_tags_table.php#L21) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_07_02_155736_create_tags_table.php#L22) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_07_02_155736_create_tags_table.php#L22) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L541)).

## `contact_tag`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2017_07_02_155736_create_tags_table.php#L25).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L199) |
| `tag_id` | `unsignedInteger` | no | `` | FK -> tags.id (cascade) | Foreign key/reference id for `tag` in this table's domain. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L200) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L198) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2017_07_02_155736_create_tags_table.php#L29) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2017_07_02_155736_create_tags_table.php#L29) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L201)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L202)).
- `tag_id` -> `tags.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2019_12_17_024553_add_foreign_keys.php#L203)).

## `photos`

Uploaded image metadata stored in filesystem-backed storage.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_11_18_021908_create_images_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_11_18_021908_create_images_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_11_18_021908_create_images_table.php#L18) |
| `original_filename` | `string` | no | `` |  | Original uploaded client filename. | [source](../monica-4.x/database/migrations/2018_11_18_021908_create_images_table.php#L19) |
| `new_filename` | `string` | no | `` |  | Generated storage filename. | [source](../monica-4.x/database/migrations/2018_11_18_021908_create_images_table.php#L20) |
| `filesize` | `integer` | yes | `` |  | Uploaded file size in bytes. | [source](../monica-4.x/database/migrations/2018_11_18_021908_create_images_table.php#L21) |
| `mime_type` | `string` | yes | `` |  | Uploaded file MIME type. | [source](../monica-4.x/database/migrations/2018_11_18_021908_create_images_table.php#L22) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_11_18_021908_create_images_table.php#L23) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_11_18_021908_create_images_table.php#L23) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_11_18_021908_create_images_table.php#L24)).

## `contact_photo`

System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_11_25_020818_add_contact_photo_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2018_11_25_020818_add_contact_photo_table.php#L17) |
| `photo_id` | `unsignedInteger` | no | `` | FK -> photos.id (cascade) | Foreign key/reference id for `photo` in this table's domain. | [source](../monica-4.x/database/migrations/2018_11_25_020818_add_contact_photo_table.php#L18) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_11_25_020818_add_contact_photo_table.php#L19) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_11_25_020818_add_contact_photo_table.php#L19) |

Foreign keys:
- `photo_id` -> `photos.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_11_25_020818_add_contact_photo_table.php#L20)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_11_25_020818_add_contact_photo_table.php#L21)).

## `documents`

Uploaded non-image document metadata stored in filesystem-backed storage.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L18) |
| `contact_id` | `unsignedInteger` | no | `` | FK -> contacts.id (cascade) | Foreign key to the contact this row belongs to. | [source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L19) |
| `original_filename` | `string` | no | `` |  | Original uploaded client filename. | [source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L20) |
| `new_filename` | `string` | no | `` |  | Generated storage filename. | [source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L21) |
| `filesize` | `integer` | yes | `` |  | Uploaded file size in bytes. | [source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L22) |
| `type` | `string` | yes | `` |  | Type/category discriminator string. | [source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L23) |
| `mime_type` | `string` | yes | `` |  | Uploaded file MIME type. | [source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L24) |
| `number_of_downloads` | `integer` | no | `0` |  | Download counter for documents. | [source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L25) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L26) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L26) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L27)).
- `contact_id` -> `contacts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_09_23_024528_add_documents_table.php#L28)).

## `addressbooks`

Local CardDAV address books owned by a user/account.

Created/last recreated at [source](../monica-4.x/database/migrations/2020_03_25_055551_add_address_book.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `bigIncrements` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2020_03_25_055551_add_address_book.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2020_03_25_055551_add_address_book.php#L18) |
| `user_id` | `unsignedInteger` | no | `` | FK -> users.id (cascade) | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2020_03_25_055551_add_address_book.php#L19) |
| `description` | `string(500)` | yes | `` |  | Longer description or note text for this row. | [source](../monica-4.x/database/migrations/2020_03_25_055551_add_address_book.php#L21) |
| `name` | `string(100)` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2020_03_25_055551_add_address_book.php#L22) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2020_03_25_055551_add_address_book.php#L23) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2020_03_25_055551_add_address_book.php#L23) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_03_25_055551_add_address_book.php#L26)).
- `user_id` -> `users.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_03_25_055551_add_address_book.php#L27)).

## `addressbook_subscriptions`

Remote CardDAV address book subscriptions and sync state.

Created/last recreated at [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `bigIncrements` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L18) |
| `user_id` | `unsignedInteger` | no | `` | FK -> users.id (cascade) | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L19) |
| `address_book_id` | `unsignedBigInteger` | no | `` | FK -> addressbooks.id (cascade) | Foreign key to local CardDAV address book that owns/imported the contact. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L20) |
| `name` | `string(256)` | no | `` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L22) |
| `uri` | `string(2096)` | no | `` |  | Remote/local DAV URI. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L23) |
| `username` | `string(1024)` | no | `` |  | Remote DAV username. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L24) |
| `password` | `string(2048)` | no | `` |  | Hashed password or encrypted secret, depending on table context. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L25) |
| `readonly` | `boolean` | no | `` |  | Whether a subscribed address book is read-only. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L26) |
| `active` | `boolean` | no | `true` |  | Boolean active flag. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L27) |
| `capabilities` | `string(2048)` | no | `` |  | Serialized DAV server capabilities. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L28) |
| `syncToken` | `string(512)` | yes | `` |  | Remote CardDAV sync token. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L29) |
| `localSyncToken` | `string(1024)` | yes | `` |  | Local sync marker for remote address book subscription. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L30) |
| `last_synchronized_at` | `timestamp` | yes | `` |  | Timestamp of the last CardDAV subscription sync. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L32) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L33) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L33) |
| `uuid` | `uuid` | yes | `` | index | Stable UUID used by exports, API/DAV payloads, and cross-system references. | [source](../monica-4.x/database/migrations/2020_12_19_205923_add_uuids.php#L52) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L35)).
- `user_id` -> `users.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L36)).
- `address_book_id` -> `addressbooks.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2020_03_25_065551_add_addressbook_subscription.php#L37)).

## `synctoken`

DAV sync-token ledger used to track changed/deleted contacts/tasks/calendars.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_12_29_135516_sync_token.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_12_29_135516_sync_token.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_12_29_135516_sync_token.php#L18) |
| `user_id` | `unsignedInteger` | no | `` | FK -> users.id (cascade) | User foreign key inside the owning account. | [source](../monica-4.x/database/migrations/2018_12_29_135516_sync_token.php#L19) |
| `timestamp` | `timestamp` | no | `` |  | Table-specific value; see model/service usage and migrations for exact behavior. | [source](../monica-4.x/database/migrations/2018_12_29_135516_sync_token.php#L20) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_12_29_135516_sync_token.php#L21) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_12_29_135516_sync_token.php#L21) |
| `name` | `string` | no | `contacts` |  | Display/internal name for this row. | [source](../monica-4.x/database/migrations/2019_01_18_142032_add_dav_uuid.php#L28) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_29_135516_sync_token.php#L22)).
- `user_id` -> `users.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_29_135516_sync_token.php#L23)).

## `weather`

Cached weather JSON for places.

Created/last recreated at [source](../monica-4.x/database/migrations/2018_12_21_235418_add_weather_table.php#L16).

| Column | Type | Null | Default | Keys | Description | Source |
|---|---:|:---:|---|---|---|---|
| `id` | `increments` | no | `` | PK | Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes. | [source](../monica-4.x/database/migrations/2018_12_21_235418_add_weather_table.php#L17) |
| `account_id` | `unsignedInteger` | no | `` | FK -> accounts.id (cascade) | Tenant/account foreign key. This is the main data ownership boundary. | [source](../monica-4.x/database/migrations/2018_12_21_235418_add_weather_table.php#L18) |
| `place_id` | `unsignedInteger` | no | `` | FK -> places.id (cascade) | Foreign key to `places`. | [source](../monica-4.x/database/migrations/2018_12_21_235418_add_weather_table.php#L19) |
| `weather_json` | `string(2000)` | no | `` |  | Cached weather API response JSON. | [source](../monica-4.x/database/migrations/2018_12_21_235418_add_weather_table.php#L20) |
| `created_at` | `timestamp` | no | `` |  | Laravel creation timestamp. | [source](../monica-4.x/database/migrations/2018_12_21_235418_add_weather_table.php#L21) |
| `updated_at` | `timestamp` | no | `` |  | Laravel last-update timestamp. | [source](../monica-4.x/database/migrations/2018_12_21_235418_add_weather_table.php#L21) |

Foreign keys:
- `account_id` -> `accounts.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_21_235418_add_weather_table.php#L22)).
- `place_id` -> `places.id`; on delete `cascade` ([source](../monica-4.x/database/migrations/2018_12_21_235418_add_weather_table.php#L23)).
