-- Personal CRM rewrite schema v3
-- PostgreSQL canonical schema for a Monica-compatible rewrite.
-- Monica source identities and redacted source rows live only in data_import_entities.
-- updated_at is application-maintained; no hidden trigger behavior is required.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS crm;
SET search_path = crm, public;


-- -----------------------------------------------------------------------------
-- Identity, tenancy, and defaults
-- -----------------------------------------------------------------------------

CREATE TABLE currencies (
  code char(3) PRIMARY KEY,
  name text NOT NULL,
  symbol text,
  minor_unit smallint NOT NULL DEFAULT 2,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minor_unit BETWEEN 0 AND 6)
);
COMMENT ON TABLE currencies IS 'Global ISO 4217 currency catalog used by members, gifts, debts, and billing display; synchronized from SIX List One on 2026-08-15.';
COMMENT ON COLUMN currencies.code IS 'ISO 4217 currency code.';
COMMENT ON COLUMN currencies.name IS 'Human-readable currency name.';
COMMENT ON COLUMN currencies.symbol IS 'Common display symbol.';
COMMENT ON COLUMN currencies.minor_unit IS 'Number of decimal places normally used by the currency.';
COMMENT ON COLUMN currencies.is_active IS 'Whether this currency is selectable for new data.';
COMMENT ON COLUMN currencies.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN currencies.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX currencies_active_idx ON currencies (is_active);

INSERT INTO currencies (code, name, minor_unit) VALUES
  ('AED', 'UAE Dirham', 2),
  ('AFN', 'Afghani', 2),
  ('ALL', 'Lek', 2),
  ('AMD', 'Armenian Dram', 2),
  ('AOA', 'Kwanza', 2),
  ('ARS', 'Argentine Peso', 2),
  ('AUD', 'Australian Dollar', 2),
  ('AWG', 'Aruban Florin', 2),
  ('AZN', 'Azerbaijan Manat', 2),
  ('BAM', 'Convertible Mark', 2),
  ('BBD', 'Barbados Dollar', 2),
  ('BDT', 'Taka', 2),
  ('BHD', 'Bahraini Dinar', 3),
  ('BIF', 'Burundi Franc', 0),
  ('BMD', 'Bermudian Dollar', 2),
  ('BND', 'Brunei Dollar', 2),
  ('BOB', 'Boliviano', 2),
  ('BOV', 'Mvdol', 2),
  ('BRL', 'Brazilian Real', 2),
  ('BSD', 'Bahamian Dollar', 2),
  ('BTN', 'Ngultrum', 2),
  ('BWP', 'Pula', 2),
  ('BYN', 'Belarusian Ruble', 2),
  ('BZD', 'Belize Dollar', 2),
  ('CAD', 'Canadian Dollar', 2),
  ('CDF', 'Congolese Franc', 2),
  ('CHE', 'WIR Euro', 2),
  ('CHF', 'Swiss Franc', 2),
  ('CHW', 'WIR Franc', 2),
  ('CLF', 'Unidad de Fomento', 4),
  ('CLP', 'Chilean Peso', 0),
  ('CNY', 'Yuan Renminbi', 2),
  ('COP', 'Colombian Peso', 2),
  ('COU', 'Unidad de Valor Real', 2),
  ('CRC', 'Costa Rican Colon', 2),
  ('CUP', 'Cuban Peso', 2),
  ('CVE', 'Cabo Verde Escudo', 2),
  ('CZK', 'Czech Koruna', 2),
  ('DJF', 'Djibouti Franc', 0),
  ('DKK', 'Danish Krone', 2),
  ('DOP', 'Dominican Peso', 2),
  ('DZD', 'Algerian Dinar', 2),
  ('EGP', 'Egyptian Pound', 2),
  ('ERN', 'Nakfa', 2),
  ('ETB', 'Ethiopian Birr', 2),
  ('EUR', 'Euro', 2),
  ('FJD', 'Fiji Dollar', 2),
  ('FKP', 'Falkland Islands Pound', 2),
  ('GBP', 'Pound Sterling', 2),
  ('GEL', 'Lari', 2),
  ('GHS', 'Ghana Cedi', 2),
  ('GIP', 'Gibraltar Pound', 2),
  ('GMD', 'Dalasi', 2),
  ('GNF', 'Guinean Franc', 0),
  ('GTQ', 'Quetzal', 2),
  ('GYD', 'Guyana Dollar', 2),
  ('HKD', 'Hong Kong Dollar', 2),
  ('HNL', 'Lempira', 2),
  ('HTG', 'Gourde', 2),
  ('HUF', 'Forint', 2),
  ('IDR', 'Rupiah', 2),
  ('ILS', 'New Israeli Sheqel', 2),
  ('INR', 'Indian Rupee', 2),
  ('IQD', 'Iraqi Dinar', 3),
  ('IRR', 'Iranian Rial', 2),
  ('ISK', 'Iceland Krona', 0),
  ('JMD', 'Jamaican Dollar', 2),
  ('JOD', 'Jordanian Dinar', 3),
  ('JPY', 'Yen', 0),
  ('KES', 'Kenyan Shilling', 2),
  ('KGS', 'Som', 2),
  ('KHR', 'Riel', 2),
  ('KMF', 'Comorian Franc', 0),
  ('KPW', 'North Korean Won', 2),
  ('KRW', 'Won', 0),
  ('KWD', 'Kuwaiti Dinar', 3),
  ('KYD', 'Cayman Islands Dollar', 2),
  ('KZT', 'Tenge', 2),
  ('LAK', 'Lao Kip', 2),
  ('LBP', 'Lebanese Pound', 2),
  ('LKR', 'Sri Lanka Rupee', 2),
  ('LRD', 'Liberian Dollar', 2),
  ('LSL', 'Loti', 2),
  ('LYD', 'Libyan Dinar', 3),
  ('MAD', 'Moroccan Dirham', 2),
  ('MDL', 'Moldovan Leu', 2),
  ('MGA', 'Malagasy Ariary', 2),
  ('MKD', 'Denar', 2),
  ('MMK', 'Kyat', 2),
  ('MNT', 'Tugrik', 2),
  ('MOP', 'Pataca', 2),
  ('MRU', 'Ouguiya', 2),
  ('MUR', 'Mauritius Rupee', 2),
  ('MVR', 'Rufiyaa', 2),
  ('MWK', 'Malawi Kwacha', 2),
  ('MXN', 'Mexican Peso', 2),
  ('MXV', 'Mexican Unidad de Inversion (UDI)', 2),
  ('MYR', 'Malaysian Ringgit', 2),
  ('MZN', 'Mozambique Metical', 2),
  ('NAD', 'Namibia Dollar', 2),
  ('NGN', 'Naira', 2),
  ('NIO', 'Cordoba Oro', 2),
  ('NOK', 'Norwegian Krone', 2),
  ('NPR', 'Nepalese Rupee', 2),
  ('NZD', 'New Zealand Dollar', 2),
  ('OMR', 'Rial Omani', 3),
  ('PAB', 'Balboa', 2),
  ('PEN', 'Sol', 2),
  ('PGK', 'Kina', 2),
  ('PHP', 'Philippine Peso', 2),
  ('PKR', 'Pakistan Rupee', 2),
  ('PLN', 'Zloty', 2),
  ('PYG', 'Guarani', 0),
  ('QAR', 'Qatari Rial', 2),
  ('RON', 'Romanian Leu', 2),
  ('RSD', 'Serbian Dinar', 2),
  ('RUB', 'Russian Ruble', 2),
  ('RWF', 'Rwanda Franc', 0),
  ('SAR', 'Saudi Riyal', 2),
  ('SBD', 'Solomon Islands Dollar', 2),
  ('SCR', 'Seychelles Rupee', 2),
  ('SDG', 'Sudanese Pound', 2),
  ('SEK', 'Swedish Krona', 2),
  ('SGD', 'Singapore Dollar', 2),
  ('SHP', 'Saint Helena Pound', 2),
  ('SLE', 'Leone', 2),
  ('SOS', 'Somali Shilling', 2),
  ('SRD', 'Surinam Dollar', 2),
  ('SSP', 'South Sudanese Pound', 2),
  ('STN', 'Dobra', 2),
  ('SVC', 'El Salvador Colon', 2),
  ('SYP', 'Syrian Pound', 2),
  ('SZL', 'Lilangeni', 2),
  ('THB', 'Baht', 2),
  ('TJS', 'Somoni', 2),
  ('TMT', 'Turkmenistan New Manat', 2),
  ('TND', 'Tunisian Dinar', 3),
  ('TOP', 'Pa’anga', 2),
  ('TRY', 'Turkish Lira', 2),
  ('TTD', 'Trinidad and Tobago Dollar', 2),
  ('TWD', 'New Taiwan Dollar', 2),
  ('TZS', 'Tanzanian Shilling', 2),
  ('UAH', 'Hryvnia', 2),
  ('UGX', 'Uganda Shilling', 0),
  ('USD', 'US Dollar', 2),
  ('USN', 'US Dollar (Next day)', 2),
  ('UYI', 'Uruguay Peso en Unidades Indexadas (UI)', 0),
  ('UYU', 'Peso Uruguayo', 2),
  ('UYW', 'Unidad Previsional', 4),
  ('UZS', 'Uzbekistan Sum', 2),
  ('VED', 'Bolívar Soberano', 2),
  ('VES', 'Bolívar Soberano', 2),
  ('VND', 'Dong', 0),
  ('VUV', 'Vatu', 0),
  ('WST', 'Tala', 2),
  ('XAD', 'Arab Accounting Dinar', 2),
  ('XAF', 'CFA Franc BEAC', 0),
  ('XCD', 'East Caribbean Dollar', 2),
  ('XCG', 'Caribbean Guilder', 2),
  ('XOF', 'CFA Franc BCEAO', 0),
  ('XPF', 'CFP Franc', 0),
  ('YER', 'Yemeni Rial', 2),
  ('ZAR', 'Rand', 2),
  ('ZMW', 'Zambian Kwacha', 2),
  ('ZWG', 'Zimbabwe Gold', 2);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  email_verified_at timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  pending_workspace_name text,
  CHECK (status IN ('active', 'disabled', 'deleted')),
  CONSTRAINT users_pending_workspace_name_ck CHECK (
    pending_workspace_name IS NULL OR (
      pending_workspace_name = btrim(pending_workspace_name)
      AND char_length(pending_workspace_name) BETWEEN 1 AND 120
    )
  )
);
COMMENT ON TABLE users IS 'Global login identity. A user can belong to one or more workspaces through workspace_members.';
COMMENT ON COLUMN users.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN users.email IS 'Primary login email address.';
COMMENT ON COLUMN users.password_hash IS 'Password hash for local login. Null when only external identity providers are enabled.';
COMMENT ON COLUMN users.first_name IS 'User given name.';
COMMENT ON COLUMN users.last_name IS 'User family name.';
COMMENT ON COLUMN users.status IS 'Login account state: active, disabled, or deleted.';
COMMENT ON COLUMN users.email_verified_at IS 'When the primary email was verified.';
COMMENT ON COLUMN users.last_login_at IS 'Last successful login timestamp.';
COMMENT ON COLUMN users.password_changed_at IS 'Last password update timestamp.';
COMMENT ON COLUMN users.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN users.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
COMMENT ON COLUMN users.deleted_at IS 'Soft-delete/anonymization timestamp.';
COMMENT ON COLUMN users.pending_workspace_name IS 'Workspace name a pending registration asked for, held until email verification provisions that workspace; null otherwise.';

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text,
  status text NOT NULL DEFAULT 'active',
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (status IN ('active', 'suspended', 'archived'))
);
COMMENT ON TABLE workspaces IS 'Tenant/workspace root. This replaces Monica accounts and is the ownership boundary for product data.';
COMMENT ON COLUMN workspaces.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN workspaces.name IS 'Workspace display name.';
COMMENT ON COLUMN workspaces.slug IS 'Optional human-readable URL slug; not used as a permanent identifier.';
COMMENT ON COLUMN workspaces.status IS 'Workspace lifecycle state: active, suspended, or archived.';
COMMENT ON COLUMN workspaces.created_by_user_id IS 'User that created the workspace, when known.';
COMMENT ON COLUMN workspaces.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN workspaces.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
COMMENT ON COLUMN workspaces.deleted_at IS 'Soft-delete timestamp for workspace closure or GDPR deletion workflow.';
CREATE UNIQUE INDEX workspaces_slug_unique ON workspaces (lower(slug)) WHERE slug IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'active',
  invited_by_member_id uuid,
  self_person_id uuid,
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id),
  CHECK (role IN ('owner', 'admin', 'member')),
  CHECK (status IN ('active', 'suspended', 'left')),
  CONSTRAINT workspace_members_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT workspace_members_invited_by_member_id_fkey FOREIGN KEY (workspace_id, invited_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (invited_by_member_id)
);
COMMENT ON TABLE workspace_members IS 'Membership row connecting a user to a workspace with role, state, and optional self-person link.';
COMMENT ON COLUMN workspace_members.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN workspace_members.workspace_id IS 'Workspace this membership belongs to.';
COMMENT ON COLUMN workspace_members.user_id IS 'User identity for this membership.';
COMMENT ON COLUMN workspace_members.role IS 'Workspace role, typically owner, admin, or member.';
COMMENT ON COLUMN workspace_members.status IS 'Membership state: active, suspended, or left; pending invitations live in workspace_invitations.';
COMMENT ON COLUMN workspace_members.invited_by_member_id IS 'Member who sent the invitation, if applicable.';
COMMENT ON COLUMN workspace_members.self_person_id IS 'Person/contact row representing this member inside the workspace address book.';
COMMENT ON COLUMN workspace_members.joined_at IS 'When the invitation was accepted or the membership became active.';
COMMENT ON COLUMN workspace_members.left_at IS 'When the member left or was removed.';
COMMENT ON COLUMN workspace_members.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN workspace_members.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);
CREATE UNIQUE INDEX workspace_members_self_person_unique ON workspace_members (self_person_id) WHERE self_person_id IS NOT NULL;

CREATE TABLE member_preferences (
  member_id uuid PRIMARY KEY REFERENCES workspace_members(id) ON DELETE CASCADE,
  timezone text,
  locale text NOT NULL DEFAULT 'en',
  temperature_scale text NOT NULL DEFAULT 'celsius',
  measurement_system text NOT NULL DEFAULT 'metric',
  currency_code char(3) REFERENCES currencies(code) ON DELETE SET NULL,
  contact_sort_order text NOT NULL DEFAULT 'given_name_asc',
  contact_name_order text NOT NULL DEFAULT 'given_family_nickname',
  fluid_layout boolean NOT NULL DEFAULT false,
  ui_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  reminder_delivery text NOT NULL DEFAULT 'in_app',
  digest_time time,
  CHECK (temperature_scale IN ('celsius', 'fahrenheit')),
  CHECK (measurement_system IN ('metric', 'imperial')),
  CONSTRAINT member_preferences_reminder_delivery_ck
    CHECK (reminder_delivery IN ('in_app', 'email', 'both'))
);
COMMENT ON TABLE member_preferences IS 'Per-member locale, timezone, display, sorting, measurement, and sparse UI-state preferences.';
COMMENT ON COLUMN member_preferences.member_id IS 'Member whose preferences are stored here.';
COMMENT ON COLUMN member_preferences.timezone IS 'IANA timezone used for local date display and reminder scheduling.';
COMMENT ON COLUMN member_preferences.locale IS 'Language/locale preference.';
COMMENT ON COLUMN member_preferences.temperature_scale IS 'Weather display scale.';
COMMENT ON COLUMN member_preferences.measurement_system IS 'Preferred measurement system for distances and other non-temperature units.';
COMMENT ON COLUMN member_preferences.currency_code IS 'Default currency for new money records.';
COMMENT ON COLUMN member_preferences.contact_sort_order IS 'Default contact list sort.';
COMMENT ON COLUMN member_preferences.contact_name_order IS 'Default name display order.';
COMMENT ON COLUMN member_preferences.fluid_layout IS 'Layout preference.';
COMMENT ON COLUMN member_preferences.ui_state IS 'Sparse presentation state such as active tabs and dismissed feature badges; never stores domain data.';
COMMENT ON COLUMN member_preferences.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
COMMENT ON COLUMN member_preferences.reminder_delivery IS 'Channels for every reminder occurrence not yet sent, including those already scheduled: in_app, email, or both; email requires a verified address.';
COMMENT ON COLUMN member_preferences.digest_time IS 'Local time of the daily email reminder digest in the member timezone, or UTC when none; null sends each email reminder when due.';


-- -----------------------------------------------------------------------------
-- Workspace vocabularies and profile configuration
-- -----------------------------------------------------------------------------

CREATE TABLE gender_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  sort_order integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gender_options_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE gender_options IS 'Workspace-level gender vocabulary. Replaces Monica genders while allowing custom labels.';
COMMENT ON COLUMN gender_options.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN gender_options.workspace_id IS 'Workspace that owns this option.';
COMMENT ON COLUMN gender_options.name IS 'Display label.';
COMMENT ON COLUMN gender_options.code IS 'Optional short internal code, such as m, f, nb, or custom.';
COMMENT ON COLUMN gender_options.sort_order IS 'Display order.';
COMMENT ON COLUMN gender_options.is_system IS 'Created from the app seed manifest rather than by a user.';
COMMENT ON COLUMN gender_options.is_archived IS 'Hidden for new selection but kept for existing people.';
COMMENT ON COLUMN gender_options.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN gender_options.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX gender_options_workspace_idx ON gender_options (workspace_id);
CREATE UNIQUE INDEX gender_options_workspace_name_unique ON gender_options (workspace_id, lower(name));

CREATE TABLE workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  default_locale text NOT NULL DEFAULT 'en',
  default_timezone text,
  default_currency_code char(3) REFERENCES currencies(code) ON DELETE SET NULL,
  default_gender_option_id uuid,
  default_reminder_time time NOT NULL DEFAULT '12:00',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_settings_default_gender_option_id_fkey FOREIGN KEY (workspace_id, default_gender_option_id) REFERENCES gender_options (workspace_id, id) ON DELETE SET NULL (default_gender_option_id)
);
COMMENT ON TABLE workspace_settings IS 'Typed workspace defaults used when creating members, people, and reminder schedules.';
COMMENT ON COLUMN workspace_settings.workspace_id IS 'Workspace these settings apply to.';
COMMENT ON COLUMN workspace_settings.default_locale IS 'Default locale for new members.';
COMMENT ON COLUMN workspace_settings.default_timezone IS 'Default timezone for new members and scheduled workflows.';
COMMENT ON COLUMN workspace_settings.default_currency_code IS 'Default workspace currency.';
COMMENT ON COLUMN workspace_settings.default_gender_option_id IS 'Default gender option for new people, when desired.';
COMMENT ON COLUMN workspace_settings.default_reminder_time IS 'Default local send time for reminder notifications.';
COMMENT ON COLUMN workspace_settings.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';

CREATE TABLE workspace_profile_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text,
  translation_key text,
  is_active boolean NOT NULL DEFAULT true,
  can_delete boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);
COMMENT ON TABLE workspace_profile_modules IS 'Profile-module toggles shown on person pages. Replaces Monica modules and default_contact_modules.';
COMMENT ON COLUMN workspace_profile_modules.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN workspace_profile_modules.workspace_id IS 'Workspace that owns this module toggle.';
COMMENT ON COLUMN workspace_profile_modules.key IS 'Stable feature/module key.';
COMMENT ON COLUMN workspace_profile_modules.name IS 'Display name if not translated by key.';
COMMENT ON COLUMN workspace_profile_modules.translation_key IS 'I18n key for seeded modules.';
COMMENT ON COLUMN workspace_profile_modules.is_active IS 'Whether the module appears in the profile UI.';
COMMENT ON COLUMN workspace_profile_modules.can_delete IS 'Whether a member can remove the module definition.';
COMMENT ON COLUMN workspace_profile_modules.sort_order IS 'Display order.';
COMMENT ON COLUMN workspace_profile_modules.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN workspace_profile_modules.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX workspace_profile_modules_active_idx ON workspace_profile_modules (workspace_id, is_active);

CREATE TABLE contact_method_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'custom',
  icon text,
  protocol text,
  is_system boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT true,
  is_archived boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name),
  CONSTRAINT contact_method_types_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE contact_method_types IS 'Workspace-defined contact method types: email, phone, URL, social profile, instant messaging, or custom.';
COMMENT ON COLUMN contact_method_types.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN contact_method_types.workspace_id IS 'Workspace that owns this type.';
COMMENT ON COLUMN contact_method_types.name IS 'Display name.';
COMMENT ON COLUMN contact_method_types.kind IS 'Broad kind: email, phone, url, social, im, username, or custom.';
COMMENT ON COLUMN contact_method_types.icon IS 'Icon name for UI display.';
COMMENT ON COLUMN contact_method_types.protocol IS 'URI protocol prefix such as mailto, tel, sms, https.';
COMMENT ON COLUMN contact_method_types.is_system IS 'Seeded app type.';
COMMENT ON COLUMN contact_method_types.can_delete IS 'Whether this type can be deleted.';
COMMENT ON COLUMN contact_method_types.is_archived IS 'Hidden for new use but retained for old methods.';
COMMENT ON COLUMN contact_method_types.sort_order IS 'Display order.';
COMMENT ON COLUMN contact_method_types.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN contact_method_types.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX contact_method_types_kind_idx ON contact_method_types (workspace_id, kind);

CREATE TABLE contact_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label text,
  translation_key text,
  applies_to text NOT NULL DEFAULT 'any',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (label IS NOT NULL OR translation_key IS NOT NULL),
  CHECK (applies_to IN ('any', 'contact_method', 'address')),
  CONSTRAINT contact_labels_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE contact_labels IS 'Reusable labels for contact methods and addresses. Replaces Monica contact_field_labels and label pivots.';
COMMENT ON COLUMN contact_labels.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN contact_labels.workspace_id IS 'Workspace that owns this label.';
COMMENT ON COLUMN contact_labels.label IS 'Custom display label.';
COMMENT ON COLUMN contact_labels.translation_key IS 'Seeded translated label key.';
COMMENT ON COLUMN contact_labels.applies_to IS 'Scope: any, contact_method, or address.';
COMMENT ON COLUMN contact_labels.is_system IS 'Created from seed manifest.';
COMMENT ON COLUMN contact_labels.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN contact_labels.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX contact_labels_workspace_idx ON contact_labels (workspace_id);

CREATE TABLE activity_type_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text,
  translation_key text,
  is_system boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_type_categories_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE activity_type_categories IS 'Workspace activity category vocabulary.';
COMMENT ON COLUMN activity_type_categories.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN activity_type_categories.workspace_id IS 'Workspace that owns this category.';
COMMENT ON COLUMN activity_type_categories.name IS 'Display name.';
COMMENT ON COLUMN activity_type_categories.translation_key IS 'I18n key for seeded categories.';
COMMENT ON COLUMN activity_type_categories.is_system IS 'Created from seed manifest.';
COMMENT ON COLUMN activity_type_categories.sort_order IS 'Display order.';
COMMENT ON COLUMN activity_type_categories.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN activity_type_categories.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX activity_type_categories_workspace_idx ON activity_type_categories (workspace_id);

CREATE TABLE activity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category_id uuid,
  name text,
  translation_key text,
  location_behavior text,
  is_system boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_types_category_id_fkey FOREIGN KEY (workspace_id, category_id) REFERENCES activity_type_categories (workspace_id, id) ON DELETE SET NULL (category_id),
  CONSTRAINT activity_types_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE activity_types IS 'Workspace activity types used by multi-person interactions.';
COMMENT ON COLUMN activity_types.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN activity_types.workspace_id IS 'Workspace that owns this type.';
COMMENT ON COLUMN activity_types.category_id IS 'Optional category.';
COMMENT ON COLUMN activity_types.name IS 'Display name.';
COMMENT ON COLUMN activity_types.translation_key IS 'I18n key for seeded types.';
COMMENT ON COLUMN activity_types.location_behavior IS 'How this type handles location, matching Monica''s location_type idea.';
COMMENT ON COLUMN activity_types.is_system IS 'Created from seed manifest.';
COMMENT ON COLUMN activity_types.is_archived IS 'Hidden for new activities but retained for history.';
COMMENT ON COLUMN activity_types.sort_order IS 'Display order.';
COMMENT ON COLUMN activity_types.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN activity_types.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX activity_types_workspace_idx ON activity_types (workspace_id);
CREATE INDEX activity_types_category_idx ON activity_types (category_id);

CREATE TABLE emotion_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES emotion_options(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE emotion_options IS 'Global hierarchical emotion taxonomy shared by activity and call tagging.';
COMMENT ON COLUMN emotion_options.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN emotion_options.parent_id IS 'Parent emotion in the hierarchy.';
COMMENT ON COLUMN emotion_options.name IS 'Emotion display name.';
COMMENT ON COLUMN emotion_options.is_active IS 'Whether the emotion remains selectable for new calls and activities.';
COMMENT ON COLUMN emotion_options.sort_order IS 'Display order.';
COMMENT ON COLUMN emotion_options.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN emotion_options.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX emotion_options_parent_idx ON emotion_options (parent_id);
CREATE INDEX emotion_options_active_idx ON emotion_options (is_active, sort_order);

-- Seeded once (v13): the Monica 4.x stock emotions, ordered by their Monica id.
INSERT INTO emotion_options (name, sort_order) VALUES
  ('adoration', 1),
  ('affection', 2),
  ('love', 3),
  ('fondness', 4),
  ('liking', 5),
  ('attraction', 6),
  ('caring', 7),
  ('tenderness', 8),
  ('compassion', 9),
  ('sentimentality', 10),
  ('arousal', 11),
  ('desire', 12),
  ('lust', 13),
  ('passion', 14),
  ('infatuation', 15),
  ('longing', 16),
  ('amusement', 17),
  ('bliss', 18),
  ('cheerfulness', 19),
  ('gaiety', 20),
  ('glee', 21),
  ('jolliness', 22),
  ('joviality', 23),
  ('joy', 24),
  ('delight', 25),
  ('enjoyment', 26),
  ('gladness', 27),
  ('happiness', 28),
  ('jubilation', 29),
  ('elation', 30),
  ('satisfaction', 31),
  ('ecstasy', 32),
  ('euphoria', 33),
  ('enthusiasm', 34),
  ('zeal', 35),
  ('zest', 36),
  ('excitement', 37),
  ('thrill', 38),
  ('exhilaration', 39),
  ('contentment', 40),
  ('pleasure', 41),
  ('pride', 42),
  ('eagerness', 44),
  ('hope', 45),
  ('enthrallment', 46),
  ('rapture', 47),
  ('relief', 48),
  ('amazement', 49),
  ('surprise', 50),
  ('astonishment', 51),
  ('aggravation', 52),
  ('irritation', 53),
  ('agitation', 54),
  ('annoyance', 55),
  ('grouchiness', 56),
  ('grumpiness', 57),
  ('exasperation', 58),
  ('frustration', 59),
  ('anger', 60),
  ('rage', 61),
  ('outrage', 62),
  ('fury', 63),
  ('wrath', 64),
  ('hostility', 65),
  ('ferocity', 66),
  ('bitterness', 67),
  ('hate', 68),
  ('loathing', 69),
  ('scorn', 70),
  ('spite', 71),
  ('vengefulness', 72),
  ('dislike', 73),
  ('resentment', 74),
  ('disgust', 75),
  ('revulsion', 76),
  ('contempt', 77),
  ('envy', 78),
  ('jealousy', 79),
  ('agony', 80),
  ('suffering', 81),
  ('hurt', 82),
  ('anguish', 83),
  ('depression', 84),
  ('despair', 85),
  ('hopelessness', 86),
  ('gloom', 87),
  ('glumness', 88),
  ('sadness', 89),
  ('unhappiness', 90),
  ('grief', 91),
  ('sorrow', 92),
  ('woe', 93),
  ('misery', 94),
  ('melancholy', 95),
  ('dismay', 96),
  ('disappointment', 97),
  ('displeasure', 98),
  ('guilt', 99),
  ('shame', 100),
  ('regret', 101),
  ('remorse', 102),
  ('alienation', 103),
  ('isolation', 104),
  ('neglect', 105),
  ('loneliness', 106),
  ('rejection', 107),
  ('homesickness', 108),
  ('defeat', 109),
  ('dejection', 110),
  ('insecurity', 111),
  ('embarrassment', 112),
  ('humiliation', 113),
  ('insult', 114),
  ('pity', 115),
  ('sympathy', 116),
  ('alarm', 117),
  ('shock', 118),
  ('fear', 119),
  ('fright', 120),
  ('horror', 121),
  ('terror', 122),
  ('panic', 123),
  ('hysteria', 124),
  ('mortification', 125),
  ('anxiety', 126),
  ('nervousness', 127),
  ('tenseness', 128),
  ('uneasiness', 129),
  ('apprehension', 130),
  ('worry', 131),
  ('distress', 132),
  ('dread', 133);

CREATE TABLE life_event_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  seed_key text,
  is_system boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT life_event_categories_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE life_event_categories IS 'Workspace life-event category vocabulary.';
COMMENT ON COLUMN life_event_categories.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN life_event_categories.workspace_id IS 'Workspace that owns this category.';
COMMENT ON COLUMN life_event_categories.name IS 'Display name.';
COMMENT ON COLUMN life_event_categories.seed_key IS 'Stable seed key for default categories.';
COMMENT ON COLUMN life_event_categories.is_system IS 'Created from seed manifest.';
COMMENT ON COLUMN life_event_categories.sort_order IS 'Display order.';
COMMENT ON COLUMN life_event_categories.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN life_event_categories.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX life_event_categories_workspace_idx ON life_event_categories (workspace_id);

CREATE TABLE life_event_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category_id uuid,
  name text,
  seed_key text,
  information_schema jsonb,
  is_system boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT life_event_types_category_id_fkey FOREIGN KEY (workspace_id, category_id) REFERENCES life_event_categories (workspace_id, id) ON DELETE SET NULL (category_id),
  CONSTRAINT life_event_types_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE life_event_types IS 'Workspace life-event type vocabulary with optional structured information schema.';
COMMENT ON COLUMN life_event_types.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN life_event_types.workspace_id IS 'Workspace that owns this type.';
COMMENT ON COLUMN life_event_types.category_id IS 'Category containing this type.';
COMMENT ON COLUMN life_event_types.name IS 'Display name.';
COMMENT ON COLUMN life_event_types.seed_key IS 'Stable seed key for default types.';
COMMENT ON COLUMN life_event_types.information_schema IS 'JSON Schema or field description for type-specific information.';
COMMENT ON COLUMN life_event_types.is_system IS 'Created from seed manifest.';
COMMENT ON COLUMN life_event_types.is_archived IS 'Hidden for new events but retained for history.';
COMMENT ON COLUMN life_event_types.sort_order IS 'Display order.';
COMMENT ON COLUMN life_event_types.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN life_event_types.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX life_event_types_workspace_idx ON life_event_types (workspace_id);
CREATE INDEX life_event_types_category_idx ON life_event_types (category_id);

CREATE TABLE relationship_type_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_type_groups_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE relationship_type_groups IS 'Workspace relationship grouping vocabulary.';
COMMENT ON COLUMN relationship_type_groups.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN relationship_type_groups.workspace_id IS 'Workspace that owns this group.';
COMMENT ON COLUMN relationship_type_groups.name IS 'Display name.';
COMMENT ON COLUMN relationship_type_groups.is_system IS 'Created from seed manifest.';
COMMENT ON COLUMN relationship_type_groups.can_delete IS 'Whether members can delete the group.';
COMMENT ON COLUMN relationship_type_groups.sort_order IS 'Display order.';
COMMENT ON COLUMN relationship_type_groups.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN relationship_type_groups.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX relationship_type_groups_workspace_idx ON relationship_type_groups (workspace_id);

CREATE TABLE relationship_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_id uuid,
  forward_label text NOT NULL,
  reverse_label text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_types_group_id_fkey FOREIGN KEY (workspace_id, group_id) REFERENCES relationship_type_groups (workspace_id, id) ON DELETE SET NULL (group_id),
  CONSTRAINT relationship_types_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE relationship_types IS 'Directional relationship labels with forward and reverse names.';
COMMENT ON COLUMN relationship_types.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN relationship_types.workspace_id IS 'Workspace that owns this type.';
COMMENT ON COLUMN relationship_types.group_id IS 'Group/category for this relationship type.';
COMMENT ON COLUMN relationship_types.forward_label IS 'Label when traversing from source person to target person.';
COMMENT ON COLUMN relationship_types.reverse_label IS 'Label when traversing from target person back to source person.';
COMMENT ON COLUMN relationship_types.is_system IS 'Created from seed manifest.';
COMMENT ON COLUMN relationship_types.can_delete IS 'Whether members can delete the type.';
COMMENT ON COLUMN relationship_types.is_archived IS 'Hidden for new relationships but retained for history.';
COMMENT ON COLUMN relationship_types.sort_order IS 'Display order.';
COMMENT ON COLUMN relationship_types.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN relationship_types.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX relationship_types_workspace_idx ON relationship_types (workspace_id);
CREATE INDEX relationship_types_group_idx ON relationship_types (group_id);

CREATE TABLE pet_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_common boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE pet_categories IS 'Global pet category catalog.';
COMMENT ON COLUMN pet_categories.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN pet_categories.name IS 'Pet category name.';
COMMENT ON COLUMN pet_categories.is_common IS 'Whether this category belongs to the common/default set shown prominently.';
COMMENT ON COLUMN pet_categories.is_active IS 'Whether this category is selectable for new pets.';
COMMENT ON COLUMN pet_categories.sort_order IS 'Display order.';
COMMENT ON COLUMN pet_categories.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN pet_categories.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE UNIQUE INDEX pet_categories_name_unique ON pet_categories (lower(name));
CREATE INDEX pet_categories_common_idx ON pet_categories (is_common, sort_order);

-- Seeded once (v13): the Monica 4.x stock pet categories, ordered by their Monica id.
INSERT INTO pet_categories (name, is_common, sort_order) VALUES
  ('reptile', false, 1),
  ('bird', false, 2),
  ('cat', true, 3),
  ('dog', true, 4),
  ('fish', true, 5),
  ('hamster', false, 6),
  ('horse', false, 7),
  ('rabbit', false, 8),
  ('rat', false, 9),
  ('small_animal', false, 10),
  ('other', false, 11);


-- -----------------------------------------------------------------------------
-- People, contact data, files, and work history
-- -----------------------------------------------------------------------------

CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_member_id uuid,
  gender_option_id uuid,
  given_name text NOT NULL DEFAULT '',
  middle_name text,
  family_name text,
  nickname text,
  description text,
  food_preferences text,
  is_partial boolean NOT NULL DEFAULT false,
  is_starred boolean NOT NULL DEFAULT false,
  is_deceased boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  sort_given_name text GENERATED ALWAYS AS (lower(COALESCE(NULLIF(btrim(given_name), ''), NULLIF(btrim(nickname), ''), NULLIF(btrim(family_name), ''), ''))) STORED,
  sort_family_name text GENERATED ALWAYS AS (lower(COALESCE(family_name, ''))) STORED,
  duplicate_given_name text GENERATED ALWAYS AS (lower(btrim(given_name))) STORED,
  duplicate_family_name text GENERATED ALWAYS AS (lower(btrim(COALESCE(family_name, '')))) STORED,
  duplicate_nickname text GENERATED ALWAYS AS (lower(btrim(COALESCE(nickname, '')))) STORED,
  CONSTRAINT people_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT people_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id),
  CONSTRAINT people_gender_option_id_fkey FOREIGN KEY (workspace_id, gender_option_id) REFERENCES gender_options (workspace_id, id) ON DELETE SET NULL (gender_option_id)
);
COMMENT ON TABLE people IS 'Core person/contact profile. Lifecycle is represented by partial, archived, deceased, and deleted fields rather than a second status column.';
COMMENT ON COLUMN people.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN people.workspace_id IS 'Workspace that owns this person.';
COMMENT ON COLUMN people.created_by_member_id IS 'Member that created the person, when known.';
COMMENT ON COLUMN people.gender_option_id IS 'Selected workspace gender option.';
COMMENT ON COLUMN people.given_name IS 'Given/first name.';
COMMENT ON COLUMN people.middle_name IS 'Middle name.';
COMMENT ON COLUMN people.family_name IS 'Family/last name.';
COMMENT ON COLUMN people.nickname IS 'Nickname shown with formal names.';
COMMENT ON COLUMN people.description IS 'Short profile description or bio.';
COMMENT ON COLUMN people.food_preferences IS 'Food, allergy, and dietary preferences.';
COMMENT ON COLUMN people.is_partial IS 'Incomplete/imported contact flag.';
COMMENT ON COLUMN people.is_starred IS 'Favorite/star flag.';
COMMENT ON COLUMN people.is_deceased IS 'Whether this person is known to be deceased.';
COMMENT ON COLUMN people.archived_at IS 'When the person was archived.';
COMMENT ON COLUMN people.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN people.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
COMMENT ON COLUMN people.deleted_at IS 'Soft-delete timestamp. Deleted people are hidden by default.';
COMMENT ON COLUMN people.sort_given_name IS 'Directory given-name sort key: the first non-blank of given name, nickname, and family name, lowercased; a stored column so the directory seeks its index under row-level security (v14).';
COMMENT ON COLUMN people.sort_family_name IS 'Directory given-name sort tie-breaker: the family name, lowercased (v14).';
COMMENT ON COLUMN people.duplicate_given_name IS 'Duplicate-name check key: the trimmed, lowercased given name (v14).';
COMMENT ON COLUMN people.duplicate_family_name IS 'Duplicate-name check key: the trimmed, lowercased family name, empty when there is none (v14).';
COMMENT ON COLUMN people.duplicate_nickname IS 'Duplicate-name check key: the trimmed, lowercased nickname, empty when there is none (v14).';
CREATE INDEX people_starred_idx ON people (workspace_id, is_starred);
CREATE INDEX people_active_given_name_idx ON people (workspace_id, sort_given_name, sort_family_name, id) WHERE archived_at IS NULL AND deleted_at IS NULL;
CREATE INDEX people_active_duplicate_name_idx ON people (workspace_id, duplicate_given_name, duplicate_family_name, duplicate_nickname) WHERE archived_at IS NULL AND deleted_at IS NULL;

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by_member_id uuid,
  original_filename text,
  storage_provider text NOT NULL DEFAULT 'local',
  storage_bucket text,
  storage_key text,
  byte_size bigint,
  mime_type text,
  checksum_sha256 text,
  status text NOT NULL DEFAULT 'available',
  visibility text NOT NULL DEFAULT 'private',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (byte_size IS NULL OR byte_size >= 0),
  CHECK (status IN ('available', 'missing', 'deleted', 'processing', 'quarantined')),
  CHECK (visibility IN ('private', 'workspace', 'public')),
  CONSTRAINT files_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT files_uploaded_by_member_id_fkey FOREIGN KEY (workspace_id, uploaded_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (uploaded_by_member_id)
);
COMMENT ON TABLE files IS 'Unified file metadata for photos, documents, avatars, exports, and import artifacts. File bytes live in object storage.';
COMMENT ON COLUMN files.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN files.workspace_id IS 'Workspace that owns the file and its storage lifecycle.';
COMMENT ON COLUMN files.uploaded_by_member_id IS 'Member who uploaded or generated the file.';
COMMENT ON COLUMN files.original_filename IS 'Original client filename.';
COMMENT ON COLUMN files.storage_provider IS 'Storage provider/disk such as local, s3, or gcs.';
COMMENT ON COLUMN files.storage_bucket IS 'Bucket/container name if applicable.';
COMMENT ON COLUMN files.storage_key IS 'Object-storage key or path.';
COMMENT ON COLUMN files.byte_size IS 'File size in bytes.';
COMMENT ON COLUMN files.mime_type IS 'MIME type.';
COMMENT ON COLUMN files.checksum_sha256 IS 'SHA-256 checksum when available.';
COMMENT ON COLUMN files.status IS 'available, missing, deleted, processing, or quarantined.';
COMMENT ON COLUMN files.visibility IS 'private, workspace, or public.';
COMMENT ON COLUMN files.metadata IS 'Non-domain file metadata such as image dimensions.';
COMMENT ON COLUMN files.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN files.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
COMMENT ON COLUMN files.deleted_at IS 'Soft-delete timestamp for file metadata.';
CREATE INDEX files_workspace_idx ON files (workspace_id);
CREATE INDEX files_storage_key_idx ON files (storage_provider, storage_bucket, storage_key);
CREATE INDEX files_status_idx ON files (workspace_id, status);

CREATE TABLE person_avatars (
  person_id uuid PRIMARY KEY,
  source text NOT NULL DEFAULT 'default',
  file_id uuid,
  external_url text,
  background_color text,
  initials text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source IN ('default', 'file', 'external', 'gravatar', 'generated')),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT person_avatars_file_id_fkey FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL (file_id),
  CONSTRAINT person_avatars_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN person_avatars.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE person_avatars IS 'Current avatar presentation for a person; provider-specific legacy payload remains only in redacted import staging.';
COMMENT ON COLUMN person_avatars.person_id IS 'Person whose avatar is configured.';
COMMENT ON COLUMN person_avatars.source IS 'default, file, external, gravatar, or generated.';
COMMENT ON COLUMN person_avatars.file_id IS 'Uploaded/generated file if source=file.';
COMMENT ON COLUMN person_avatars.external_url IS 'External avatar URL, including imported Gravatar/Adorable URLs.';
COMMENT ON COLUMN person_avatars.background_color IS 'Generated default avatar background color.';
COMMENT ON COLUMN person_avatars.initials IS 'Generated initials, when precomputed.';
COMMENT ON COLUMN person_avatars.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';

CREATE TABLE person_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  kind text NOT NULL,
  label text,
  year smallint,
  month smallint,
  day smallint,
  precision text NOT NULL DEFAULT 'full',
  is_age_based boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_year_approximate boolean NOT NULL DEFAULT false,
  CHECK (month IS NULL OR month BETWEEN 1 AND 12),
  CHECK (day IS NULL OR day BETWEEN 1 AND 31),
  CHECK (year IS NULL OR year BETWEEN 1 AND 9999),
  CHECK (precision IN ('full', 'year_month', 'month_day', 'year', 'month', 'day', 'unknown')),
  CONSTRAINT person_dates_is_year_approximate_ck
    CHECK (NOT is_year_approximate OR year IS NOT NULL),
  CHECK (
    (precision = 'full' AND year IS NOT NULL AND month IS NOT NULL AND day IS NOT NULL) OR
    (precision = 'year_month' AND year IS NOT NULL AND month IS NOT NULL AND day IS NULL) OR
    (precision = 'month_day' AND year IS NULL AND month IS NOT NULL AND day IS NOT NULL) OR
    (precision = 'year' AND year IS NOT NULL AND month IS NULL AND day IS NULL) OR
    (precision = 'month' AND year IS NULL AND month IS NOT NULL AND day IS NULL) OR
    (precision = 'day' AND year IS NULL AND month IS NULL AND day IS NOT NULL) OR
    (precision = 'unknown' AND year IS NULL AND month IS NULL AND day IS NULL)
  ),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT person_dates_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT person_dates_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON COLUMN person_dates.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE person_dates IS 'Important person dates with explicit precision. Replaces Monica special_dates and date pointers on contacts.';
COMMENT ON COLUMN person_dates.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN person_dates.person_id IS 'Person this date belongs to.';
COMMENT ON COLUMN person_dates.kind IS 'birthday, deceased, first_met, anniversary, custom, or another app-defined kind.';
COMMENT ON COLUMN person_dates.label IS 'Custom label for non-core dates.';
COMMENT ON COLUMN person_dates.year IS 'Year component; null means intentionally unknown.';
COMMENT ON COLUMN person_dates.month IS 'Month component; null means intentionally unknown.';
COMMENT ON COLUMN person_dates.day IS 'Day component; null means intentionally unknown.';
COMMENT ON COLUMN person_dates.precision IS 'Known-part precision: full, year_month, month_day, year, month, day, or unknown.';
COMMENT ON COLUMN person_dates.is_year_approximate IS 'Whether the stated year is approximate; false does not imply that an unknown year exists.';
COMMENT ON COLUMN person_dates.is_age_based IS 'Whether age should be computed/displayed when year is known.';
COMMENT ON COLUMN person_dates.notes IS 'Additional notes about the date.';
COMMENT ON COLUMN person_dates.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN person_dates.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX person_dates_person_kind_idx ON person_dates (person_id, kind);
CREATE INDEX person_dates_month_day_idx ON person_dates (month, day) WHERE month IS NOT NULL AND day IS NOT NULL;
CREATE UNIQUE INDEX person_dates_singleton_kind_unique ON person_dates (person_id, kind) WHERE kind IN ('birthday', 'deceased', 'first_met');

CREATE TABLE person_first_meetings (
  person_id uuid PRIMARY KEY,
  introduced_by_person_id uuid,
  location_id uuid,
  place_text text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (introduced_by_person_id IS NULL OR introduced_by_person_id <> person_id),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT person_first_meetings_introduced_by_person_id_fkey FOREIGN KEY (workspace_id, introduced_by_person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (introduced_by_person_id),
  CONSTRAINT person_first_meetings_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN person_first_meetings.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE person_first_meetings IS 'First-met context separated from the person row. Replaces contacts.first_met_where/additional_info/through_contact.';
COMMENT ON COLUMN person_first_meetings.person_id IS 'Person this first-meeting context describes.';
COMMENT ON COLUMN person_first_meetings.introduced_by_person_id IS 'Person through whom this person was introduced.';
COMMENT ON COLUMN person_first_meetings.location_id IS 'Structured location where the first meeting happened, if known; the date itself is the person_dates row with kind=first_met.';
COMMENT ON COLUMN person_first_meetings.place_text IS 'Free-text place/context where the member first met the person.';
COMMENT ON COLUMN person_first_meetings.notes IS 'Additional first-met narrative.';
COMMENT ON COLUMN person_first_meetings.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';

CREATE TABLE person_contact_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  type_id uuid NOT NULL,
  value text NOT NULL,
  normalized_value text,
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT person_contact_methods_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT person_contact_methods_type_id_fkey FOREIGN KEY (workspace_id, type_id) REFERENCES contact_method_types (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT person_contact_methods_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON COLUMN person_contact_methods.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE person_contact_methods IS 'Typed contact values such as email, phone, social profile, URL, and custom identifiers.';
COMMENT ON COLUMN person_contact_methods.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN person_contact_methods.person_id IS 'Person this value belongs to.';
COMMENT ON COLUMN person_contact_methods.type_id IS 'Workspace contact-method type.';
COMMENT ON COLUMN person_contact_methods.value IS 'Raw user-entered value.';
COMMENT ON COLUMN person_contact_methods.normalized_value IS 'Normalized email/phone/URL for searching and deduplication.';
COMMENT ON COLUMN person_contact_methods.is_primary IS 'Whether this is the primary value for its type/kind.';
COMMENT ON COLUMN person_contact_methods.sort_order IS 'Display order.';
COMMENT ON COLUMN person_contact_methods.notes IS 'Optional notes about the value.';
COMMENT ON COLUMN person_contact_methods.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN person_contact_methods.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX person_contact_methods_person_idx ON person_contact_methods (person_id);
CREATE INDEX person_contact_methods_type_idx ON person_contact_methods (type_id);
CREATE UNIQUE INDEX person_contact_methods_primary_per_type_unique ON person_contact_methods (person_id, type_id) WHERE is_primary;

CREATE TABLE person_contact_method_labels (
  contact_method_id uuid NOT NULL,
  label_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_method_id, label_id),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT person_contact_method_labels_contact_method_id_fkey FOREIGN KEY (workspace_id, contact_method_id) REFERENCES person_contact_methods (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT person_contact_method_labels_label_id_fkey FOREIGN KEY (workspace_id, label_id) REFERENCES contact_labels (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN person_contact_method_labels.workspace_id IS 'Workspace of the person contact methods row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE person_contact_method_labels IS 'Many-to-many labels for contact methods, preserving Monica''s label pivot without forcing a single label.';
COMMENT ON COLUMN person_contact_method_labels.contact_method_id IS 'Contact method being labeled.';
COMMENT ON COLUMN person_contact_method_labels.label_id IS 'Label assigned to the contact method.';
COMMENT ON COLUMN person_contact_method_labels.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX person_contact_method_labels_label_idx ON person_contact_method_labels (label_id);

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label text,
  street text,
  city text,
  region text,
  postal_code text,
  country text,
  latitude double precision,
  longitude double precision,
  geocoded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT locations_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE locations IS 'Structured postal/geographical place data. Replaces Monica places and is also used by weather/geocoding adapters.';
COMMENT ON COLUMN locations.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN locations.workspace_id IS 'Workspace that owns this location.';
COMMENT ON COLUMN locations.label IS 'Optional display label for the location.';
COMMENT ON COLUMN locations.street IS 'Street address line.';
COMMENT ON COLUMN locations.city IS 'City/locality.';
COMMENT ON COLUMN locations.region IS 'Province/state/region.';
COMMENT ON COLUMN locations.postal_code IS 'Postal or ZIP code.';
COMMENT ON COLUMN locations.country IS 'Country name or code as entered/normalized by the application; not restricted to an import-specific code width.';
COMMENT ON COLUMN locations.latitude IS 'Latitude coordinate.';
COMMENT ON COLUMN locations.longitude IS 'Longitude coordinate.';
COMMENT ON COLUMN locations.geocoded_at IS 'When coordinates were last geocoded.';
COMMENT ON COLUMN locations.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN locations.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX locations_workspace_idx ON locations (workspace_id);
CREATE INDEX locations_geo_idx ON locations (workspace_id, latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE TABLE person_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  location_id uuid,
  display_name text,
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT person_addresses_location_id_fkey FOREIGN KEY (workspace_id, location_id) REFERENCES locations (workspace_id, id) ON DELETE SET NULL (location_id),
  CONSTRAINT person_addresses_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT person_addresses_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON COLUMN person_addresses.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE person_addresses IS 'Address links between people and locations. Replaces Monica addresses.';
COMMENT ON COLUMN person_addresses.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN person_addresses.person_id IS 'Person this address belongs to.';
COMMENT ON COLUMN person_addresses.location_id IS 'Structured location details.';
COMMENT ON COLUMN person_addresses.display_name IS 'Address display name, such as Home or Office.';
COMMENT ON COLUMN person_addresses.is_primary IS 'Whether this is the primary address.';
COMMENT ON COLUMN person_addresses.sort_order IS 'Display order.';
COMMENT ON COLUMN person_addresses.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN person_addresses.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX person_addresses_person_idx ON person_addresses (person_id);
CREATE INDEX person_addresses_location_idx ON person_addresses (location_id);
CREATE UNIQUE INDEX person_addresses_primary_unique ON person_addresses (person_id) WHERE is_primary;

CREATE TABLE person_address_labels (
  address_id uuid NOT NULL,
  label_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (address_id, label_id),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT person_address_labels_address_id_fkey FOREIGN KEY (workspace_id, address_id) REFERENCES person_addresses (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT person_address_labels_label_id_fkey FOREIGN KEY (workspace_id, label_id) REFERENCES contact_labels (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN person_address_labels.workspace_id IS 'Workspace of the person addresses row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE person_address_labels IS 'Many-to-many labels for addresses.';
COMMENT ON COLUMN person_address_labels.address_id IS 'Address being labeled.';
COMMENT ON COLUMN person_address_labels.label_id IS 'Label assigned to the address.';
COMMENT ON COLUMN person_address_labels.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX person_address_labels_label_idx ON person_address_labels (label_id);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  website text,
  employee_count integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE organizations IS 'Workspace organizations/employers. Replaces Monica companies.';
COMMENT ON COLUMN organizations.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN organizations.workspace_id IS 'Workspace that owns this organization.';
COMMENT ON COLUMN organizations.name IS 'Organization/company name.';
COMMENT ON COLUMN organizations.website IS 'Organization website.';
COMMENT ON COLUMN organizations.employee_count IS 'Approximate number of employees.';
COMMENT ON COLUMN organizations.notes IS 'Optional organization notes.';
COMMENT ON COLUMN organizations.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN organizations.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX organizations_workspace_idx ON organizations (workspace_id);
CREATE UNIQUE INDEX organizations_workspace_name_unique ON organizations (workspace_id, lower(name));

CREATE TABLE person_occupations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  organization_id uuid,
  title text NOT NULL,
  description text,
  salary_amount numeric(19,4),
  salary_currency_code char(3) REFERENCES currencies(code) ON DELETE SET NULL,
  salary_unit text,
  is_current boolean NOT NULL DEFAULT false,
  start_on date,
  end_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (salary_amount IS NULL OR salary_amount >= 0),
  CHECK (end_on IS NULL OR start_on IS NULL OR end_on >= start_on),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT person_occupations_organization_id_fkey FOREIGN KEY (workspace_id, organization_id) REFERENCES organizations (workspace_id, id) ON DELETE SET NULL (organization_id),
  CONSTRAINT person_occupations_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN person_occupations.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE person_occupations IS 'Employment history and current work records. Replaces Monica occupations plus legacy contacts.company/job.';
COMMENT ON COLUMN person_occupations.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN person_occupations.person_id IS 'Person with this occupation.';
COMMENT ON COLUMN person_occupations.organization_id IS 'Employer/organization.';
COMMENT ON COLUMN person_occupations.title IS 'Job title or role.';
COMMENT ON COLUMN person_occupations.description IS 'Role description.';
COMMENT ON COLUMN person_occupations.salary_amount IS 'Optional salary amount.';
COMMENT ON COLUMN person_occupations.salary_currency_code IS 'Salary currency, if salary is stored.';
COMMENT ON COLUMN person_occupations.salary_unit IS 'Salary cadence/unit such as year, month, hour.';
COMMENT ON COLUMN person_occupations.is_current IS 'Whether the person currently works here.';
COMMENT ON COLUMN person_occupations.start_on IS 'Occupation start date.';
COMMENT ON COLUMN person_occupations.end_on IS 'Occupation end date.';
COMMENT ON COLUMN person_occupations.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN person_occupations.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX person_occupations_person_idx ON person_occupations (person_id);
CREATE INDEX person_occupations_org_idx ON person_occupations (organization_id);

CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug),
  CONSTRAINT tags_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE tags IS 'Workspace tags for grouping people. Replaces Monica tags.';
COMMENT ON COLUMN tags.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN tags.workspace_id IS 'Workspace that owns this tag.';
COMMENT ON COLUMN tags.name IS 'Tag display name.';
COMMENT ON COLUMN tags.slug IS 'Stable slug generated from the tag name.';
COMMENT ON COLUMN tags.description IS 'Tag description.';
COMMENT ON COLUMN tags.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN tags.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';

CREATE TABLE person_tags (
  person_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, tag_id),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT person_tags_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT person_tags_tag_id_fkey FOREIGN KEY (workspace_id, tag_id) REFERENCES tags (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN person_tags.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE person_tags IS 'Many-to-many link between people and tags. Replaces Monica contact_tag.';
COMMENT ON COLUMN person_tags.person_id IS 'Tagged person.';
COMMENT ON COLUMN person_tags.tag_id IS 'Assigned tag.';
COMMENT ON COLUMN person_tags.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX person_tags_tag_idx ON person_tags (tag_id);

CREATE TABLE pets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  category_id uuid REFERENCES pet_categories(id) ON DELETE SET NULL,
  name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE pets IS 'Pets associated with a person. Replaces Monica pets.';
COMMENT ON COLUMN pets.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN pets.person_id IS 'Person associated with the pet.';
COMMENT ON COLUMN pets.category_id IS 'Pet category.';
COMMENT ON COLUMN pets.name IS 'Pet name.';
COMMENT ON COLUMN pets.notes IS 'Optional pet notes.';
COMMENT ON COLUMN pets.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN pets.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX pets_person_idx ON pets (person_id);
CREATE INDEX pets_category_idx ON pets (category_id);

CREATE TABLE person_duplicate_dismissals (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_low_id uuid NOT NULL,
  person_high_id uuid NOT NULL,
  dismissed_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, person_low_id, person_high_id),
  CONSTRAINT person_duplicate_dismissals_order_ck CHECK (person_low_id < person_high_id),
  CONSTRAINT person_duplicate_dismissals_low_person_fk FOREIGN KEY (workspace_id, person_low_id) REFERENCES people(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT person_duplicate_dismissals_high_person_fk FOREIGN KEY (workspace_id, person_high_id) REFERENCES people(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT person_duplicate_dismissals_dismissed_by_member_id_fkey FOREIGN KEY (workspace_id, dismissed_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (dismissed_by_member_id)
);
COMMENT ON TABLE person_duplicate_dismissals IS 'Workspace-shared decisions that two people are not duplicates. Each unordered pair is stored once, lower person id first.';
COMMENT ON COLUMN person_duplicate_dismissals.workspace_id IS 'Workspace that owns the decision and both people.';
COMMENT ON COLUMN person_duplicate_dismissals.person_low_id IS 'The pair member with the lower id; same workspace by composite foreign key.';
COMMENT ON COLUMN person_duplicate_dismissals.person_high_id IS 'The pair member with the higher id; same workspace by composite foreign key.';
COMMENT ON COLUMN person_duplicate_dismissals.dismissed_by_member_id IS 'Member who marked the pair as not duplicates, when still known.';
COMMENT ON COLUMN person_duplicate_dismissals.created_at IS 'When the pair was dismissed, in UTC.';
CREATE INDEX person_duplicate_dismissals_high_idx ON person_duplicate_dismissals (workspace_id, person_high_id);

CREATE TABLE person_file_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  file_id uuid NOT NULL,
  kind text NOT NULL,
  title text,
  description text,
  document_type text,
  download_count integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, file_id, kind),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT person_file_links_file_id_fkey FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT person_file_links_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN person_file_links.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE person_file_links IS 'Links files to people as photos, documents, or other person-owned attachments. Replaces photos, contact_photo, and documents.';
COMMENT ON COLUMN person_file_links.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN person_file_links.person_id IS 'Person the file belongs to.';
COMMENT ON COLUMN person_file_links.file_id IS 'Linked file metadata.';
COMMENT ON COLUMN person_file_links.kind IS 'photo, document, avatar_candidate, or other app-defined kind.';
COMMENT ON COLUMN person_file_links.title IS 'Attachment title.';
COMMENT ON COLUMN person_file_links.description IS 'Attachment description.';
COMMENT ON COLUMN person_file_links.document_type IS 'Optional document classification.';
COMMENT ON COLUMN person_file_links.download_count IS 'Download counter for document links.';
COMMENT ON COLUMN person_file_links.sort_order IS 'Display order.';
COMMENT ON COLUMN person_file_links.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN person_file_links.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX person_file_links_file_idx ON person_file_links (file_id);


-- -----------------------------------------------------------------------------
-- Interactions, communications, journal, and life events
-- -----------------------------------------------------------------------------

CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  activity_type_id uuid,
  summary text NOT NULL,
  description text,
  happened_at timestamptz NOT NULL,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activities_activity_type_id_fkey FOREIGN KEY (workspace_id, activity_type_id) REFERENCES activity_types (workspace_id, id) ON DELETE SET NULL (activity_type_id),
  CONSTRAINT activities_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id),
  CONSTRAINT activities_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE activities IS 'Multi-person interactions/events. Replaces Monica activities without denormalized contact counters.';
COMMENT ON COLUMN activities.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN activities.workspace_id IS 'Workspace that owns this activity.';
COMMENT ON COLUMN activities.activity_type_id IS 'Activity type.';
COMMENT ON COLUMN activities.summary IS 'Short activity summary.';
COMMENT ON COLUMN activities.description IS 'Detailed activity description.';
COMMENT ON COLUMN activities.happened_at IS 'When the activity occurred; timestamp precision avoids losing Monica happened_at values.';
COMMENT ON COLUMN activities.created_by_member_id IS 'Member who created the activity.';
COMMENT ON COLUMN activities.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN activities.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX activities_type_idx ON activities (activity_type_id);
CREATE INDEX activities_workspace_time_idx ON activities (workspace_id, happened_at DESC);
CREATE INDEX activities_search_idx ON activities USING gin (to_tsvector('simple', summary || ' ' || coalesce(description, '')));

CREATE TABLE activity_participants (
  activity_id uuid NOT NULL,
  person_id uuid NOT NULL,
  role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, person_id),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT activity_participants_activity_id_fkey FOREIGN KEY (workspace_id, activity_id) REFERENCES activities (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT activity_participants_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN activity_participants.workspace_id IS 'Workspace of the activities row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE activity_participants IS 'People participating in an activity. Replaces Monica activity_contact.';
COMMENT ON COLUMN activity_participants.activity_id IS 'Activity.';
COMMENT ON COLUMN activity_participants.person_id IS 'Participating person.';
COMMENT ON COLUMN activity_participants.role IS 'Optional participant role.';
COMMENT ON COLUMN activity_participants.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX activity_participants_person_idx ON activity_participants (person_id);

CREATE TABLE activity_emotions (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  emotion_id uuid NOT NULL REFERENCES emotion_options(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, emotion_id)
);
COMMENT ON TABLE activity_emotions IS 'Emotion tags attached to activities. Replaces Monica emotion_activity.';
COMMENT ON COLUMN activity_emotions.activity_id IS 'Activity.';
COMMENT ON COLUMN activity_emotions.emotion_id IS 'Selected emotion.';
COMMENT ON COLUMN activity_emotions.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX activity_emotions_emotion_idx ON activity_emotions (emotion_id);

CREATE TABLE calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  called_at timestamptz NOT NULL,
  contact_was_caller boolean NOT NULL DEFAULT false,
  content text,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calls_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id),
  CONSTRAINT calls_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE calls IS 'Logged calls with a person. Replaces Monica calls.';
COMMENT ON COLUMN calls.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN calls.workspace_id IS 'Workspace that owns this call.';
COMMENT ON COLUMN calls.person_id IS 'Person involved in the call.';
COMMENT ON COLUMN calls.called_at IS 'When the call happened.';
COMMENT ON COLUMN calls.contact_was_caller IS 'Whether the person/contact was recorded as the caller; application views may derive labels without guessing during import.';
COMMENT ON COLUMN calls.content IS 'Call notes/content.';
COMMENT ON COLUMN calls.created_by_member_id IS 'Member who logged the call.';
COMMENT ON COLUMN calls.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN calls.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX calls_person_date_idx ON calls (person_id, called_at DESC);
CREATE INDEX calls_workspace_date_idx ON calls (workspace_id, called_at DESC);

CREATE TABLE call_emotions (
  call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  emotion_id uuid NOT NULL REFERENCES emotion_options(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (call_id, emotion_id)
);
COMMENT ON TABLE call_emotions IS 'Emotion tags attached to calls. Replaces Monica emotion_call.';
COMMENT ON COLUMN call_emotions.call_id IS 'Call.';
COMMENT ON COLUMN call_emotions.emotion_id IS 'Selected emotion.';
COMMENT ON COLUMN call_emotions.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX call_emotions_emotion_idx ON call_emotions (emotion_id);

CREATE TABLE conversation_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  channel_type_id uuid,
  contact_method_id uuid,
  happened_at timestamptz NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_threads_channel_type_id_fkey FOREIGN KEY (workspace_id, channel_type_id) REFERENCES contact_method_types (workspace_id, id) ON DELETE SET NULL (channel_type_id),
  CONSTRAINT conversation_threads_contact_method_id_fkey FOREIGN KEY (workspace_id, contact_method_id) REFERENCES person_contact_methods (workspace_id, id) ON DELETE SET NULL (contact_method_id),
  CONSTRAINT conversation_threads_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT conversation_threads_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE conversation_threads IS 'Messaging/conversation thread with a person. Replaces Monica conversations.';
COMMENT ON COLUMN conversation_threads.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN conversation_threads.workspace_id IS 'Workspace that owns this conversation.';
COMMENT ON COLUMN conversation_threads.person_id IS 'Person this conversation is with.';
COMMENT ON COLUMN conversation_threads.channel_type_id IS 'Channel type such as email, SMS, or social.';
COMMENT ON COLUMN conversation_threads.contact_method_id IS 'Specific contact method used, if known.';
COMMENT ON COLUMN conversation_threads.happened_at IS 'Conversation start or representative date.';
COMMENT ON COLUMN conversation_threads.title IS 'Optional thread title.';
COMMENT ON COLUMN conversation_threads.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN conversation_threads.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX conversation_threads_person_idx ON conversation_threads (person_id, happened_at DESC);
CREATE INDEX conversation_threads_workspace_idx ON conversation_threads (workspace_id, happened_at DESC);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  content text NOT NULL,
  written_at timestamptz NOT NULL,
  direction text NOT NULL,
  author_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (direction IN ('inbound', 'outbound')),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT messages_author_member_id_fkey FOREIGN KEY (workspace_id, author_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (author_member_id),
  CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversation_threads (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN messages.workspace_id IS 'Workspace of the conversation threads row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE messages IS 'Individual messages inside a conversation. Replaces Monica messages.';
COMMENT ON COLUMN messages.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN messages.conversation_id IS 'Thread containing the message.';
COMMENT ON COLUMN messages.content IS 'Message body.';
COMMENT ON COLUMN messages.written_at IS 'When the message was written.';
COMMENT ON COLUMN messages.direction IS 'inbound or outbound.';
COMMENT ON COLUMN messages.author_member_id IS 'Member author for outbound messages, if known.';
COMMENT ON COLUMN messages.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN messages.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX messages_conversation_idx ON messages (conversation_id, written_at);

CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  body text NOT NULL,
  is_favorited boolean NOT NULL DEFAULT false,
  favorited_at timestamptz,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((is_favorited AND favorited_at IS NOT NULL) OR (NOT is_favorited)),
  CONSTRAINT notes_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id),
  CONSTRAINT notes_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE notes IS 'Free-form notes attached to people. Replaces Monica notes.';
COMMENT ON COLUMN notes.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN notes.workspace_id IS 'Workspace that owns this note.';
COMMENT ON COLUMN notes.person_id IS 'Person this note belongs to.';
COMMENT ON COLUMN notes.body IS 'Note body.';
COMMENT ON COLUMN notes.is_favorited IS 'Favorite note flag.';
COMMENT ON COLUMN notes.favorited_at IS 'When the note was marked favorite.';
COMMENT ON COLUMN notes.created_by_member_id IS 'Member who created the note.';
COMMENT ON COLUMN notes.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN notes.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX notes_person_idx ON notes (person_id, created_at DESC);
CREATE INDEX notes_favorite_idx ON notes (workspace_id, is_favorited);
CREATE INDEX notes_search_idx ON notes USING gin (to_tsvector('simple', body));
CREATE INDEX notes_workspace_created_idx ON notes (workspace_id, created_at DESC, id DESC);

CREATE TABLE journal_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text,
  body text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_posts_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id),
  CONSTRAINT journal_posts_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE journal_posts IS 'Manual journal entries. Replaces Monica entries with the journal date kept on the row.';
COMMENT ON COLUMN journal_posts.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN journal_posts.workspace_id IS 'Workspace that owns this post.';
COMMENT ON COLUMN journal_posts.title IS 'Journal title.';
COMMENT ON COLUMN journal_posts.body IS 'Journal post body.';
COMMENT ON COLUMN journal_posts.occurred_at IS 'Journal/timeline date.';
COMMENT ON COLUMN journal_posts.created_by_member_id IS 'Member who wrote the post.';
COMMENT ON COLUMN journal_posts.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN journal_posts.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX journal_posts_workspace_date_idx ON journal_posts (workspace_id, occurred_at DESC);
CREATE INDEX journal_posts_search_idx ON journal_posts USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || body));

CREATE TABLE journal_day_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rated_on date NOT NULL,
  rating integer NOT NULL,
  comment text,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, rated_on),
  CONSTRAINT journal_day_ratings_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id),
  CONSTRAINT journal_day_ratings_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE journal_day_ratings IS 'Daily mood/rating records. Replaces Monica days.';
COMMENT ON COLUMN journal_day_ratings.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN journal_day_ratings.workspace_id IS 'Workspace that owns this day rating.';
COMMENT ON COLUMN journal_day_ratings.rated_on IS 'Calendar day being rated.';
COMMENT ON COLUMN journal_day_ratings.rating IS 'User''s daily rating.';
COMMENT ON COLUMN journal_day_ratings.comment IS 'Optional comment.';
COMMENT ON COLUMN journal_day_ratings.created_by_member_id IS 'Member who created the rating.';
COMMENT ON COLUMN journal_day_ratings.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN journal_day_ratings.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';

CREATE TABLE journal_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  activity_id uuid,
  journal_post_id uuid,
  day_rating_id uuid,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (((activity_id IS NOT NULL)::int + (journal_post_id IS NOT NULL)::int + (day_rating_id IS NOT NULL)::int) = 1),
  CONSTRAINT journal_items_activity_id_fkey FOREIGN KEY (workspace_id, activity_id) REFERENCES activities (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT journal_items_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id),
  CONSTRAINT journal_items_day_rating_id_fkey FOREIGN KEY (workspace_id, day_rating_id) REFERENCES journal_day_ratings (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT journal_items_journal_post_id_fkey FOREIGN KEY (workspace_id, journal_post_id) REFERENCES journal_posts (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE journal_items IS 'Typed journal/timeline index. Replaces Monica polymorphic journal_entries with explicit nullable foreign keys.';
COMMENT ON COLUMN journal_items.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN journal_items.workspace_id IS 'Workspace that owns this journal item.';
COMMENT ON COLUMN journal_items.occurred_at IS 'Timeline date/time.';
COMMENT ON COLUMN journal_items.activity_id IS 'Activity represented in the journal.';
COMMENT ON COLUMN journal_items.journal_post_id IS 'Journal post represented in the journal.';
COMMENT ON COLUMN journal_items.day_rating_id IS 'Day rating represented in the journal.';
COMMENT ON COLUMN journal_items.created_by_member_id IS 'Member who created the journal item.';
COMMENT ON COLUMN journal_items.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN journal_items.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX journal_items_workspace_date_idx ON journal_items (workspace_id, occurred_at DESC);
CREATE UNIQUE INDEX journal_items_activity_unique ON journal_items (activity_id) WHERE activity_id IS NOT NULL;
CREATE UNIQUE INDEX journal_items_post_unique ON journal_items (journal_post_id) WHERE journal_post_id IS NOT NULL;
CREATE UNIQUE INDEX journal_items_day_rating_unique ON journal_items (day_rating_id) WHERE day_rating_id IS NOT NULL;

CREATE TABLE life_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  life_event_type_id uuid,
  name text,
  note text,
  year smallint,
  month smallint,
  day smallint,
  happened_at timestamptz,
  precision text NOT NULL DEFAULT 'full',
  specific_information jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (month IS NULL OR month BETWEEN 1 AND 12),
  CHECK (day IS NULL OR day BETWEEN 1 AND 31),
  CHECK (year IS NULL OR year BETWEEN 1 AND 9999),
  CHECK (precision IN ('full', 'year_month', 'month_day', 'year', 'month', 'day', 'unknown')),
  CONSTRAINT life_events_life_event_type_id_fkey FOREIGN KEY (workspace_id, life_event_type_id) REFERENCES life_event_types (workspace_id, id) ON DELETE SET NULL (life_event_type_id),
  CONSTRAINT life_events_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT life_events_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE life_events IS 'Typed milestones for a person with precision-aware dates. Replaces Monica life_events.';
COMMENT ON COLUMN life_events.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN life_events.workspace_id IS 'Workspace that owns this event.';
COMMENT ON COLUMN life_events.person_id IS 'Person this life event belongs to.';
COMMENT ON COLUMN life_events.life_event_type_id IS 'Life-event type.';
COMMENT ON COLUMN life_events.name IS 'Event display name.';
COMMENT ON COLUMN life_events.note IS 'Event notes.';
COMMENT ON COLUMN life_events.year IS 'Year component; null means unknown.';
COMMENT ON COLUMN life_events.month IS 'Month component; null means unknown.';
COMMENT ON COLUMN life_events.day IS 'Day component; null means unknown.';
COMMENT ON COLUMN life_events.happened_at IS 'Complete date/time when all relevant components are known.';
COMMENT ON COLUMN life_events.precision IS 'full, year_month, month_day, year, month, day, or unknown.';
COMMENT ON COLUMN life_events.specific_information IS 'Type-specific information payload.';
COMMENT ON COLUMN life_events.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN life_events.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX life_events_person_idx ON life_events (person_id);
CREATE INDEX life_events_workspace_date_idx ON life_events (workspace_id, happened_at DESC);


-- -----------------------------------------------------------------------------
-- Tasks, reminders, relationships, gifts, and debts
-- -----------------------------------------------------------------------------

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id uuid,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open',
  due_at timestamptz,
  completed_at timestamptz,
  completed_by_member_id uuid,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (status IN ('open', 'completed', 'cancelled')),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CONSTRAINT tasks_completed_by_member_id_fkey FOREIGN KEY (workspace_id, completed_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (completed_by_member_id),
  CONSTRAINT tasks_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id),
  CONSTRAINT tasks_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (person_id),
  CONSTRAINT tasks_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE tasks IS 'Workspace or person-scoped tasks. Replaces Monica tasks and supports CalDAV through dav_objects.';
COMMENT ON COLUMN tasks.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN tasks.workspace_id IS 'Workspace that owns this task.';
COMMENT ON COLUMN tasks.person_id IS 'Related person, if any.';
COMMENT ON COLUMN tasks.title IS 'Task title.';
COMMENT ON COLUMN tasks.description IS 'Task description.';
COMMENT ON COLUMN tasks.status IS 'Task state: open, completed, or cancelled.';
COMMENT ON COLUMN tasks.due_at IS 'Optional due date/time.';
COMMENT ON COLUMN tasks.completed_at IS 'When the task was completed.';
COMMENT ON COLUMN tasks.completed_by_member_id IS 'Member who completed the task.';
COMMENT ON COLUMN tasks.created_by_member_id IS 'Member who created the task.';
COMMENT ON COLUMN tasks.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN tasks.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
COMMENT ON COLUMN tasks.deleted_at IS 'Soft-delete timestamp.';
CREATE INDEX tasks_workspace_status_idx ON tasks (workspace_id, status);
CREATE INDEX tasks_person_idx ON tasks (person_id);
CREATE INDEX tasks_due_idx ON tasks (workspace_id, due_at) WHERE due_at IS NOT NULL;
CREATE INDEX tasks_search_idx ON tasks USING gin (to_tsvector('simple', title || ' ' || coalesce(description, '')));

CREATE TABLE reminder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  days_before integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, days_before),
  CHECK (days_before >= 0)
);
COMMENT ON TABLE reminder_rules IS 'Workspace notification lead-time rules. Replaces Monica reminder_rules.';
COMMENT ON COLUMN reminder_rules.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN reminder_rules.workspace_id IS 'Workspace that owns this rule.';
COMMENT ON COLUMN reminder_rules.days_before IS 'Number of days before an occurrence to notify.';
COMMENT ON COLUMN reminder_rules.is_active IS 'Whether this rule is active.';
COMMENT ON COLUMN reminder_rules.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN reminder_rules.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX reminder_rules_active_idx ON reminder_rules (workspace_id, is_active);

CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id uuid,
  person_date_id uuid,
  life_event_id uuid,
  task_id uuid,
  target_kind text NOT NULL DEFAULT 'custom',
  title text,
  description text,
  anchor_on date NOT NULL,
  recurrence_unit text NOT NULL DEFAULT 'none',
  recurrence_interval integer NOT NULL DEFAULT 1,
  send_time time,
  is_active boolean NOT NULL DEFAULT true,
  can_delete boolean NOT NULL DEFAULT true,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (recurrence_interval > 0),
  CHECK (target_kind IN ('custom', 'person', 'person_date', 'life_event', 'task')),
  CHECK (recurrence_unit IN ('none', 'day', 'week', 'month', 'year')),
  CHECK (((person_date_id IS NOT NULL)::int + (life_event_id IS NOT NULL)::int + (task_id IS NOT NULL)::int) <= 1),
  CHECK ( (target_kind = 'custom' AND person_date_id IS NULL AND life_event_id IS NULL AND task_id IS NULL) OR (target_kind = 'person' AND person_id IS NOT NULL AND person_date_id IS NULL AND life_event_id IS NULL AND task_id IS NULL) OR (target_kind = 'person_date' AND person_date_id IS NOT NULL AND life_event_id IS NULL AND task_id IS NULL) OR (target_kind = 'life_event' AND life_event_id IS NOT NULL AND person_date_id IS NULL AND task_id IS NULL) OR (target_kind = 'task' AND task_id IS NOT NULL AND person_date_id IS NULL AND life_event_id IS NULL) ),
  CONSTRAINT reminders_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id),
  CONSTRAINT reminders_life_event_id_fkey FOREIGN KEY (workspace_id, life_event_id) REFERENCES life_events (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT reminders_person_date_id_fkey FOREIGN KEY (workspace_id, person_date_id) REFERENCES person_dates (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT reminders_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT reminders_task_id_fkey FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT reminders_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE reminders IS 'Reminder definitions. Replaces Monica reminders plus birthday/deceased/first-met reminder pointer columns.';
COMMENT ON COLUMN reminders.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN reminders.workspace_id IS 'Workspace that owns this reminder.';
COMMENT ON COLUMN reminders.person_id IS 'Related person, if any.';
COMMENT ON COLUMN reminders.person_date_id IS 'Related important date, if this reminder is date-based.';
COMMENT ON COLUMN reminders.life_event_id IS 'Related life event, if any.';
COMMENT ON COLUMN reminders.task_id IS 'Related task, if any.';
COMMENT ON COLUMN reminders.target_kind IS 'Reminder target kind: custom, person, person_date, life_event, or task.';
COMMENT ON COLUMN reminders.title IS 'Reminder title.';
COMMENT ON COLUMN reminders.description IS 'Reminder description.';
COMMENT ON COLUMN reminders.anchor_on IS 'Initial/anchor occurrence date.';
COMMENT ON COLUMN reminders.recurrence_unit IS 'none, day, week, month, or year.';
COMMENT ON COLUMN reminders.recurrence_interval IS 'Interval count for recurrence_unit.';
COMMENT ON COLUMN reminders.send_time IS 'Local send time override; null uses workspace default.';
COMMENT ON COLUMN reminders.is_active IS 'Whether this reminder is active.';
COMMENT ON COLUMN reminders.can_delete IS 'Whether members can delete it; false for generated core date reminders if desired.';
COMMENT ON COLUMN reminders.created_by_member_id IS 'Member who created the reminder.';
COMMENT ON COLUMN reminders.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN reminders.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
COMMENT ON COLUMN reminders.deleted_at IS 'Soft-delete timestamp.';
CREATE INDEX reminders_workspace_active_idx ON reminders (workspace_id, is_active);
CREATE INDEX reminders_person_idx ON reminders (person_id);
CREATE INDEX reminders_anchor_idx ON reminders (workspace_id, anchor_on);
CREATE INDEX reminders_person_date_idx ON reminders (person_date_id) WHERE person_date_id IS NOT NULL;
CREATE INDEX reminders_life_event_idx ON reminders (life_event_id) WHERE life_event_id IS NOT NULL;
CREATE INDEX reminders_task_idx ON reminders (task_id) WHERE task_id IS NOT NULL;

CREATE TABLE reminder_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id uuid NOT NULL,
  member_id uuid NOT NULL,
  occurs_on date NOT NULL,
  deliver_at timestamptz NOT NULL,
  lead_time_days integer,
  channel text NOT NULL DEFAULT 'in_app',
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  title_snapshot text,
  body_snapshot text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  claim_owner text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  provider_idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text,
  provider_receipt text,
  provider_result_state text NOT NULL DEFAULT 'unattempted',
  provider_effect_at timestamptz,
  visible_at timestamptz,
  CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  CONSTRAINT reminder_occurrences_status_check CHECK (status IN ('pending', 'claimed', 'retry', 'sent', 'skipped', 'failed', 'cancelled', 'manual_attention')),
  CONSTRAINT reminder_occurrences_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT reminder_occurrences_provider_result_state_check CHECK (provider_result_state IN ('unattempted', 'ambiguous', 'confirmed', 'rejected')),
  CONSTRAINT reminder_occurrences_claim_shape_check CHECK ((claim_token IS NULL AND claim_owner IS NULL AND lease_expires_at IS NULL) OR (claim_token IS NOT NULL AND claim_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CONSTRAINT reminder_occurrences_claim_status_check CHECK (status = 'claimed' OR (claim_token IS NULL AND claim_owner IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT reminder_occurrences_claim_required_check CHECK (status <> 'claimed' OR (claim_token IS NOT NULL AND claim_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CONSTRAINT reminder_occurrences_retry_time_check CHECK (status <> 'retry' OR next_attempt_at IS NOT NULL),
  CONSTRAINT reminder_occurrences_confirmed_effect_check CHECK (provider_result_state <> 'confirmed' OR (provider_receipt IS NOT NULL AND provider_effect_at IS NOT NULL AND visible_at IS NOT NULL)),
  CONSTRAINT reminder_occurrences_sent_result_check CHECK (status <> 'sent' OR (sent_at IS NOT NULL AND provider_result_state = 'confirmed')),
  CONSTRAINT reminder_occurrences_manual_attention_check CHECK (status <> 'manual_attention' OR provider_result_state IN ('ambiguous', 'rejected')),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT reminder_occurrences_member_id_fkey FOREIGN KEY (workspace_id, member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT reminder_occurrences_reminder_id_fkey FOREIGN KEY (workspace_id, reminder_id) REFERENCES reminders (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN reminder_occurrences.workspace_id IS 'Workspace of the reminders row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE reminder_occurrences IS 'Generated notification/occurrence rows. Replaces Monica reminder_outbox and reminders_sent.';
COMMENT ON COLUMN reminder_occurrences.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN reminder_occurrences.reminder_id IS 'Reminder definition.';
COMMENT ON COLUMN reminder_occurrences.member_id IS 'Member who will receive this occurrence.';
COMMENT ON COLUMN reminder_occurrences.occurs_on IS 'Date of the underlying event/reminder occurrence.';
COMMENT ON COLUMN reminder_occurrences.deliver_at IS 'Exact notification delivery time.';
COMMENT ON COLUMN reminder_occurrences.lead_time_days IS 'Lead time used to generate this occurrence.';
COMMENT ON COLUMN reminder_occurrences.channel IS 'Delivery channel: in_app for the in-app reminder inbox or email for single reminder email and the daily digest.';
COMMENT ON COLUMN reminder_occurrences.status IS 'Durable lifecycle: pending, claimed, retry, sent, skipped, failed, cancelled, or manual_attention.';
COMMENT ON COLUMN reminder_occurrences.sent_at IS 'When notification was sent.';
COMMENT ON COLUMN reminder_occurrences.claim_token IS 'Opaque ownership token for the current finite worker lease.';
COMMENT ON COLUMN reminder_occurrences.claim_owner IS 'Non-secret worker instance name that owns the current lease.';
COMMENT ON COLUMN reminder_occurrences.lease_expires_at IS 'When another worker may recover an abandoned claim.';
COMMENT ON COLUMN reminder_occurrences.attempt_count IS 'Persistent number of started delivery attempts.';
COMMENT ON COLUMN reminder_occurrences.last_attempt_at IS 'When the latest delivery attempt started.';
COMMENT ON COLUMN reminder_occurrences.next_attempt_at IS 'Earliest instant at which retry work may be claimed.';
COMMENT ON COLUMN reminder_occurrences.provider_idempotency_key IS 'Stable provider key retained across claims and process restarts.';
COMMENT ON COLUMN reminder_occurrences.provider_receipt IS 'Stable provider receipt after confirmed delivery or reconciliation.';
COMMENT ON COLUMN reminder_occurrences.provider_result_state IS 'Durable provider reconciliation state: unattempted, ambiguous, confirmed, or rejected.';
COMMENT ON COLUMN reminder_occurrences.provider_effect_at IS 'When the idempotent provider effect was durably recorded.';
COMMENT ON COLUMN reminder_occurrences.visible_at IS 'When the in-app notification became user-visible.';
COMMENT ON COLUMN reminder_occurrences.title_snapshot IS 'Title at time of scheduling/sending.';
COMMENT ON COLUMN reminder_occurrences.body_snapshot IS 'Body at time of scheduling/sending.';
COMMENT ON COLUMN reminder_occurrences.error IS 'Failure details.';
COMMENT ON COLUMN reminder_occurrences.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN reminder_occurrences.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX reminder_occurrences_due_idx ON reminder_occurrences (status, COALESCE(next_attempt_at, deliver_at)) WHERE status IN ('pending', 'retry');
CREATE INDEX reminder_occurrences_lease_idx ON reminder_occurrences (lease_expires_at) WHERE status = 'claimed';
CREATE INDEX reminder_occurrences_member_idx ON reminder_occurrences (member_id);
CREATE INDEX reminder_occurrences_member_feed_idx ON reminder_occurrences (member_id, date_trunc('milliseconds', visible_at AT TIME ZONE 'UTC') DESC, id DESC) WHERE channel = 'in_app' AND status = 'sent' AND visible_at IS NOT NULL;
CREATE INDEX reminder_occurrences_member_open_idx ON reminder_occurrences (member_id, (CASE WHEN status = 'retry' THEN next_attempt_at ELSE deliver_at END)) WHERE status IN ('pending', 'retry', 'failed', 'manual_attention');
CREATE UNIQUE INDEX reminder_occurrences_unique_delivery ON reminder_occurrences (reminder_id, member_id, occurs_on, channel, COALESCE(lead_time_days, -1));
CREATE UNIQUE INDEX reminder_occurrences_provider_key_idx ON reminder_occurrences (provider_idempotency_key);

CREATE TABLE stay_in_touch_cadences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  interval_count integer NOT NULL,
  interval_unit text NOT NULL DEFAULT 'day',
  next_due_at timestamptz,
  last_contacted_at timestamptz,
  last_triggered_at timestamptz,
  reminder_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_request_id uuid,
  last_request_fingerprint text,
  UNIQUE (person_id),
  CONSTRAINT stay_in_touch_cadences_request_shape_check CHECK ((last_request_id IS NULL) = (last_request_fingerprint IS NULL)),
  CONSTRAINT stay_in_touch_cadences_request_fingerprint_check CHECK (last_request_fingerprint IS NULL OR last_request_fingerprint ~ '^[0-9a-f]{64}$'),
  CHECK (interval_count > 0),
  CHECK (interval_unit IN ('day', 'week', 'month', 'year')),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT stay_in_touch_cadences_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT stay_in_touch_cadences_reminder_id_fkey FOREIGN KEY (workspace_id, reminder_id) REFERENCES reminders (workspace_id, id) ON DELETE SET NULL (reminder_id),
  CONSTRAINT stay_in_touch_cadences_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON COLUMN stay_in_touch_cadences.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE stay_in_touch_cadences IS 'Contact cadence settings. Replaces contacts.stay_in_touch_frequency and stay_in_touch_trigger_date.';
COMMENT ON COLUMN stay_in_touch_cadences.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN stay_in_touch_cadences.person_id IS 'Person to stay in touch with.';
COMMENT ON COLUMN stay_in_touch_cadences.interval_count IS 'Cadence interval count.';
COMMENT ON COLUMN stay_in_touch_cadences.interval_unit IS 'day, week, month, or year.';
COMMENT ON COLUMN stay_in_touch_cadences.next_due_at IS 'Next stay-in-touch trigger.';
COMMENT ON COLUMN stay_in_touch_cadences.last_contacted_at IS 'Last known contact time, including imported Monica last_talked_to when interaction history is incomplete.';
COMMENT ON COLUMN stay_in_touch_cadences.last_triggered_at IS 'Last generated trigger.';
COMMENT ON COLUMN stay_in_touch_cadences.reminder_id IS 'Generated/linked reminder definition.';
COMMENT ON COLUMN stay_in_touch_cadences.is_active IS 'Whether the cadence is active.';
COMMENT ON COLUMN stay_in_touch_cadences.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN stay_in_touch_cadences.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
COMMENT ON COLUMN stay_in_touch_cadences.last_request_id IS 'Last accepted idempotent cadence mutation request.';
COMMENT ON COLUMN stay_in_touch_cadences.last_request_fingerprint IS 'SHA-256 fingerprint of the last accepted cadence mutation payload.';
CREATE INDEX stay_in_touch_due_idx ON stay_in_touch_cadences (is_active, next_due_at) WHERE is_active AND next_due_at IS NOT NULL;

CREATE TABLE stay_in_touch_cadence_requests (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  cadence_id uuid NOT NULL,
  request_fingerprint text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, request_id),
  CONSTRAINT stay_in_touch_cadence_requests_cadence_id_fkey FOREIGN KEY (workspace_id, cadence_id) REFERENCES stay_in_touch_cadences (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE stay_in_touch_cadence_requests IS 'Durable workspace-scoped idempotency receipts for accepted stay-in-touch cadence mutations.';
COMMENT ON COLUMN stay_in_touch_cadence_requests.workspace_id IS 'Workspace scope for request identity and tenant isolation.';
COMMENT ON COLUMN stay_in_touch_cadence_requests.request_id IS 'Client mutation request identifier, unique only inside its workspace.';
COMMENT ON COLUMN stay_in_touch_cadence_requests.cadence_id IS 'Cadence state returned for an accepted request replay.';
COMMENT ON COLUMN stay_in_touch_cadence_requests.request_fingerprint IS 'SHA-256 fingerprint of the accepted cadence mutation payload.';
COMMENT ON COLUMN stay_in_touch_cadence_requests.accepted_at IS 'When the request was first accepted.';
CREATE INDEX stay_in_touch_cadence_requests_cadence_idx ON stay_in_touch_cadence_requests (cadence_id);

CREATE TABLE relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_person_id uuid NOT NULL,
  to_person_id uuid NOT NULL,
  relationship_type_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_person_id <> to_person_id),
  UNIQUE (from_person_id, to_person_id, relationship_type_id),
  CHECK (status IN ('active', 'ended')),
  CONSTRAINT relationships_from_person_id_fkey FOREIGN KEY (workspace_id, from_person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT relationships_relationship_type_id_fkey FOREIGN KEY (workspace_id, relationship_type_id) REFERENCES relationship_types (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT relationships_to_person_id_fkey FOREIGN KEY (workspace_id, to_person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE relationships IS 'Directional person-to-person relationship edges. Replaces Monica relationships.';
COMMENT ON COLUMN relationships.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN relationships.workspace_id IS 'Workspace that owns this edge.';
COMMENT ON COLUMN relationships.from_person_id IS 'Subject/source person.';
COMMENT ON COLUMN relationships.to_person_id IS 'Object/target person.';
COMMENT ON COLUMN relationships.relationship_type_id IS 'Directional relationship type.';
COMMENT ON COLUMN relationships.status IS 'Relationship state: active or ended.';
COMMENT ON COLUMN relationships.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN relationships.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX relationships_to_idx ON relationships (to_person_id);
CREATE INDEX relationships_workspace_idx ON relationships (workspace_id);

CREATE TABLE romantic_relationship_details (
  relationship_id uuid PRIMARY KEY REFERENCES relationships(id) ON DELETE CASCADE,
  notes text,
  met_at timestamptz,
  official_at timestamptz,
  ended_at timestamptz,
  breakup_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR official_at IS NULL OR ended_at >= official_at)
);
COMMENT ON TABLE romantic_relationship_details IS 'Optional relationship-specific metadata for romantic/love relationships. Replaces Monica metadata_love_relationships.';
COMMENT ON COLUMN romantic_relationship_details.relationship_id IS 'Relationship edge these details describe.';
COMMENT ON COLUMN romantic_relationship_details.notes IS 'Relationship notes.';
COMMENT ON COLUMN romantic_relationship_details.met_at IS 'When the couple met.';
COMMENT ON COLUMN romantic_relationship_details.official_at IS 'When the relationship became official.';
COMMENT ON COLUMN romantic_relationship_details.ended_at IS 'Breakup/end timestamp.';
COMMENT ON COLUMN romantic_relationship_details.breakup_reason IS 'Breakup reason.';
COMMENT ON COLUMN romantic_relationship_details.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN romantic_relationship_details.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';

CREATE TABLE gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  recipient_person_id uuid,
  name text NOT NULL,
  url text,
  comment text,
  status text NOT NULL DEFAULT 'idea',
  event_at timestamptz,
  amount numeric(19,4),
  currency_code char(3) REFERENCES currencies(code) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount IS NULL OR amount >= 0),
  CONSTRAINT gifts_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT gifts_recipient_person_id_fkey FOREIGN KEY (workspace_id, recipient_person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (recipient_person_id),
  CONSTRAINT gifts_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE gifts IS 'Gift ideas and gift history associated with a person, optionally intended for a specific related person. Replaces Monica gifts.';
COMMENT ON COLUMN gifts.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN gifts.workspace_id IS 'Workspace that owns this gift.';
COMMENT ON COLUMN gifts.person_id IS 'Primary person whose profile owns the gift record.';
COMMENT ON COLUMN gifts.recipient_person_id IS 'Optional person the gift is specifically intended for; null means no particular recipient.';
COMMENT ON COLUMN gifts.name IS 'Gift name.';
COMMENT ON COLUMN gifts.url IS 'External gift URL.';
COMMENT ON COLUMN gifts.comment IS 'Gift notes/comment.';
COMMENT ON COLUMN gifts.status IS 'idea, planned, given, received, archived, or custom status.';
COMMENT ON COLUMN gifts.event_at IS 'Date/time the gift was/will be given or received.';
COMMENT ON COLUMN gifts.amount IS 'Gift amount using decimal currency value.';
COMMENT ON COLUMN gifts.currency_code IS 'Gift currency.';
COMMENT ON COLUMN gifts.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN gifts.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX gifts_person_idx ON gifts (person_id);
CREATE INDEX gifts_recipient_idx ON gifts (recipient_person_id) WHERE recipient_person_id IS NOT NULL;
CREATE INDEX gifts_status_idx ON gifts (workspace_id, status);
CREATE INDEX gifts_event_idx ON gifts (workspace_id, event_at) WHERE event_at IS NOT NULL;

CREATE TABLE gift_file_links (
  gift_id uuid NOT NULL,
  file_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'photo',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gift_id, file_id),
  workspace_id uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid,
  CONSTRAINT gift_file_links_file_id_fkey FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT gift_file_links_gift_id_fkey FOREIGN KEY (workspace_id, gift_id) REFERENCES gifts (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON COLUMN gift_file_links.workspace_id IS 'Workspace of the gifts row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
COMMENT ON TABLE gift_file_links IS 'Links files to gifts, especially gift photos. Replaces Monica gift_photo.';
COMMENT ON COLUMN gift_file_links.gift_id IS 'Gift.';
COMMENT ON COLUMN gift_file_links.file_id IS 'Linked file.';
COMMENT ON COLUMN gift_file_links.role IS 'Role of file for the gift.';
COMMENT ON COLUMN gift_file_links.sort_order IS 'Display order.';
COMMENT ON COLUMN gift_file_links.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX gift_file_links_file_idx ON gift_file_links (file_id);

CREATE TABLE recurring_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  direction text NOT NULL,
  amount numeric(19,4) NOT NULL,
  currency_code char(3) NOT NULL REFERENCES currencies(code),
  reason text,
  interval_months integer NOT NULL DEFAULT 1,
  day_of_month smallint NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  is_active boolean NOT NULL DEFAULT true,
  next_occurrence_on date,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_debts_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT recurring_debts_person_fk FOREIGN KEY (workspace_id, person_id) REFERENCES people(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT recurring_debts_direction_ck CHECK (direction IN ('i_owe', 'they_owe')),
  CONSTRAINT recurring_debts_amount_ck CHECK (amount >= 0),
  CONSTRAINT recurring_debts_interval_ck CHECK (interval_months BETWEEN 1 AND 120),
  CONSTRAINT recurring_debts_day_ck CHECK (day_of_month BETWEEN 1 AND 31),
  CONSTRAINT recurring_debts_window_ck CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT recurring_debts_next_ck CHECK (next_occurrence_on IS NULL OR next_occurrence_on >= starts_on),
  CONSTRAINT recurring_debts_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id)
);
COMMENT ON TABLE recurring_debts IS 'Rules that charge a person the same debt every N months on a day of the month; each due period becomes its own open debt.';
COMMENT ON COLUMN recurring_debts.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN recurring_debts.workspace_id IS 'Workspace that owns this rule and its person.';
COMMENT ON COLUMN recurring_debts.person_id IS 'Person each generated debt is with; same workspace by composite foreign key.';
COMMENT ON COLUMN recurring_debts.direction IS 'Direction of every generated debt: i_owe or they_owe.';
COMMENT ON COLUMN recurring_debts.amount IS 'Amount of every generated debt using decimal currency value.';
COMMENT ON COLUMN recurring_debts.currency_code IS 'Currency of every generated debt.';
COMMENT ON COLUMN recurring_debts.reason IS 'Reason copied onto every generated debt.';
COMMENT ON COLUMN recurring_debts.interval_months IS 'Number of months between charges, 1 through 120.';
COMMENT ON COLUMN recurring_debts.day_of_month IS 'Day of the month a charge falls due, 1 through 31; a shorter month uses its last day.';
COMMENT ON COLUMN recurring_debts.starts_on IS 'First local date a charge may fall due; the first charge is the first matching day on or after it.';
COMMENT ON COLUMN recurring_debts.ends_on IS 'Last local date a charge may fall due; null repeats without end.';
COMMENT ON COLUMN recurring_debts.is_active IS 'False while the member has paused the rule; a paused rule generates nothing.';
COMMENT ON COLUMN recurring_debts.next_occurrence_on IS 'Next due date not yet generated; null once the rule has passed its end date.';
COMMENT ON COLUMN recurring_debts.created_by_member_id IS 'Member who created the rule, when still known.';
COMMENT ON COLUMN recurring_debts.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN recurring_debts.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX recurring_debts_person_idx ON recurring_debts (workspace_id, person_id);
CREATE INDEX recurring_debts_due_idx ON recurring_debts (next_occurrence_on) WHERE is_active AND next_occurrence_on IS NOT NULL;

CREATE TABLE debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  direction text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  amount numeric(19,4) NOT NULL,
  currency_code char(3) REFERENCES currencies(code) ON DELETE SET NULL,
  reason text,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  recurring_debt_id uuid,
  occurrence_on date,
  CHECK (direction IN ('i_owe', 'they_owe')),
  CHECK (status IN ('open', 'settled', 'cancelled')),
  CHECK (amount >= 0),
  CHECK (status <> 'settled' OR settled_at IS NOT NULL),
  CONSTRAINT debts_recurring_debt_fk FOREIGN KEY (workspace_id, recurring_debt_id) REFERENCES recurring_debts(workspace_id, id) ON DELETE SET NULL (recurring_debt_id),
  CONSTRAINT debts_recurrence_ck CHECK (recurring_debt_id IS NULL OR occurrence_on IS NOT NULL),
  CONSTRAINT debts_recurring_occurrence_key UNIQUE (recurring_debt_id, occurrence_on),
  CONSTRAINT debts_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT debts_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE debts IS 'Money owed by or to a person. Replaces Monica debts.';
COMMENT ON COLUMN debts.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN debts.workspace_id IS 'Workspace that owns this debt.';
COMMENT ON COLUMN debts.person_id IS 'Person involved in the debt.';
COMMENT ON COLUMN debts.direction IS 'Debt direction: i_owe when the user owes the person; they_owe when the person owes the user.';
COMMENT ON COLUMN debts.status IS 'Debt lifecycle state: open, settled, or cancelled.';
COMMENT ON COLUMN debts.amount IS 'Debt amount using decimal currency value.';
COMMENT ON COLUMN debts.currency_code IS 'Debt currency.';
COMMENT ON COLUMN debts.reason IS 'Reason for the debt.';
COMMENT ON COLUMN debts.settled_at IS 'When the debt was settled.';
COMMENT ON COLUMN debts.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN debts.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
COMMENT ON COLUMN debts.recurring_debt_id IS 'Recurring rule that generated this debt; null for a debt recorded by hand or once its rule is deleted.';
COMMENT ON COLUMN debts.occurrence_on IS 'Due date of the period a recurring rule generated this debt for; one debt per rule and date.';
CREATE INDEX debts_person_idx ON debts (person_id);


-- -----------------------------------------------------------------------------
CREATE TABLE debt_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL,
  settled_at timestamptz NOT NULL,
  reason text,
  photo_file_id uuid,
  photo_filename text,
  created_by_member_id uuid,
  CONSTRAINT debt_settlements_debt_fk FOREIGN KEY (workspace_id, debt_id) REFERENCES debts(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT debt_settlements_photo_fk FOREIGN KEY (workspace_id, photo_file_id) REFERENCES files(workspace_id, id) ON DELETE SET NULL (photo_file_id),
  CONSTRAINT debt_settlements_actor_fk FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members(workspace_id, id) ON DELETE SET NULL (created_by_member_id),
  CONSTRAINT debt_settlements_reason_ck CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 10000),
  CONSTRAINT debt_settlements_photo_filename_ck CHECK (photo_filename IS NULL OR length(photo_filename) BETWEEN 1 AND 500)
);
COMMENT ON TABLE debt_settlements IS 'Append-only debt settlement history. Reopening a debt retains earlier settlements; explicit debt/person/workspace deletion cascades history.';
COMMENT ON COLUMN debt_settlements.id IS 'Stable settlement event identity; initial imported and backfilled settlements use their debt identifier.';
COMMENT ON COLUMN debt_settlements.workspace_id IS 'Workspace that owns the debt and this settlement.';
COMMENT ON COLUMN debt_settlements.debt_id IS 'Debt settled by this event; retained across reopening and person merges.';
COMMENT ON COLUMN debt_settlements.settled_at IS 'Original settlement timestamp in UTC, retained after the debt is reopened.';
COMMENT ON COLUMN debt_settlements.reason IS 'Optional explanation of how or why the debt was settled, separate from the original debt reason.';
COMMENT ON COLUMN debt_settlements.photo_file_id IS 'Optional image validated through files for the same person and workspace; cleared on hard file deletion.';
COMMENT ON COLUMN debt_settlements.photo_filename IS 'Original photo filename retained when the image later becomes unavailable or is removed.';
COMMENT ON COLUMN debt_settlements.created_by_member_id IS 'Member who settled the debt; null for historical imports/backfills or after member deletion.';
CREATE INDEX debt_settlements_debt_idx ON debt_settlements (workspace_id, debt_id, settled_at DESC, id);

-- Optional DAV and weather adapters
-- -----------------------------------------------------------------------------

CREATE TABLE dav_address_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_member_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  uri text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_member_id, uri),
  CONSTRAINT dav_address_books_owner_member_id_fkey FOREIGN KEY (workspace_id, owner_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT dav_address_books_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE dav_address_books IS 'Local CardDAV address books. Replaces Monica addressbooks.';
COMMENT ON COLUMN dav_address_books.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN dav_address_books.workspace_id IS 'Workspace that owns this address book.';
COMMENT ON COLUMN dav_address_books.owner_member_id IS 'Member that owns the address book.';
COMMENT ON COLUMN dav_address_books.name IS 'Address book name.';
COMMENT ON COLUMN dav_address_books.description IS 'Address book description.';
COMMENT ON COLUMN dav_address_books.uri IS 'DAV URI/slug for the local address book.';
COMMENT ON COLUMN dav_address_books.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN dav_address_books.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX dav_address_books_workspace_idx ON dav_address_books (workspace_id);

CREATE TABLE dav_address_book_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_member_id uuid NOT NULL,
  local_address_book_id uuid,
  name text NOT NULL,
  remote_url text NOT NULL,
  username text,
  encrypted_password text,
  is_readonly boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  remote_sync_token text,
  local_sync_token text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dav_address_book_subscriptions_local_address_book_id_fkey FOREIGN KEY (workspace_id, local_address_book_id) REFERENCES dav_address_books (workspace_id, id) ON DELETE SET NULL (local_address_book_id),
  CONSTRAINT dav_address_book_subscriptions_owner_member_id_fkey FOREIGN KEY (workspace_id, owner_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT dav_address_book_subscriptions_workspace_id_id_key UNIQUE (workspace_id, id)
);
COMMENT ON TABLE dav_address_book_subscriptions IS 'Remote CardDAV subscriptions and encrypted sync credentials. Replaces Monica addressbook_subscriptions.';
COMMENT ON COLUMN dav_address_book_subscriptions.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN dav_address_book_subscriptions.workspace_id IS 'Workspace that owns this subscription.';
COMMENT ON COLUMN dav_address_book_subscriptions.owner_member_id IS 'Member who owns the subscription.';
COMMENT ON COLUMN dav_address_book_subscriptions.local_address_book_id IS 'Local address book used for synchronized contacts.';
COMMENT ON COLUMN dav_address_book_subscriptions.name IS 'Subscription name.';
COMMENT ON COLUMN dav_address_book_subscriptions.remote_url IS 'Remote CardDAV URL/URI.';
COMMENT ON COLUMN dav_address_book_subscriptions.username IS 'Remote DAV username.';
COMMENT ON COLUMN dav_address_book_subscriptions.encrypted_password IS 'Encrypted remote DAV password/token.';
COMMENT ON COLUMN dav_address_book_subscriptions.is_readonly IS 'Whether the remote book is read-only.';
COMMENT ON COLUMN dav_address_book_subscriptions.is_active IS 'Whether synchronization is active.';
COMMENT ON COLUMN dav_address_book_subscriptions.capabilities IS 'Remote server capabilities.';
COMMENT ON COLUMN dav_address_book_subscriptions.remote_sync_token IS 'Remote sync token.';
COMMENT ON COLUMN dav_address_book_subscriptions.local_sync_token IS 'Local sync marker.';
COMMENT ON COLUMN dav_address_book_subscriptions.last_synced_at IS 'Last synchronization timestamp.';
COMMENT ON COLUMN dav_address_book_subscriptions.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN dav_address_book_subscriptions.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX dav_subscriptions_workspace_idx ON dav_address_book_subscriptions (workspace_id);
CREATE INDEX dav_subscriptions_active_idx ON dav_address_book_subscriptions (workspace_id, is_active);

CREATE TABLE dav_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  address_book_id uuid,
  subscription_id uuid,
  object_kind text NOT NULL,
  person_id uuid,
  task_id uuid,
  remote_uid text,
  href text,
  etag text,
  vcard text,
  icalendar text,
  sync_status text NOT NULL DEFAULT 'synced',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (((person_id IS NOT NULL)::int + (task_id IS NOT NULL)::int) <= 1),
  CHECK (object_kind IN ('person', 'task')),
  CHECK (sync_status IN ('synced', 'dirty', 'conflict', 'deleted', 'error')),
  CHECK ( (object_kind = 'person' AND person_id IS NOT NULL AND task_id IS NULL) OR (object_kind = 'task' AND task_id IS NOT NULL AND person_id IS NULL) ),
  CONSTRAINT dav_objects_address_book_id_fkey FOREIGN KEY (workspace_id, address_book_id) REFERENCES dav_address_books (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT dav_objects_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT dav_objects_subscription_id_fkey FOREIGN KEY (workspace_id, subscription_id) REFERENCES dav_address_book_subscriptions (workspace_id, id) ON DELETE SET NULL (subscription_id),
  CONSTRAINT dav_objects_task_id_fkey FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE dav_objects IS 'Per-object DAV state kept outside domain rows. Replaces contacts.vcard/distant_etag/address_book_id and CalDAV task state.';
COMMENT ON COLUMN dav_objects.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN dav_objects.workspace_id IS 'Workspace that owns this DAV object.';
COMMENT ON COLUMN dav_objects.address_book_id IS 'Local address book.';
COMMENT ON COLUMN dav_objects.subscription_id IS 'Remote subscription source, if any.';
COMMENT ON COLUMN dav_objects.object_kind IS 'DAV object kind: person or task.';
COMMENT ON COLUMN dav_objects.person_id IS 'Person represented by this DAV object.';
COMMENT ON COLUMN dav_objects.task_id IS 'Task represented by this DAV object.';
COMMENT ON COLUMN dav_objects.remote_uid IS 'Remote UID/UID property.';
COMMENT ON COLUMN dav_objects.href IS 'Remote/local DAV href.';
COMMENT ON COLUMN dav_objects.etag IS 'Remote ETag.';
COMMENT ON COLUMN dav_objects.vcard IS 'Cached vCard payload for contacts.';
COMMENT ON COLUMN dav_objects.icalendar IS 'Cached iCalendar/VTODO payload for tasks/calendars.';
COMMENT ON COLUMN dav_objects.sync_status IS 'Synchronization state: synced, dirty, conflict, deleted, or error.';
COMMENT ON COLUMN dav_objects.last_synced_at IS 'Last sync timestamp.';
COMMENT ON COLUMN dav_objects.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN dav_objects.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
COMMENT ON COLUMN dav_objects.deleted_at IS 'Soft-delete/tombstone timestamp for sync.';
CREATE INDEX dav_objects_person_idx ON dav_objects (person_id);
CREATE INDEX dav_objects_task_idx ON dav_objects (task_id);
CREATE INDEX dav_objects_href_idx ON dav_objects (workspace_id, href) WHERE href IS NOT NULL;

CREATE TABLE dav_sync_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  collection_name text NOT NULL DEFAULT 'contacts',
  sync_token text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dav_sync_tokens_member_id_fkey FOREIGN KEY (workspace_id, member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE dav_sync_tokens IS 'DAV sync token ledger. Replaces Monica synctoken.';
COMMENT ON COLUMN dav_sync_tokens.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN dav_sync_tokens.workspace_id IS 'Workspace that owns this sync token.';
COMMENT ON COLUMN dav_sync_tokens.member_id IS 'Member/principal.';
COMMENT ON COLUMN dav_sync_tokens.collection_name IS 'DAV collection name such as contacts, tasks, birthdays.';
COMMENT ON COLUMN dav_sync_tokens.sync_token IS 'Issued sync token.';
COMMENT ON COLUMN dav_sync_tokens.issued_at IS 'When the token was issued.';
COMMENT ON COLUMN dav_sync_tokens.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN dav_sync_tokens.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX dav_sync_tokens_member_idx ON dav_sync_tokens (member_id, collection_name);
CREATE UNIQUE INDEX dav_sync_tokens_value_unique ON dav_sync_tokens (member_id, collection_name, sync_token);

CREATE TABLE location_weather_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE location_weather_cache IS 'Optional cached weather payloads for locations. Replaces Monica weather but is safe to clear/re-fetch.';
COMMENT ON COLUMN location_weather_cache.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN location_weather_cache.location_id IS 'Location weather was fetched for.';
COMMENT ON COLUMN location_weather_cache.provider IS 'Weather provider name.';
COMMENT ON COLUMN location_weather_cache.payload IS 'Provider response payload.';
COMMENT ON COLUMN location_weather_cache.fetched_at IS 'When weather was fetched.';
COMMENT ON COLUMN location_weather_cache.expires_at IS 'When cache should be considered stale.';
COMMENT ON COLUMN location_weather_cache.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN location_weather_cache.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX location_weather_cache_location_idx ON location_weather_cache (location_id, provider);
CREATE INDEX location_weather_cache_expiry_idx ON location_weather_cache (expires_at);


-- -----------------------------------------------------------------------------
-- Import, export, and audit
-- -----------------------------------------------------------------------------

CREATE TABLE data_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by_member_id uuid,
  source_system text NOT NULL,
  source_profile text,
  status text NOT NULL DEFAULT 'pending',
  artifact_file_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'dry_run', 'running', 'completed', 'failed', 'cancelled')),
  CONSTRAINT data_imports_artifact_file_id_fkey FOREIGN KEY (workspace_id, artifact_file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL (artifact_file_id),
  CONSTRAINT data_imports_requested_by_member_id_fkey FOREIGN KEY (workspace_id, requested_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (requested_by_member_id)
);
COMMENT ON TABLE data_imports IS 'Import run metadata for Monica SQL/JSON/raw backups, vCard, CSV, and future sources. Replaces Monica import_jobs at the canonical layer.';
COMMENT ON COLUMN data_imports.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN data_imports.workspace_id IS 'Workspace being imported into.';
COMMENT ON COLUMN data_imports.requested_by_member_id IS 'Member who requested the import.';
COMMENT ON COLUMN data_imports.source_system IS 'monica, vcard, csv, manual, or other source system.';
COMMENT ON COLUMN data_imports.source_profile IS 'sql_export, json_export, raw_backup, storage_archive, etc.';
COMMENT ON COLUMN data_imports.status IS 'pending, dry_run, running, completed, failed, or cancelled.';
COMMENT ON COLUMN data_imports.artifact_file_id IS 'Uploaded import artifact.';
COMMENT ON COLUMN data_imports.started_at IS 'Import start timestamp.';
COMMENT ON COLUMN data_imports.completed_at IS 'Import completion timestamp.';
COMMENT ON COLUMN data_imports.stats IS 'Counts and summary statistics.';
COMMENT ON COLUMN data_imports.error IS 'Top-level error message.';
COMMENT ON COLUMN data_imports.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN data_imports.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX data_imports_workspace_idx ON data_imports (workspace_id, created_at DESC);
CREATE INDEX data_imports_status_idx ON data_imports (status);

CREATE TABLE data_import_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES data_imports(id) ON DELETE CASCADE,
  source_table text NOT NULL,
  source_primary_key text,
  source_uuid uuid,
  source_fingerprint text,
  target_table text,
  target_key text,
  status text NOT NULL DEFAULT 'mapped',
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('mapped', 'skipped', 'orphaned', 'warning', 'failed'))
);
COMMENT ON TABLE data_import_entities IS 'Source-to-target identity map for imports. This is where Monica table names/ids/UUIDs live, not in domain tables.';
COMMENT ON COLUMN data_import_entities.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN data_import_entities.import_id IS 'Import run.';
COMMENT ON COLUMN data_import_entities.source_table IS 'Original source table/entity name.';
COMMENT ON COLUMN data_import_entities.source_primary_key IS 'Original source primary key as text.';
COMMENT ON COLUMN data_import_entities.source_uuid IS 'Original source UUID if present.';
COMMENT ON COLUMN data_import_entities.source_fingerprint IS 'Hash/fingerprint for rows without stable ids.';
COMMENT ON COLUMN data_import_entities.target_table IS 'Canonical target table name.';
COMMENT ON COLUMN data_import_entities.target_key IS 'Canonical target key serialized as text; supports UUIDs, natural keys such as currency codes, and deterministic composite keys.';
COMMENT ON COLUMN data_import_entities.status IS 'mapped, skipped, orphaned, warning, failed.';
COMMENT ON COLUMN data_import_entities.warnings IS 'Warnings for this source row.';
COMMENT ON COLUMN data_import_entities.raw_snapshot IS 'Redacted source-row snapshot for diagnostics and lossless non-secret import review; password, token, session, and private-key values are never stored.';
COMMENT ON COLUMN data_import_entities.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX data_import_entities_target_idx ON data_import_entities (target_table, target_key) WHERE target_key IS NOT NULL;
CREATE UNIQUE INDEX data_import_entities_source_unique ON data_import_entities (import_id, source_table, source_primary_key) WHERE source_primary_key IS NOT NULL;
CREATE UNIQUE INDEX data_import_entities_uuid_unique ON data_import_entities (import_id, source_table, source_uuid) WHERE source_uuid IS NOT NULL;
CREATE UNIQUE INDEX data_import_entities_fingerprint_unique ON data_import_entities (import_id, source_table, source_fingerprint) WHERE source_fingerprint IS NOT NULL;

CREATE TABLE data_import_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES data_imports(id) ON DELETE CASCADE,
  entity_id uuid REFERENCES data_import_entities(id) ON DELETE CASCADE,
  severity text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (severity IN ('info', 'warning', 'error', 'skipped'))
);
COMMENT ON TABLE data_import_reports IS 'Per-row or per-person import report entries. Replaces Monica import_job_reports and powers dry-run review.';
COMMENT ON COLUMN data_import_reports.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN data_import_reports.import_id IS 'Import run.';
COMMENT ON COLUMN data_import_reports.entity_id IS 'Mapped entity this report is about.';
COMMENT ON COLUMN data_import_reports.severity IS 'info, warning, error, skipped.';
COMMENT ON COLUMN data_import_reports.message IS 'Report message.';
COMMENT ON COLUMN data_import_reports.details IS 'Structured report details.';
COMMENT ON COLUMN data_import_reports.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX data_import_reports_import_idx ON data_import_reports (import_id, severity);

CREATE TABLE data_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by_member_id uuid,
  format text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  file_id uuid,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'expired', 'cancelled')),
  CONSTRAINT data_exports_file_id_fkey FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL (file_id),
  CONSTRAINT data_exports_requested_by_member_id_fkey FOREIGN KEY (workspace_id, requested_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (requested_by_member_id)
);
COMMENT ON TABLE data_exports IS 'Export job metadata and manifest. Replaces Monica export_jobs with versioned manifests.';
COMMENT ON COLUMN data_exports.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN data_exports.workspace_id IS 'Workspace being exported.';
COMMENT ON COLUMN data_exports.requested_by_member_id IS 'Member who requested the export.';
COMMENT ON COLUMN data_exports.format IS 'json, sql, csv, vcard, or archive.';
COMMENT ON COLUMN data_exports.status IS 'Export state: pending, running, completed, failed, expired, or cancelled.';
COMMENT ON COLUMN data_exports.file_id IS 'Generated export file.';
COMMENT ON COLUMN data_exports.manifest IS 'Versioned export manifest with checksums and row counts.';
COMMENT ON COLUMN data_exports.started_at IS 'Export start timestamp.';
COMMENT ON COLUMN data_exports.completed_at IS 'Export completion timestamp.';
COMMENT ON COLUMN data_exports.expires_at IS 'When the export should be deleted.';
COMMENT ON COLUMN data_exports.error IS 'Top-level error message.';
COMMENT ON COLUMN data_exports.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN data_exports.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX data_exports_workspace_idx ON data_exports (workspace_id, created_at DESC);
CREATE INDEX data_exports_status_idx ON data_exports (status);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_member_id uuid,
  actor_name_snapshot text,
  person_id uuid,
  subject_type text,
  subject_id uuid,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  visible_on_dashboard boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_actor_member_id_fkey FOREIGN KEY (workspace_id, actor_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (actor_member_id),
  CONSTRAINT audit_events_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (person_id)
);
COMMENT ON TABLE audit_events IS 'Append-only account/contact audit history. Replaces Monica audit_logs with JSON payloads.';
COMMENT ON COLUMN audit_events.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN audit_events.workspace_id IS 'Workspace this event belongs to.';
COMMENT ON COLUMN audit_events.actor_member_id IS 'Member who caused the event.';
COMMENT ON COLUMN audit_events.actor_name_snapshot IS 'Actor display name at event time.';
COMMENT ON COLUMN audit_events.person_id IS 'Person this event is about, if any.';
COMMENT ON COLUMN audit_events.subject_type IS 'Subject table/entity type.';
COMMENT ON COLUMN audit_events.subject_id IS 'Subject id, when it is a UUID domain row.';
COMMENT ON COLUMN audit_events.action IS 'Action key.';
COMMENT ON COLUMN audit_events.payload IS 'Structured event payload.';
COMMENT ON COLUMN audit_events.occurred_at IS 'Domain event timestamp.';
COMMENT ON COLUMN audit_events.visible_on_dashboard IS 'Whether the event appears in dashboard/activity feeds.';
COMMENT ON COLUMN audit_events.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX audit_events_workspace_time_idx ON audit_events (workspace_id, occurred_at DESC);
CREATE INDEX audit_events_person_idx ON audit_events (person_id, occurred_at DESC);
CREATE INDEX audit_events_action_idx ON audit_events (workspace_id, action);

CREATE TABLE api_request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  member_id uuid REFERENCES workspace_members(id) ON DELETE SET NULL,
  method text NOT NULL,
  path text NOT NULL,
  client_ip inet,
  user_agent text,
  status_code integer,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  authentication_subject_digest text,
  CONSTRAINT api_request_logs_auth_subject_digest_ck CHECK (
    authentication_subject_digest IS NULL OR
    authentication_subject_digest ~ '^hmac-sha256:v[1-9][0-9]*:[0-9a-f]{64}$'
  )
);
COMMENT ON TABLE api_request_logs IS 'API usage logging and throttling analytics. Replaces Monica api_usage with richer request context.';
COMMENT ON COLUMN api_request_logs.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN api_request_logs.workspace_id IS 'Workspace associated with the request, if authenticated.';
COMMENT ON COLUMN api_request_logs.user_id IS 'Authenticated user, if any.';
COMMENT ON COLUMN api_request_logs.member_id IS 'Workspace member, if any.';
COMMENT ON COLUMN api_request_logs.method IS 'HTTP method.';
COMMENT ON COLUMN api_request_logs.path IS 'Request path or route.';
COMMENT ON COLUMN api_request_logs.client_ip IS 'Client IP address.';
COMMENT ON COLUMN api_request_logs.user_agent IS 'User agent.';
COMMENT ON COLUMN api_request_logs.authentication_subject_digest IS 'Versioned keyed digest of a normalized authentication subject for privacy-preserving throttling; never a raw email or challenge token.';
COMMENT ON COLUMN api_request_logs.status_code IS 'HTTP response status.';
COMMENT ON COLUMN api_request_logs.occurred_at IS 'Request timestamp.';
COMMENT ON COLUMN api_request_logs.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX api_request_logs_time_idx ON api_request_logs (occurred_at DESC);
CREATE INDEX api_request_logs_workspace_idx ON api_request_logs (workspace_id, occurred_at DESC);
CREATE INDEX api_request_logs_member_idx ON api_request_logs (member_id) WHERE member_id IS NOT NULL;
CREATE INDEX api_request_logs_post_subject_idx ON api_request_logs (path, authentication_subject_digest, occurred_at DESC) WHERE method = 'POST';

CREATE TABLE workspace_lifecycle_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  impact_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  cleanup_status text NOT NULL DEFAULT 'pending',
  occurred_at timestamptz NOT NULL,
  cleanup_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(impact_counts) = 'object'),
  CHECK (jsonb_typeof(object_keys) = 'array'),
  CHECK (cleanup_status IN ('pending', 'complete')),
  CHECK ((cleanup_status = 'complete') = (cleanup_completed_at IS NOT NULL)),
  CHECK (action IN ('reset', 'delete')),
  CHECK (outcome IN ('succeeded', 'forbidden', 'rate-limited', 'reauthentication-required', 'confirmation-invalid', 'stale-impact', 'transactional-failure'))
);
COMMENT ON TABLE workspace_lifecycle_records IS 'Minimal destructive-workspace security result and bounded object cleanup state retained outside workspace data.';
COMMENT ON COLUMN workspace_lifecycle_records.id IS 'Stable lifecycle record and cleanup receipt identifier.';
COMMENT ON COLUMN workspace_lifecycle_records.workspace_id IS 'Affected workspace identifier snapshot; deliberately not a foreign key.';
COMMENT ON COLUMN workspace_lifecycle_records.actor_user_id IS 'Acting owner identity snapshot; deliberately not a foreign key.';
COMMENT ON COLUMN workspace_lifecycle_records.action IS 'reset or delete destructive workspace action.';
COMMENT ON COLUMN workspace_lifecycle_records.outcome IS 'Redacted result of a destructive workspace attempt.';
COMMENT ON COLUMN workspace_lifecycle_records.impact_counts IS 'Non-identifying counts confirmed by the owner before the action.';
COMMENT ON COLUMN workspace_lifecycle_records.object_keys IS 'Internal object keys required only until cleanup completes.';
COMMENT ON COLUMN workspace_lifecycle_records.cleanup_status IS 'pending or complete object cleanup state.';
COMMENT ON COLUMN workspace_lifecycle_records.occurred_at IS 'Atomic destructive database action timestamp.';
COMMENT ON COLUMN workspace_lifecycle_records.cleanup_completed_at IS 'Timestamp when every captured object was removed.';
COMMENT ON COLUMN workspace_lifecycle_records.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX workspace_lifecycle_records_pending_idx
  ON workspace_lifecycle_records (created_at, id)
  WHERE cleanup_status = 'pending';


-- -----------------------------------------------------------------------------
-- Optional compliance and billing
-- -----------------------------------------------------------------------------

CREATE TABLE legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL,
  version text NOT NULL,
  content text NOT NULL,
  published_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type, version)
);
COMMENT ON TABLE legal_documents IS 'Versioned legal/compliance documents. Replaces Monica terms.';
COMMENT ON COLUMN legal_documents.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN legal_documents.document_type IS 'terms, privacy, dpa, or other policy type.';
COMMENT ON COLUMN legal_documents.version IS 'Policy version string.';
COMMENT ON COLUMN legal_documents.content IS 'Policy content, markdown/html/plain text depending on renderer.';
COMMENT ON COLUMN legal_documents.published_at IS 'When this version became active.';
COMMENT ON COLUMN legal_documents.is_active IS 'Whether this document can be accepted by users.';
COMMENT ON COLUMN legal_documents.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN legal_documents.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX legal_documents_active_idx ON legal_documents (document_type, is_active);
CREATE UNIQUE INDEX legal_documents_one_active_per_type ON legal_documents (document_type) WHERE is_active;

CREATE TABLE legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_document_id uuid NOT NULL REFERENCES legal_documents(id) ON DELETE RESTRICT,
  ip_address inet,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE legal_acceptances IS 'Immutable record that a user accepted a legal-document version, optionally in a workspace context.';
COMMENT ON COLUMN legal_acceptances.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN legal_acceptances.workspace_id IS 'Workspace context for acceptance, if applicable.';
COMMENT ON COLUMN legal_acceptances.user_id IS 'User who accepted the document.';
COMMENT ON COLUMN legal_acceptances.legal_document_id IS 'Accepted legal document.';
COMMENT ON COLUMN legal_acceptances.ip_address IS 'IP address captured at acceptance.';
COMMENT ON COLUMN legal_acceptances.accepted_at IS 'Acceptance timestamp.';
COMMENT ON COLUMN legal_acceptances.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX legal_acceptances_user_idx ON legal_acceptances (user_id);

CREATE TABLE billing_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe',
  provider_customer_id text NOT NULL,
  trial_ends_at timestamptz,
  complimentary_until timestamptz,
  payment_method_type text,
  payment_method_last_four text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_customer_id),
  UNIQUE (workspace_id, provider)
);
COMMENT ON TABLE billing_customers IS 'Payment-provider customer state kept separate from workspaces. Replaces Stripe fields on Monica accounts.';
COMMENT ON COLUMN billing_customers.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN billing_customers.workspace_id IS 'Workspace billed through this provider customer.';
COMMENT ON COLUMN billing_customers.provider IS 'Billing provider.';
COMMENT ON COLUMN billing_customers.provider_customer_id IS 'Provider customer id.';
COMMENT ON COLUMN billing_customers.trial_ends_at IS 'Trial expiration timestamp.';
COMMENT ON COLUMN billing_customers.complimentary_until IS 'Free/complimentary access expiration, if any.';
COMMENT ON COLUMN billing_customers.payment_method_type IS 'Card/payment method brand/type.';
COMMENT ON COLUMN billing_customers.payment_method_last_four IS 'Last four digits of current payment method.';
COMMENT ON COLUMN billing_customers.metadata IS 'Provider-specific billing metadata.';
COMMENT ON COLUMN billing_customers.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN billing_customers.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';

CREATE TABLE billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_customer_id uuid NOT NULL REFERENCES billing_customers(id) ON DELETE CASCADE,
  provider_subscription_id text NOT NULL,
  name text NOT NULL DEFAULT 'default',
  status text NOT NULL,
  quantity integer,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (billing_customer_id, provider_subscription_id),
  CHECK (quantity IS NULL OR quantity >= 0)
);
COMMENT ON TABLE billing_subscriptions IS 'Subscription records from the billing provider. Replaces Monica subscriptions.';
COMMENT ON COLUMN billing_subscriptions.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN billing_subscriptions.billing_customer_id IS 'Provider customer that owns this subscription and determines its workspace and billing provider.';
COMMENT ON COLUMN billing_subscriptions.provider_subscription_id IS 'Subscription id within the provider/customer context.';
COMMENT ON COLUMN billing_subscriptions.name IS 'Subscription name.';
COMMENT ON COLUMN billing_subscriptions.status IS 'Provider subscription status.';
COMMENT ON COLUMN billing_subscriptions.quantity IS 'Subscription quantity.';
COMMENT ON COLUMN billing_subscriptions.trial_ends_at IS 'Trial end timestamp.';
COMMENT ON COLUMN billing_subscriptions.current_period_ends_at IS 'Current billing period end.';
COMMENT ON COLUMN billing_subscriptions.ends_at IS 'Cancellation/end timestamp.';
COMMENT ON COLUMN billing_subscriptions.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN billing_subscriptions.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX billing_subscriptions_customer_status_idx ON billing_subscriptions (billing_customer_id, status);

CREATE TABLE billing_subscription_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES billing_subscriptions(id) ON DELETE CASCADE,
  provider_item_id text NOT NULL,
  provider_price_id text NOT NULL,
  provider_product_id text,
  quantity integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, provider_item_id),
  CHECK (quantity IS NULL OR quantity >= 0)
);
COMMENT ON TABLE billing_subscription_items IS 'Subscription item rows from the billing provider. Replaces Monica subscription_items.';
COMMENT ON COLUMN billing_subscription_items.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN billing_subscription_items.subscription_id IS 'Parent subscription.';
COMMENT ON COLUMN billing_subscription_items.provider_item_id IS 'Provider subscription item id.';
COMMENT ON COLUMN billing_subscription_items.provider_price_id IS 'Provider price id.';
COMMENT ON COLUMN billing_subscription_items.provider_product_id IS 'Provider product id.';
COMMENT ON COLUMN billing_subscription_items.quantity IS 'Item quantity.';
COMMENT ON COLUMN billing_subscription_items.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN billing_subscription_items.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';


-- -----------------------------------------------------------------------------
-- Identity runtime, API, and OAuth
-- -----------------------------------------------------------------------------

CREATE TABLE workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_by_member_id uuid,
  email citext NOT NULL,
  token_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role IN ('admin', 'member')),
  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  CHECK (status <> 'accepted' OR accepted_at IS NOT NULL),
  CONSTRAINT workspace_invitations_invited_by_member_id_fkey FOREIGN KEY (workspace_id, invited_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (invited_by_member_id)
);
COMMENT ON TABLE workspace_invitations IS 'Pending workspace invitations. Replaces Monica invitations.';
COMMENT ON COLUMN workspace_invitations.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN workspace_invitations.workspace_id IS 'Workspace invite is for.';
COMMENT ON COLUMN workspace_invitations.invited_by_member_id IS 'Member who sent the invite.';
COMMENT ON COLUMN workspace_invitations.email IS 'Invited email address.';
COMMENT ON COLUMN workspace_invitations.token_hash IS 'Hash of opaque acceptance token.';
COMMENT ON COLUMN workspace_invitations.role IS 'Role granted on acceptance.';
COMMENT ON COLUMN workspace_invitations.status IS 'pending, accepted, expired, revoked.';
COMMENT ON COLUMN workspace_invitations.expires_at IS 'Expiration timestamp.';
COMMENT ON COLUMN workspace_invitations.accepted_at IS 'Acceptance timestamp.';
COMMENT ON COLUMN workspace_invitations.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN workspace_invitations.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX workspace_invitations_email_idx ON workspace_invitations (workspace_id, email);
CREATE UNIQUE INDEX workspace_invitations_token_idx ON workspace_invitations (token_hash);

CREATE TABLE password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  email citext NOT NULL,
  token_hash text NOT NULL,
  requested_ip inet,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE password_reset_requests IS 'Password reset requests/tokens. Runtime security table; not imported as active data from Monica.';
COMMENT ON COLUMN password_reset_requests.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN password_reset_requests.user_id IS 'User requesting reset, if known.';
COMMENT ON COLUMN password_reset_requests.email IS 'Email used for reset request.';
COMMENT ON COLUMN password_reset_requests.token_hash IS 'Hash of reset token.';
COMMENT ON COLUMN password_reset_requests.requested_ip IS 'IP address that requested reset.';
COMMENT ON COLUMN password_reset_requests.expires_at IS 'Token expiration.';
COMMENT ON COLUMN password_reset_requests.used_at IS 'When token was used.';
COMMENT ON COLUMN password_reset_requests.created_at IS 'Creation timestamp in UTC.';
CREATE UNIQUE INDEX password_reset_token_idx ON password_reset_requests (token_hash);
CREATE INDEX password_reset_email_idx ON password_reset_requests (email);

CREATE TABLE email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email citext NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE email_verification_tokens IS 'Email verification tokens for users.';
COMMENT ON COLUMN email_verification_tokens.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN email_verification_tokens.user_id IS 'User verifying email.';
COMMENT ON COLUMN email_verification_tokens.email IS 'Email being verified.';
COMMENT ON COLUMN email_verification_tokens.token_hash IS 'Hash of verification token.';
COMMENT ON COLUMN email_verification_tokens.expires_at IS 'Token expiration.';
COMMENT ON COLUMN email_verification_tokens.used_at IS 'When token was used.';
COMMENT ON COLUMN email_verification_tokens.created_at IS 'Creation timestamp in UTC.';
CREATE UNIQUE INDEX email_verification_token_idx ON email_verification_tokens (token_hash);

CREATE TABLE user_mfa_totp (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_secret text NOT NULL,
  confirmed_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE user_mfa_totp IS 'TOTP MFA secrets. Replaces Monica users.google2fa_secret without mixing secrets into users.';
COMMENT ON COLUMN user_mfa_totp.user_id IS 'User with TOTP configured.';
COMMENT ON COLUMN user_mfa_totp.encrypted_secret IS 'Encrypted TOTP secret.';
COMMENT ON COLUMN user_mfa_totp.confirmed_at IS 'When TOTP was confirmed.';
COMMENT ON COLUMN user_mfa_totp.last_used_at IS 'Last successful TOTP use.';
COMMENT ON COLUMN user_mfa_totp.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN user_mfa_totp.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';

CREATE TABLE user_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE user_recovery_codes IS 'Hashed MFA recovery codes. Replaces Monica recovery_codes.';
COMMENT ON COLUMN user_recovery_codes.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN user_recovery_codes.user_id IS 'User who owns the recovery code.';
COMMENT ON COLUMN user_recovery_codes.code_hash IS 'Hash of recovery code.';
COMMENT ON COLUMN user_recovery_codes.used_at IS 'When code was consumed.';
COMMENT ON COLUMN user_recovery_codes.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX user_recovery_codes_user_idx ON user_recovery_codes (user_id);
CREATE UNIQUE INDEX user_recovery_codes_hash_idx ON user_recovery_codes (code_hash);

CREATE TABLE webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'key',
  credential_id text NOT NULL,
  credential_type text NOT NULL,
  transports text[] NOT NULL DEFAULT '{}'::text[],
  attestation_type text,
  trust_path jsonb,
  aaguid text,
  public_key text NOT NULL,
  sign_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (credential_id),
  CHECK (sign_count >= 0)
);
COMMENT ON TABLE webauthn_credentials IS 'FIDO2/WebAuthn credentials. Replaces Monica webauthn_keys; legacy U2F should be re-registered rather than activated blindly.';
COMMENT ON COLUMN webauthn_credentials.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN webauthn_credentials.user_id IS 'User who owns the credential.';
COMMENT ON COLUMN webauthn_credentials.name IS 'User-visible key name.';
COMMENT ON COLUMN webauthn_credentials.credential_id IS 'WebAuthn credential id.';
COMMENT ON COLUMN webauthn_credentials.credential_type IS 'Credential type.';
COMMENT ON COLUMN webauthn_credentials.transports IS 'Supported authenticator transports.';
COMMENT ON COLUMN webauthn_credentials.attestation_type IS 'Attestation type.';
COMMENT ON COLUMN webauthn_credentials.trust_path IS 'Trust path information.';
COMMENT ON COLUMN webauthn_credentials.aaguid IS 'Authenticator AAGUID.';
COMMENT ON COLUMN webauthn_credentials.public_key IS 'Credential public key.';
COMMENT ON COLUMN webauthn_credentials.sign_count IS 'Signature counter.';
COMMENT ON COLUMN webauthn_credentials.last_used_at IS 'Last successful authentication.';
COMMENT ON COLUMN webauthn_credentials.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN webauthn_credentials.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX webauthn_credentials_user_idx ON webauthn_credentials (user_id);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  purpose text NOT NULL,
  CONSTRAINT user_sessions_purpose_check CHECK (purpose IN ('authenticated', 'verified-entry', 'legacy', 'mfa-challenge')),
  CONSTRAINT user_sessions_legacy_revoked_check CHECK (purpose <> 'legacy' OR revoked_at IS NOT NULL)
);
COMMENT ON TABLE user_sessions IS 'Stateful web sessions if the deployment uses DB-backed sessions. Replaces Monica sessions without Laravel payload coupling.';
COMMENT ON COLUMN user_sessions.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN user_sessions.user_id IS 'Authenticated user.';
COMMENT ON COLUMN user_sessions.session_hash IS 'Hash of session token/id.';
COMMENT ON COLUMN user_sessions.purpose IS 'Exact authority purpose: authenticated session, verified identity entry, revoked legacy authority, or a pending MFA challenge.';
COMMENT ON COLUMN user_sessions.ip_address IS 'Client IP address.';
COMMENT ON COLUMN user_sessions.user_agent IS 'Client user agent.';
COMMENT ON COLUMN user_sessions.created_at IS 'Session creation timestamp.';
COMMENT ON COLUMN user_sessions.last_seen_at IS 'Last activity timestamp.';
COMMENT ON COLUMN user_sessions.expires_at IS 'Session expiration timestamp.';
COMMENT ON COLUMN user_sessions.revoked_at IS 'Revocation timestamp.';
CREATE UNIQUE INDEX user_sessions_hash_idx ON user_sessions (session_hash);
CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);

CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE api_tokens IS 'Personal access/API tokens. Replaces Monica account API keys and Passport personal tokens for first-party API access.';
COMMENT ON COLUMN api_tokens.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN api_tokens.user_id IS 'User who owns the token.';
COMMENT ON COLUMN api_tokens.workspace_id IS 'Optional workspace scope.';
COMMENT ON COLUMN api_tokens.name IS 'Token display name.';
COMMENT ON COLUMN api_tokens.token_hash IS 'Hash of token secret.';
COMMENT ON COLUMN api_tokens.scopes IS 'Granted API scopes.';
COMMENT ON COLUMN api_tokens.last_used_at IS 'Last use timestamp.';
COMMENT ON COLUMN api_tokens.expires_at IS 'Expiration timestamp.';
COMMENT ON COLUMN api_tokens.revoked_at IS 'Revocation timestamp.';
COMMENT ON COLUMN api_tokens.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN api_tokens.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE UNIQUE INDEX api_tokens_hash_idx ON api_tokens (token_hash);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);
CREATE INDEX api_tokens_workspace_idx ON api_tokens (workspace_id);

CREATE TABLE oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL,
  user_provider text,
  secret_hash text,
  redirect_uris text[] NOT NULL DEFAULT '{}'::text[],
  allowed_grants text[] NOT NULL DEFAULT '{}'::text[],
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  is_confidential boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE oauth_clients IS 'OAuth2 clients if the app exposes a built-in OAuth provider. Replaces Monica oauth_clients and personal_access_clients.';
COMMENT ON COLUMN oauth_clients.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN oauth_clients.owner_user_id IS 'User that owns the client, if personal/client-created.';
COMMENT ON COLUMN oauth_clients.name IS 'Client name.';
COMMENT ON COLUMN oauth_clients.user_provider IS 'Optional user-provider identifier used by grant flows.';
COMMENT ON COLUMN oauth_clients.secret_hash IS 'Hash of client secret.';
COMMENT ON COLUMN oauth_clients.redirect_uris IS 'Exact redirect URIs registered for this client.';
COMMENT ON COLUMN oauth_clients.allowed_grants IS 'OAuth grant types enabled for this client.';
COMMENT ON COLUMN oauth_clients.scopes IS 'Scopes this client may request.';
COMMENT ON COLUMN oauth_clients.is_confidential IS 'Whether client can keep a secret.';
COMMENT ON COLUMN oauth_clients.is_active IS 'Whether client is active.';
COMMENT ON COLUMN oauth_clients.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN oauth_clients.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX oauth_clients_owner_idx ON oauth_clients (owner_user_id);

CREATE TABLE oauth_authorization_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  redirect_uri text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE oauth_authorization_codes IS 'OAuth authorization codes. Replaces Monica oauth_auth_codes.';
COMMENT ON COLUMN oauth_authorization_codes.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN oauth_authorization_codes.client_id IS 'OAuth client.';
COMMENT ON COLUMN oauth_authorization_codes.user_id IS 'Authorizing user.';
COMMENT ON COLUMN oauth_authorization_codes.code_hash IS 'Hash of authorization code.';
COMMENT ON COLUMN oauth_authorization_codes.scopes IS 'Scopes approved for the authorization code.';
COMMENT ON COLUMN oauth_authorization_codes.redirect_uri IS 'Redirect URI used.';
COMMENT ON COLUMN oauth_authorization_codes.expires_at IS 'Expiration timestamp.';
COMMENT ON COLUMN oauth_authorization_codes.used_at IS 'When code was consumed.';
COMMENT ON COLUMN oauth_authorization_codes.created_at IS 'Creation timestamp in UTC.';
CREATE UNIQUE INDEX oauth_authorization_codes_hash_idx ON oauth_authorization_codes (code_hash);
CREATE INDEX oauth_authorization_codes_user_idx ON oauth_authorization_codes (user_id);

CREATE TABLE oauth_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE oauth_access_tokens IS 'OAuth access tokens. Replaces Monica oauth_access_tokens.';
COMMENT ON COLUMN oauth_access_tokens.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN oauth_access_tokens.client_id IS 'OAuth client.';
COMMENT ON COLUMN oauth_access_tokens.user_id IS 'User subject, if any.';
COMMENT ON COLUMN oauth_access_tokens.token_hash IS 'Hash of access token.';
COMMENT ON COLUMN oauth_access_tokens.scopes IS 'Scopes granted to the access token.';
COMMENT ON COLUMN oauth_access_tokens.expires_at IS 'Expiration timestamp.';
COMMENT ON COLUMN oauth_access_tokens.revoked_at IS 'Revocation timestamp.';
COMMENT ON COLUMN oauth_access_tokens.created_at IS 'Creation timestamp in UTC.';
CREATE UNIQUE INDEX oauth_access_tokens_hash_idx ON oauth_access_tokens (token_hash);
CREATE INDEX oauth_access_tokens_user_idx ON oauth_access_tokens (user_id);

CREATE TABLE oauth_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token_id uuid NOT NULL REFERENCES oauth_access_tokens(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE oauth_refresh_tokens IS 'OAuth refresh tokens. Replaces Monica oauth_refresh_tokens.';
COMMENT ON COLUMN oauth_refresh_tokens.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN oauth_refresh_tokens.access_token_id IS 'Access token this refresh token belongs to.';
COMMENT ON COLUMN oauth_refresh_tokens.token_hash IS 'Hash of refresh token.';
COMMENT ON COLUMN oauth_refresh_tokens.expires_at IS 'Expiration timestamp.';
COMMENT ON COLUMN oauth_refresh_tokens.revoked_at IS 'Revocation timestamp.';
COMMENT ON COLUMN oauth_refresh_tokens.created_at IS 'Creation timestamp in UTC.';
CREATE UNIQUE INDEX oauth_refresh_tokens_hash_idx ON oauth_refresh_tokens (token_hash);


-- -----------------------------------------------------------------------------
-- Optional operations metadata
-- -----------------------------------------------------------------------------

CREATE TABLE scheduled_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('running', 'succeeded', 'failed', 'skipped'))
);
COMMENT ON TABLE scheduled_job_runs IS 'Scheduler/job observability. Replaces Monica crons and job status needs without coupling to a queue implementation.';
COMMENT ON COLUMN scheduled_job_runs.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN scheduled_job_runs.job_key IS 'Stable scheduled job key/command.';
COMMENT ON COLUMN scheduled_job_runs.status IS 'running, succeeded, failed, skipped.';
COMMENT ON COLUMN scheduled_job_runs.started_at IS 'Run start timestamp.';
COMMENT ON COLUMN scheduled_job_runs.finished_at IS 'Run finish timestamp.';
COMMENT ON COLUMN scheduled_job_runs.error IS 'Error message if failed.';
COMMENT ON COLUMN scheduled_job_runs.metadata IS 'Job run metadata.';
COMMENT ON COLUMN scheduled_job_runs.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX scheduled_job_runs_key_idx ON scheduled_job_runs (job_key, started_at DESC);

CREATE TABLE app_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_instance_id uuid NOT NULL DEFAULT gen_random_uuid(),
  current_version text,
  latest_known_version text,
  latest_release_notes text,
  versions_behind integer,
  last_checked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (versions_behind IS NULL OR versions_behind >= 0)
);
COMMENT ON TABLE app_instances IS 'Self-hosted instance metadata and update-check state. Replaces Monica instances.';
COMMENT ON COLUMN app_instances.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN app_instances.public_instance_id IS 'Public anonymous instance id for optional telemetry/update checks.';
COMMENT ON COLUMN app_instances.current_version IS 'Currently running app version.';
COMMENT ON COLUMN app_instances.latest_known_version IS 'Latest version seen by update check.';
COMMENT ON COLUMN app_instances.latest_release_notes IS 'Release notes from last update check.';
COMMENT ON COLUMN app_instances.versions_behind IS 'Number of known releases between current and latest versions, when calculated.';
COMMENT ON COLUMN app_instances.last_checked_at IS 'Last update-check timestamp.';
COMMENT ON COLUMN app_instances.metadata IS 'Instance metadata.';
COMMENT ON COLUMN app_instances.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN app_instances.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE UNIQUE INDEX app_instances_public_idx ON app_instances (public_instance_id);

CREATE TABLE statistics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'workspace',
  captured_at timestamptz NOT NULL DEFAULT now(),
  counters jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scope IN ('instance', 'workspace')),
  CHECK ((scope = 'instance' AND workspace_id IS NULL) OR (scope = 'workspace' AND workspace_id IS NOT NULL))
);
COMMENT ON TABLE statistics_snapshots IS 'Optional aggregate statistics snapshots for public/admin dashboards. Replaces Monica statistics without 30 fixed counter columns.';
COMMENT ON COLUMN statistics_snapshots.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN statistics_snapshots.workspace_id IS 'Workspace this snapshot covers; null for instance-wide snapshot.';
COMMENT ON COLUMN statistics_snapshots.scope IS 'workspace or instance.';
COMMENT ON COLUMN statistics_snapshots.captured_at IS 'When counters were captured.';
COMMENT ON COLUMN statistics_snapshots.counters IS 'Named counters, such as contacts, activities, reminders, conversations.';
COMMENT ON COLUMN statistics_snapshots.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX statistics_snapshots_scope_idx ON statistics_snapshots (scope, captured_at DESC);
CREATE INDEX statistics_snapshots_workspace_idx ON statistics_snapshots (workspace_id, captured_at DESC);

-- Circular/forward references added after both sides exist.
ALTER TABLE workspace_members
  ADD CONSTRAINT workspace_members_self_person_fk
  FOREIGN KEY (workspace_id, self_person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (self_person_id);

ALTER TABLE person_first_meetings
  ADD CONSTRAINT person_first_meetings_location_fk
  FOREIGN KEY (workspace_id, location_id) REFERENCES locations (workspace_id, id) ON DELETE SET NULL (location_id);

-- -----------------------------------------------------------------------------
-- Workspace isolation (v14, ADR 0008)
-- -----------------------------------------------------------------------------
-- The database backstops the application's workspace predicates in three
-- layers: least-privilege roles, workspace-bound composite keys (above), and
-- forced row-level security on every tenant table (below). The deployment's
-- bootstrap step creates the roles this section names before the migrator runs
-- (docs/architecture/configuration-and-secrets.md); the schema never creates a
-- role or holds a password.
DO $roles$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(required.name, ', ' ORDER BY required.name) INTO missing
  FROM unnest(ARRAY[
    'kinship_app', 'kinship_worker', 'kinship_session_resolver',
    'kinship_token_resolver', 'kinship_invitation_resolver',
    'kinship_registration', 'kinship_account_lifecycle',
    'kinship_workspace_lifecycle', 'kinship_request_budget',
    'kinship_planning_maintenance'
  ]) AS required(name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = required.name);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Schema v14 requires the bootstrap roles: %', missing;
  END IF;
END
$roles$;

-- The schema is reachable to the service roles and to the owners of the
-- narrow cross-workspace functions; current_schema() keeps the statement
-- correct when the canonical DDL is applied into a scratch schema.
DO $usage$
BEGIN
  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO kinship_app, kinship_worker, kinship_session_resolver, kinship_token_resolver, kinship_invitation_resolver, kinship_registration, kinship_account_lifecycle, kinship_workspace_lifecycle, kinship_request_budget, kinship_planning_maintenance',
    current_schema()
  );
END
$usage$;

-- Every tenant table admits only the rows of the workspace the transaction
-- set with SET LOCAL app.workspace_id (or set_config(..., true)). An unset or
-- emptied setting matches no row, and nullif keeps the cast from failing on a
-- pooled connection whose previous transaction set it.
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON activities
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE activity_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON activity_participants
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE activity_type_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_type_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON activity_type_categories
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE activity_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_types FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON activity_types
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE api_request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_request_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON api_request_logs
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON api_tokens
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON audit_events
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_customers FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON billing_customers
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON calls
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE contact_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_labels FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON contact_labels
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE contact_method_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_method_types FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON contact_method_types
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE conversation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_threads FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON conversation_threads
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON data_exports
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE data_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON data_imports
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE dav_address_book_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dav_address_book_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON dav_address_book_subscriptions
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE dav_address_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE dav_address_books FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON dav_address_books
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE dav_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE dav_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON dav_objects
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE dav_sync_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE dav_sync_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON dav_sync_tokens
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE debt_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_settlements FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON debt_settlements
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON debts
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON files
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE gender_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE gender_options FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON gender_options
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE gift_file_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_file_links FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON gift_file_links
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gifts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON gifts
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE journal_day_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_day_ratings FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON journal_day_ratings
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE journal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_items FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON journal_items
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE journal_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_posts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON journal_posts
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_acceptances FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON legal_acceptances
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE life_event_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_event_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON life_event_categories
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE life_event_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_event_types FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON life_event_types
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE life_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON life_events
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON locations
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON messages
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON notes
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON organizations
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE people FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON people
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_address_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_address_labels FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_address_labels
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_addresses FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_addresses
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_avatars ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_avatars FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_avatars
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_contact_method_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_contact_method_labels FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_contact_method_labels
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_contact_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_contact_methods FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_contact_methods
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_dates FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_dates
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_duplicate_dismissals FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_duplicate_dismissals
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_file_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_file_links FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_file_links
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_first_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_first_meetings FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_first_meetings
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_occupations ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_occupations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_occupations
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_tags
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE recurring_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_debts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON recurring_debts
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE relationship_type_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_type_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON relationship_type_groups
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE relationship_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_types FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON relationship_types
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON relationships
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE reminder_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_occurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON reminder_occurrences
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE reminder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON reminder_rules
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON reminders
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE statistics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE statistics_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON statistics_snapshots
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE stay_in_touch_cadence_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE stay_in_touch_cadence_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON stay_in_touch_cadence_requests
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE stay_in_touch_cadences ENABLE ROW LEVEL SECURITY;
ALTER TABLE stay_in_touch_cadences FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON stay_in_touch_cadences
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON tags
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON tasks
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace_invitations
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_lifecycle_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_lifecycle_records FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace_lifecycle_records
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace_members
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_profile_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_profile_modules FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace_profile_modules
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace_settings
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- -----------------------------------------------------------------------------
-- Narrow cross-workspace paths (ADR 0008, amended 2026-11-08)
-- -----------------------------------------------------------------------------
-- A few paths legitimately span workspaces or run before one is known. Each
-- has exactly one means: a SECURITY DEFINER function owned by a non-login role
-- that is not a superuser and does not bypass row-level security, whose own
-- policy admits only what that function reads; or, for the worker alone,
-- kinship_worker policies on just the tables its scans read. The functions
-- schema-qualify every name and pin search_path. A function named enter_*
-- scopes the calling transaction to the workspace a secret names, and refuses
-- to move a transaction that is already scoped to another workspace.

-- Session resolution and the workspace switcher: a verified user's active
-- memberships, before any workspace is chosen.
GRANT SELECT ON users, workspaces, workspace_members TO kinship_session_resolver;
CREATE POLICY session_resolution ON workspace_members FOR SELECT
  TO kinship_session_resolver USING (true);

CREATE FUNCTION session_workspace_contexts(p_user_id uuid)
RETURNS TABLE (member_id uuid, role text, user_id uuid, workspace_id uuid, workspace_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT wm.id, wm.role, u.id, w.id, w.name
  FROM crm.users u
  JOIN crm.workspace_members wm ON wm.user_id = u.id
  JOIN crm.workspaces w ON w.id = wm.workspace_id
  WHERE u.id = p_user_id AND u.status = 'active' AND u.deleted_at IS NULL
    AND u.email_verified_at IS NOT NULL
    AND wm.status = 'active' AND wm.left_at IS NULL
    AND w.status = 'active' AND w.deleted_at IS NULL
  ORDER BY wm.joined_at ASC NULLS LAST, wm.id ASC;
END
$function$;
COMMENT ON FUNCTION session_workspace_contexts(uuid) IS 'Session resolution and the workspace switcher (ADR 0008): the active memberships a verified, active user may enter, first joined first.';

CREATE FUNCTION session_audit_context(p_user_id uuid)
RETURNS TABLE (member_id uuid, role text, user_id uuid, workspace_id uuid, workspace_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT wm.id, wm.role, u.id, w.id, w.name
  FROM crm.users u
  JOIN crm.workspace_members wm ON wm.user_id = u.id
  JOIN crm.workspaces w ON w.id = wm.workspace_id
  WHERE u.id = p_user_id
  ORDER BY (wm.status = 'active' AND wm.left_at IS NULL) DESC,
    wm.joined_at ASC NULLS LAST, wm.id ASC
  LIMIT 1;
END
$function$;
COMMENT ON FUNCTION session_audit_context(uuid) IS 'Session resolution (ADR 0008): the one membership an account-level security event is recorded under, active memberships first.';

-- Bearer-token login and the calendar feed: the workspace a token row names,
-- found by the token id the presented secret carries.
GRANT SELECT (id, workspace_id) ON api_tokens TO kinship_token_resolver;
CREATE POLICY token_resolution ON api_tokens FOR SELECT
  TO kinship_token_resolver USING (true);

CREATE FUNCTION enter_api_token_workspace(p_token_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  found_workspace uuid;
  scoped text := nullif(current_setting('app.workspace_id', true), '');
BEGIN
  SELECT t.workspace_id INTO found_workspace
  FROM crm.api_tokens t WHERE t.id = p_token_id;
  IF found_workspace IS NULL THEN RETURN NULL; END IF;
  IF scoped IS NOT NULL AND scoped <> found_workspace::text THEN
    RAISE EXCEPTION 'transaction is already scoped to another workspace';
  END IF;
  PERFORM set_config('app.workspace_id', found_workspace::text, true);
  RETURN found_workspace;
END
$function$;
COMMENT ON FUNCTION enter_api_token_workspace(uuid) IS 'Bearer-token login and the calendar feed (ADR 0008): scopes the calling transaction to the workspace of the token row with this id and returns it, or null when there is none. The caller still verifies the secret.';

-- Invitation acceptance (registration): the workspace an invitation's token
-- hash names, before the invitee is a member of it.
GRANT SELECT (token_hash, workspace_id) ON workspace_invitations TO kinship_invitation_resolver;
CREATE POLICY invitation_resolution ON workspace_invitations FOR SELECT
  TO kinship_invitation_resolver USING (true);

CREATE FUNCTION enter_invitation_workspace(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  found_workspace uuid;
  scoped text := nullif(current_setting('app.workspace_id', true), '');
BEGIN
  SELECT i.workspace_id INTO found_workspace
  FROM crm.workspace_invitations i WHERE i.token_hash = p_token_hash;
  IF found_workspace IS NULL THEN RETURN NULL; END IF;
  IF scoped IS NOT NULL AND scoped <> found_workspace::text THEN
    RAISE EXCEPTION 'transaction is already scoped to another workspace';
  END IF;
  PERFORM set_config('app.workspace_id', found_workspace::text, true);
  RETURN found_workspace;
END
$function$;
COMMENT ON FUNCTION enter_invitation_workspace(text) IS 'Invitation acceptance (ADR 0008, registration): scopes the calling transaction to the workspace of the invitation with this token hash and returns it, or null when there is none.';

-- Registration: the workspaces a never-verified registration created that
-- nobody else belongs to, which discarding it removes.
GRANT SELECT ON workspaces, workspace_members TO kinship_registration;
CREATE POLICY registration_cleanup ON workspace_members FOR SELECT
  TO kinship_registration USING (true);

CREATE FUNCTION unshared_registration_workspaces(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT w.id FROM crm.workspaces w
  WHERE w.created_by_user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM crm.workspace_members m
      WHERE m.workspace_id = w.id AND m.user_id <> p_user_id
    )
  ORDER BY w.id;
END
$function$;
COMMENT ON FUNCTION unshared_registration_workspaces(uuid) IS 'Registration (ADR 0008): the workspaces this user created that no other account belongs to.';

-- Personal account lifecycle: leaving every workspace or deleting the account
-- reads the account's memberships, and each workspace's active owners.
GRANT SELECT ON workspaces, workspace_members TO kinship_account_lifecycle;
CREATE POLICY account_lifecycle ON workspace_members FOR SELECT
  TO kinship_account_lifecycle USING (true);

CREATE FUNCTION account_lifecycle_memberships(p_user_id uuid)
RETURNS TABLE (member_id uuid, workspace_id uuid, workspace_name text, role text, status text, active_owner_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT wm.id, wm.workspace_id, w.name, wm.role, wm.status,
    (SELECT count(*)::integer FROM crm.workspace_members owners
      WHERE owners.workspace_id = wm.workspace_id
        AND owners.role = 'owner' AND owners.status = 'active'
        AND owners.left_at IS NULL)
  FROM crm.workspace_members wm
  JOIN crm.workspaces w ON w.id = wm.workspace_id
  WHERE wm.user_id = p_user_id
    AND wm.status <> 'left' AND wm.left_at IS NULL
    AND w.status = 'active' AND w.deleted_at IS NULL
  ORDER BY lower(w.name), wm.workspace_id;
END
$function$;
COMMENT ON FUNCTION account_lifecycle_memberships(uuid) IS 'Personal account lifecycle (ADR 0008): the memberships of this account that have not ended, in active workspaces, with each workspace''s active owner count.';

-- Workspace lifecycle: which of a workspace's members have no other active
-- workspace, so that deleting or resetting it signs out only them (SECT-05).
GRANT SELECT ON workspaces, workspace_members TO kinship_workspace_lifecycle;
CREATE POLICY workspace_lifecycle ON workspace_members FOR SELECT
  TO kinship_workspace_lifecycle USING (true);

CREATE FUNCTION workspace_sole_member_user_ids(p_workspace_id uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT member.user_id FROM crm.workspace_members member
  WHERE member.workspace_id = p_workspace_id
    AND member.status = 'active' AND member.left_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM crm.workspace_members other
      JOIN crm.workspaces elsewhere ON elsewhere.id = other.workspace_id
      WHERE other.user_id = member.user_id
        AND other.workspace_id <> member.workspace_id
        AND other.status = 'active' AND other.left_at IS NULL
        AND elsewhere.status = 'active' AND elsewhere.deleted_at IS NULL
    );
END
$function$;
COMMENT ON FUNCTION workspace_sole_member_user_ids(uuid) IS 'Workspace lifecycle (ADR 0008): the users whose only active membership is this workspace.';

-- Durable throttles and mail budgets: request-log rows keyed by a subject
-- digest, most written before any workspace exists, and the per-recipient
-- mail cap that deliberately counts across workspaces. The budget role reads
-- and writes only rows that carry a digest.
GRANT SELECT, INSERT, UPDATE ON api_request_logs TO kinship_request_budget;
CREATE POLICY request_budget_read ON api_request_logs FOR SELECT
  TO kinship_request_budget USING (authentication_subject_digest IS NOT NULL);
CREATE POLICY request_budget_record ON api_request_logs FOR INSERT
  TO kinship_request_budget
  WITH CHECK (method = 'POST' AND authentication_subject_digest IS NOT NULL);
CREATE POLICY request_budget_settle ON api_request_logs FOR UPDATE
  TO kinship_request_budget USING (authentication_subject_digest IS NOT NULL)
  WITH CHECK (authentication_subject_digest IS NOT NULL);

CREATE FUNCTION request_budget_attempts(p_path text, p_digests text[], p_since timestamptz)
RETURNS TABLE (client_ip inet, status_code integer, occurred_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT log.client_ip, log.status_code, log.occurred_at
  FROM crm.api_request_logs log
  WHERE log.method = 'POST' AND log.path = p_path
    AND log.authentication_subject_digest = ANY (p_digests)
    AND log.occurred_at > p_since;
END
$function$;
COMMENT ON FUNCTION request_budget_attempts(text, text[], timestamptz) IS 'Durable throttles and mail budgets (ADR 0008): the budget rows of one path for these subject digests since a time, in any workspace or none.';

CREATE FUNCTION request_budget_workspace_count(p_path text, p_workspace_id uuid, p_since timestamptz)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN (
    SELECT count(*)::integer FROM crm.api_request_logs log
    WHERE log.method = 'POST' AND log.path = p_path
      AND log.workspace_id = p_workspace_id AND log.occurred_at > p_since
      AND log.authentication_subject_digest IS NOT NULL
  );
END
$function$;
COMMENT ON FUNCTION request_budget_workspace_count(text, uuid, timestamptz) IS 'Mail budgets (ADR 0008): how many budget rows of one path a sending workspace recorded since a time.';

CREATE FUNCTION record_request_budget(
  p_path text, p_digest text, p_client_ip inet, p_status_code integer,
  p_occurred_at timestamptz, p_workspace_id uuid, p_user_id uuid, p_member_id uuid
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  recorded uuid;
BEGIN
  INSERT INTO crm.api_request_logs (
    workspace_id, user_id, member_id, method, path, client_ip,
    authentication_subject_digest, status_code, occurred_at, created_at
  ) VALUES (
    p_workspace_id, p_user_id, p_member_id, 'POST', p_path, p_client_ip,
    p_digest, p_status_code, p_occurred_at, p_occurred_at
  )
  RETURNING id INTO recorded;
  RETURN recorded;
END
$function$;
COMMENT ON FUNCTION record_request_budget(text, text, inet, integer, timestamptz, uuid, uuid, uuid) IS 'Durable throttles and mail budgets (ADR 0008): records one budget row and returns its id.';

CREATE FUNCTION finalize_request_budget(p_id uuid, p_status_code integer, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  finalized uuid;
BEGIN
  UPDATE crm.api_request_logs SET status_code = p_status_code, user_id = p_user_id
  WHERE id = p_id AND status_code IS NULL
  RETURNING id INTO finalized;
  RETURN finalized;
END
$function$;
COMMENT ON FUNCTION finalize_request_budget(uuid, integer, uuid) IS 'Durable throttles (ADR 0008): settles one outstanding reservation with its outcome, or answers null when it was not outstanding.';

-- Planner statistics after a bulk load (REL-116): no service role may ANALYZE
-- a table it does not own, and neither receives MAINTAIN. This function, owned
-- by a role that holds MAINTAIN on exactly these tables, analyzes them.
GRANT MAINTAIN ON people, reminders, reminder_occurrences TO kinship_planning_maintenance;

CREATE FUNCTION analyze_planning_tables()
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  ANALYZE crm.people, crm.reminders, crm.reminder_occurrences;
END
$function$;
COMMENT ON FUNCTION analyze_planning_tables() IS 'Refreshes planner statistics for the bulk-loaded planning tables (REL-116) without granting MAINTAIN to a service role.';

-- The worker's due-work scans: the worker role alone reads, across every
-- workspace, just the tables its scans read, and settles the rows it claims,
-- withdraws, or purges. Everything it inserts still names its workspace.
CREATE POLICY worker_scan ON people FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON reminders FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON reminder_rules FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON workspace_members FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON workspace_settings FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON recurring_debts FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON workspace_lifecycle_records FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_settle ON workspace_lifecycle_records FOR UPDATE TO kinship_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_scan ON reminder_occurrences FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_settle ON reminder_occurrences FOR UPDATE TO kinship_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_withdraw ON reminder_occurrences FOR DELETE TO kinship_worker USING (true);
-- The retention purge (AUD-A2) reaches only the rows it deletes: the sign-in
-- and MFA throttle rows and the mail-budget reservations, all POST rows, with
-- or without the subject digest older rows lack; no other request log.
CREATE POLICY worker_purge_scan ON api_request_logs FOR SELECT TO kinship_worker
  USING (method = 'POST' AND (path IN ('/api/v1/sessions', '/api/v1/mfa-challenges') OR path LIKE 'mail-budget/%'));
CREATE POLICY worker_purge ON api_request_logs FOR DELETE TO kinship_worker
  USING (method = 'POST' AND (path IN ('/api/v1/sessions', '/api/v1/mfa-challenges') OR path LIKE 'mail-budget/%'));
-- It keeps a stale registration whose address a pending invitation still
-- names, in any workspace.
CREATE POLICY worker_scan ON workspace_invitations FOR SELECT TO kinship_worker USING (true);

-- The worker's jobs: reminder delivery and replenishment, recurring debts,
-- the workspace cleanup reconciler, and the retention purge (AUD-A2).
GRANT SELECT ON currencies, users, workspaces, workspace_members,
  member_preferences, workspace_settings, people, person_dates, reminder_rules,
  recurring_debts, workspace_lifecycle_records, user_sessions
  TO kinship_worker;
GRANT SELECT, UPDATE ON reminders TO kinship_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON reminder_occurrences TO kinship_worker;
GRANT UPDATE ON recurring_debts, workspace_lifecycle_records TO kinship_worker;
-- Delivery holds a workspace's settings and its members' preferences FOR SHARE
-- while it schedules under them; a row lock needs an UPDATE privilege, and one
-- column is enough.
GRANT UPDATE (updated_at) ON member_preferences, workspace_settings TO kinship_worker;
GRANT SELECT, INSERT ON debts TO kinship_worker;
GRANT SELECT, INSERT ON audit_events TO kinship_worker;
GRANT SELECT, DELETE ON api_request_logs, user_sessions, password_reset_requests,
  email_verification_tokens TO kinship_worker;
GRANT DELETE ON users TO kinship_worker;
-- The stale-registration purge locks the users it considers FOR UPDATE, which
-- needs an UPDATE privilege; one column is enough, and it writes none.
GRANT UPDATE (updated_at) ON users TO kinship_worker;
-- A stale registration made before AUD-A2 may still hold the workspace it was
-- provisioned with; the purge deletes it, and its rows cascade.
GRANT SELECT ON workspace_invitations TO kinship_worker;
GRANT DELETE ON workspaces TO kinship_worker;

-- Privileges. The API's role has DML on every table and no DDL. The worker's
-- role has only what its jobs need. Each function owner has only what its
-- function reads, and the functions are executable only by the service roles.
-- Ownership moves to each path's own role, which holds CREATE on the schema
-- only while its owner changes.
DO $privileges$
DECLARE
  routine record;
BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO kinship_app', current_schema());
  FOR routine IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p WHERE p.pronamespace = current_schema()::regnamespace
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', routine.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO kinship_app', routine.signature);
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.analyze_planning_tables() TO kinship_worker', current_schema());
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.unshared_registration_workspaces(uuid) TO kinship_worker', current_schema());
  EXECUTE format('GRANT CREATE ON SCHEMA %I TO kinship_session_resolver, kinship_token_resolver, kinship_invitation_resolver, kinship_registration, kinship_account_lifecycle, kinship_workspace_lifecycle, kinship_request_budget, kinship_planning_maintenance', current_schema());
  ALTER FUNCTION session_workspace_contexts(uuid) OWNER TO kinship_session_resolver;
  ALTER FUNCTION session_audit_context(uuid) OWNER TO kinship_session_resolver;
  ALTER FUNCTION enter_api_token_workspace(uuid) OWNER TO kinship_token_resolver;
  ALTER FUNCTION enter_invitation_workspace(text) OWNER TO kinship_invitation_resolver;
  ALTER FUNCTION unshared_registration_workspaces(uuid) OWNER TO kinship_registration;
  ALTER FUNCTION account_lifecycle_memberships(uuid) OWNER TO kinship_account_lifecycle;
  ALTER FUNCTION workspace_sole_member_user_ids(uuid) OWNER TO kinship_workspace_lifecycle;
  ALTER FUNCTION request_budget_attempts(text, text[], timestamptz) OWNER TO kinship_request_budget;
  ALTER FUNCTION request_budget_workspace_count(text, uuid, timestamptz) OWNER TO kinship_request_budget;
  ALTER FUNCTION record_request_budget(text, text, inet, integer, timestamptz, uuid, uuid, uuid) OWNER TO kinship_request_budget;
  ALTER FUNCTION finalize_request_budget(uuid, integer, uuid) OWNER TO kinship_request_budget;
  ALTER FUNCTION analyze_planning_tables() OWNER TO kinship_planning_maintenance;
  EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM kinship_session_resolver, kinship_token_resolver, kinship_invitation_resolver, kinship_registration, kinship_account_lifecycle, kinship_workspace_lifecycle, kinship_request_budget, kinship_planning_maintenance', current_schema());
END
$privileges$;
