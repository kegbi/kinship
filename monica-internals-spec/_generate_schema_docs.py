import json
import pathlib
import re

repo = pathlib.Path(__file__).resolve().parents[1] / "monica-4.x"
outdir = pathlib.Path(__file__).resolve().parent
root = repo / "database" / "migrations"


def rel(path):
    return pathlib.Path(path).as_posix()


def src_link(path, line):
    if not path:
        return ""
    return f"[source](../monica-4.x/{path}#L{line})"


def mask_comments(text):
    """Replace PHP comments with spaces while preserving newlines/offsets."""
    result = []
    index = 0
    in_string = None
    escaped = False
    while index < len(text):
        char = text[index]
        nxt = text[index + 1] if index + 1 < len(text) else ""
        if in_string:
            result.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == in_string:
                in_string = None
            index += 1
            continue
        if char in ("'", '"'):
            in_string = char
            result.append(char)
            index += 1
            continue
        if char == "/" and nxt == "/":
            result.extend([" ", " "])
            index += 2
            while index < len(text) and text[index] != "\n":
                result.append(" ")
                index += 1
            continue
        if char == "/" and nxt == "*":
            result.extend([" ", " "])
            index += 2
            while index < len(text) - 1:
                if text[index] == "*" and text[index + 1] == "/":
                    result.extend([" ", " "])
                    index += 2
                    break
                result.append("\n" if text[index] == "\n" else " ")
                index += 1
            continue
        result.append(char)
        index += 1
    return "".join(result)


def extract_up(text):
    match = re.search(r"function\s+up\s*\([^)]*\)\s*\{", text)
    if not match:
        return ""

    index = match.end()
    depth = 1
    in_string = None
    escaped = False
    while index < len(text) and depth:
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == in_string:
                in_string = None
        else:
            if char in ("'", '"'):
                in_string = char
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
        index += 1
    return text[match.end() : index - 1]


def extract_method(text, name):
    match = re.search(r"function\s+" + re.escape(name) + r"\s*\([^)]*\)\s*\{", text)
    if not match:
        return ""

    index = match.end()
    depth = 1
    in_string = None
    escaped = False
    while index < len(text) and depth:
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == in_string:
                in_string = None
        else:
            if char in ("'", '"'):
                in_string = char
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
        index += 1
    return text[match.end() : index - 1]


def collect_up_segments(text, up_text):
    segments = [up_text]
    seen = set()
    queue = list(re.findall(r"\$this->([A-Za-z_][A-Za-z0-9_]*)\s*\(", up_text))
    while queue:
        name = queue.pop(0)
        if name in seen:
            continue
        seen.add(name)
        body = extract_method(text, name)
        if not body:
            continue
        segments.append(body)
        queue.extend(re.findall(r"\$this->([A-Za-z_][A-Za-z0-9_]*)\s*\(", body))
    return segments


def line_no(text, position):
    return text[:position].count("\n") + 1


def split_statements(block, base_line):
    statements = []
    current = []
    start = None
    depth = 0
    in_string = None
    escaped = False
    line = base_line

    for char in block:
        if start is None and not char.isspace():
            start = line
        current.append(char)
        if char == "\n":
            line += 1
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == in_string:
                in_string = None
        else:
            if char in ("'", '"'):
                in_string = char
            elif char in "([{":
                depth += 1
            elif char in ")]}":
                depth = max(0, depth - 1)
            elif char == ";" and depth == 0:
                statement = "".join(current).strip()
                if statement:
                    statements.append((start or line, statement))
                current = []
                start = None
    return statements


def parse_args(argstr):
    args = []
    current = ""
    depth = 0
    in_string = None
    escaped = False

    for char in argstr:
        if in_string:
            current += char
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == in_string:
                in_string = None
        else:
            if char in ("'", '"'):
                in_string = char
                current += char
            elif char in "([{":
                depth += 1
                current += char
            elif char in ")]}":
                depth -= 1
                current += char
            elif char == "," and depth == 0:
                args.append(current.strip())
                current = ""
            else:
                current += char
    if current.strip():
        args.append(current.strip())
    return args


def clean_arg(arg):
    arg = arg.strip()
    if len(arg) >= 2 and arg[0] in ("'", '"') and arg[-1] == arg[0]:
        return arg[1:-1]
    return arg


class Column:
    def __init__(self, name, column_type, source, line):
        self.name = name
        self.type = column_type
        self.length = None
        self.precision = None
        self.scale = None
        self.enum = None
        self.nullable = False
        self.default = None
        self.unsigned = False
        self.primary = False
        self.unique = False
        self.index = False
        self.created_at = source
        self.created_line = line
        self.updated_at = source
        self.updated_line = line
        self.notes = []

    def merge_change(self, other):
        for key, value in other.__dict__.items():
            if key in ("name", "created_at", "created_line"):
                continue
            if value not in (None, False, [], ""):
                setattr(self, key, value)
        self.updated_at = other.updated_at
        self.updated_line = other.updated_line

    def asdict(self):
        return self.__dict__.copy()


tables = {}


def ensure_table(name):
    return tables.setdefault(
        name,
        {
            "columns": {},
            "foreign_keys": [],
            "indexes": [],
            "created_at": None,
            "created_line": None,
            "dropped": False,
        },
    )


def add_column(table, column, change=False):
    columns = ensure_table(table)["columns"]
    if change and column.name in columns:
        columns[column.name].merge_change(column)
    else:
        columns[column.name] = column


def parse_column_statement(statement, source, line):
    normalized = " ".join(statement.split())
    match = re.search(r"\$table->([A-Za-z_][A-Za-z0-9_]*)\((.*?)\)", normalized)
    if not match:
        return None

    method = match.group(1)
    args = parse_args(match.group(2))
    known = {
        "increments",
        "bigIncrements",
        "id",
        "string",
        "char",
        "text",
        "mediumText",
        "longText",
        "integer",
        "unsignedInteger",
        "bigInteger",
        "unsignedBigInteger",
        "boolean",
        "date",
        "dateTime",
        "datetime",
        "timestamp",
        "timestamps",
        "nullableTimestamps",
        "softDeletes",
        "rememberToken",
        "enum",
        "decimal",
        "double",
        "float",
        "json",
        "jsonb",
        "uuid",
        "ipAddress",
        "binary",
    }
    if method not in known:
        return None

    if method == "timestamps":
        return [Column("created_at", "timestamp", source, line), Column("updated_at", "timestamp", source, line)]
    if method == "nullableTimestamps":
        created = Column("created_at", "timestamp", source, line)
        updated = Column("updated_at", "timestamp", source, line)
        created.nullable = True
        updated.nullable = True
        return [created, updated]
    if method == "softDeletes":
        column = Column("deleted_at", "timestamp", source, line)
        column.nullable = True
        return [column]
    if method == "rememberToken":
        column = Column("remember_token", "string", source, line)
        column.length = 100
        column.nullable = True
        return [column]
    if method == "id":
        column = Column("id", "bigIncrements", source, line)
        column.unsigned = True
        column.primary = True
        return [column]
    if method in ("increments", "bigIncrements"):
        column = Column(clean_arg(args[0]) if args else "id", method, source, line)
        column.unsigned = True
        column.primary = True
        return [column]
    if not args:
        return None

    column = Column(clean_arg(args[0]), method, source, line)
    if method.startswith("unsigned"):
        column.unsigned = True
    if method in ("string", "char") and len(args) > 1:
        try:
            column.length = int(clean_arg(args[1]))
        except ValueError:
            column.length = clean_arg(args[1])
    if method == "enum" and len(args) > 1:
        column.enum = re.findall(r"['\"]([^'\"]+)['\"]", args[1])
    if method == "decimal" and len(args) > 1:
        try:
            column.precision = int(clean_arg(args[1]))
            column.scale = int(clean_arg(args[2])) if len(args) > 2 else None
        except ValueError:
            pass
    if method in ("double", "float") and len(args) > 1:
        try:
            column.precision = int(clean_arg(args[1]))
            column.scale = int(clean_arg(args[2])) if len(args) > 2 else None
        except ValueError:
            pass

    if "->nullable(" in normalized or "->nullable()" in normalized:
        column.nullable = True
    default_match = re.search(r"->default\((.*?)\)", normalized)
    if default_match:
        column.default = clean_arg(default_match.group(1))
    if "->primary(" in normalized or "->primary()" in normalized:
        column.primary = True
    if "->unique(" in normalized or "->unique()" in normalized:
        column.unique = True
    if "->index(" in normalized or "->index()" in normalized:
        column.index = True
    if "->unsigned(" in normalized or "->unsigned()" in normalized:
        column.unsigned = True
    if "->change(" in normalized or "->change()" in normalized:
        column.notes.append("changed by migration")
    return [column]


def parse_blocks(file_text, up_text, source):
    up_offset = file_text.find(up_text) if up_text else 0
    pattern = r"Schema::(create|table)\((['\"])([^'\"]+)\2\s*,\s*function\s*\([^)]*\)\s*\{"
    for match in re.finditer(pattern, up_text):
        kind = match.group(1)
        table = match.group(3)
        body_start = match.end()
        depth = 1
        index = body_start
        in_string = None
        escaped = False
        while index < len(up_text) and depth:
            char = up_text[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == in_string:
                    in_string = None
            else:
                if char in ("'", '"'):
                    in_string = char
                elif char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
            index += 1

        body = up_text[body_start : index - 1]
        start_line = line_no(file_text, up_offset + match.start())
        table_info = ensure_table(table)
        if kind == "create":
            table_info["created_at"] = source
            table_info["created_line"] = start_line
            table_info["dropped"] = False

        for line, statement in split_statements(body, start_line):
            normalized = " ".join(statement.split())

            drop_match = re.search(r"\$table->dropColumn\((.*?)\)", normalized)
            if drop_match:
                for name in re.findall(r"['\"]([^'\"]+)['\"]", drop_match.group(1)):
                    table_info["columns"].pop(name, None)
                continue

            rename_match = re.search(r"\$table->renameColumn\(['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]\)", normalized)
            if rename_match:
                old, new = rename_match.group(1), rename_match.group(2)
                if old in table_info["columns"]:
                    column = table_info["columns"].pop(old)
                    column.name = new
                    column.updated_at = source
                    column.updated_line = line
                    table_info["columns"][new] = column
                continue

            fk_match = re.search(
                r"\$table->foreign\(['\"]([^'\"]+)['\"]\)->references\(['\"]([^'\"]+)['\"]\)->on\(['\"]([^'\"]+)['\"]\)(?:->onDelete\(['\"]([^'\"]+)['\"]\))?",
                normalized,
            )
            if fk_match:
                table_info["foreign_keys"].append(
                    {
                        "column": fk_match.group(1),
                        "references": fk_match.group(3) + "." + fk_match.group(2),
                        "on_delete": fk_match.group(4),
                        "source": source,
                        "line": line,
                    }
                )
                continue

            explicit_index_match = re.search(r"\$table->(index|unique|primary)\((.*?)\)", normalized)
            column_call = re.search(
                r"\$table->(?:increments|bigIncrements|id|string|char|text|mediumText|longText|integer|unsignedInteger|bigInteger|unsignedBigInteger|boolean|date|dateTime|datetime|timestamp|timestamps|nullableTimestamps|softDeletes|rememberToken|enum|decimal|double|float|json|jsonb|uuid|ipAddress|binary)\(",
                normalized,
            )
            if explicit_index_match and not column_call:
                table_info["indexes"].append(
                    {
                        "type": explicit_index_match.group(1),
                        "columns": re.findall(r"['\"]([^'\"]+)['\"]", explicit_index_match.group(2)),
                        "source": source,
                        "line": line,
                    }
                )
                continue

            columns = parse_column_statement(normalized, source, line)
            if columns:
                is_change = "->change(" in normalized or "->change()" in normalized
                for column in columns:
                    add_column(table, column, change=is_change)
                    if column.index:
                        table_info["indexes"].append({"type": "index", "columns": [column.name], "source": source, "line": line})
                    if column.unique:
                        table_info["indexes"].append({"type": "unique", "columns": [column.name], "source": source, "line": line})
                    if column.primary:
                        table_info["indexes"].append({"type": "primary", "columns": [column.name], "source": source, "line": line})


for file in sorted(root.glob("*.php")):
    text = file.read_text(encoding="utf-8")
    parse_text = mask_comments(text)
    up = extract_up(parse_text)
    source = rel(file.relative_to(repo))
    segments = collect_up_segments(parse_text, up)

    for segment in segments:
        for drop_match in re.finditer(r"Schema::drop(?:IfExists)?\((.*?)\)\s*;", segment, re.S):
            for name in re.findall(r"['\"]([^'\"]+)['\"]", drop_match.group(1)):
                table_info = ensure_table(name)
                table_info["dropped"] = True
                table_info["columns"] = {}
                table_info["foreign_keys"] = []
                table_info["indexes"] = []

        parse_blocks(parse_text, segment, source)

    for rename_match in re.finditer(r"Schema::rename\(['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]\)", up):
        old, new = rename_match.group(1), rename_match.group(2)
        if old in tables:
            tables[new] = tables.pop(old)

    if file.name == "2020_12_19_205923_add_uuids.php":
        array_match = re.search(r"private \$tables\s*=\s*\[(.*?)\];", text, re.S)
        if array_match:
            for name in re.findall(r"['\"]([^'\"]+)['\"]", array_match.group(1)):
                column = Column("uuid", "uuid", source, 52)
                column.nullable = True
                column.index = True
                add_column(name, column)
                ensure_table(name)["indexes"].append(
                    {
                        "type": "index",
                        "columns": ["uuid"] if name == "accounts" else ["account_id", "uuid"],
                        "source": source,
                        "line": 53,
                    }
                )

# The 2019 foreign-key cleanup migration calls a helper from `up()` that drops
# the obsolete `notifications` table. The static block parser does not descend
# into helper method bodies, so record that lifecycle operation explicitly.
if "notifications" in tables:
    tables["notifications"]["dropped"] = True

final_tables = {name: data for name, data in tables.items() if not data.get("dropped")}

table_descriptions = {
    "accounts": "Tenant/account root. Most user-owned records carry `account_id` and cascade from this table.",
    "users": "Login identities inside an account. Stores authentication, MFA, display, locale, and preference data.",
    "contacts": "Primary person record. Holds name, profile metadata, special-date pointers, avatar state, CardDAV state, and archive/delete flags.",
    "contact_fields": "Typed contact data values such as email addresses, phone numbers, social URLs, and profile links.",
    "contact_field_types": "Per-account definitions for contact field kinds. Defaults are copied from `default_contact_field_types`.",
    "contact_field_labels": "Reusable labels attached to contact fields or addresses.",
    "addresses": "Connects contacts to normalized places with an optional address display name.",
    "places": "Postal/geographical place details shared by addresses and weather cache.",
    "companies": "Companies/employers scoped to an account.",
    "occupations": "Employment history and current work records for contacts.",
    "genders": "Per-account gender vocabulary; contacts reference this instead of old enum gender.",
    "tags": "Account-scoped labels used for contact grouping.",
    "photos": "Uploaded image metadata stored in filesystem-backed storage.",
    "documents": "Uploaded non-image document metadata stored in filesystem-backed storage.",
    "addressbooks": "Local CardDAV address books owned by a user/account.",
    "addressbook_subscriptions": "Remote CardDAV address book subscriptions and sync state.",
    "synctoken": "DAV sync-token ledger used to track changed/deleted contacts/tasks/calendars.",
    "activities": "Shared account activity/interactions that can involve multiple contacts and appear in the journal.",
    "activity_statistics": "Yearly per-contact denormalized activity counts.",
    "activity_type_categories": "Per-account grouping for activity types.",
    "activity_types": "Per-account activity type definitions.",
    "calls": "Logged phone/communication calls with a contact and optional emotions.",
    "notes": "Free-form notes attached to contacts, with favorite support.",
    "conversations": "Messaging thread with a contact, usually through a contact field type/channel.",
    "messages": "Individual messages inside conversations.",
    "debts": "Money owed by or to contacts.",
    "gifts": "Gift ideas, offered gifts, and received gifts for contacts.",
    "tasks": "Tasks that may be account-wide or attached to a contact; exported to CalDAV VTODO.",
    "reminders": "Recurring or one-off reminders about contacts/special dates.",
    "reminder_rules": "Per-account notification lead-time rules.",
    "reminder_outbox": "Scheduled reminder notifications generated from reminders and rules.",
    "journal_entries": "Polymorphic journal timeline linking days, entries, and activities.",
    "entries": "Manual journal text entries.",
    "days": "Daily mood/rating records in the journal.",
    "life_event_categories": "Per-account groupings for life event types.",
    "life_event_types": "Per-account life-event type definitions; can carry JSON schemas for specific fields.",
    "life_events": "Timeline events for a contact, optionally tied to a reminder and with JSON details.",
    "special_dates": "Normalized contact dates such as birthdays, first-met date, and deceased date.",
    "relationship_type_groups": "Per-account relationship category groups.",
    "relationship_types": "Directional relationship labels; stores forward and reverse names.",
    "relationships": "Directional edge from one contact to another through a relationship type.",
    "metadata_love_relationships": "Extra metadata for love/couple relationships.",
    "pets": "Contact-associated pet records.",
    "pet_categories": "Global pet category vocabulary.",
    "weather": "Cached weather JSON for places.",
    "import_jobs": "vCard/CSV import job metadata.",
    "import_job_reports": "Per-contact import result rows for an import job.",
    "export_jobs": "Async export job metadata for SQL/JSON downloads.",
    "audit_logs": "Account audit/event log rows, optionally about a contact.",
    "modules": "Per-account feature-module toggles shown on contact profiles.",
    "invitations": "Pending invitations for additional account users.",
    "recovery_codes": "2FA recovery codes for users.",
    "terms": "Versioned legal/compliance policy documents.",
    "term_user": "Pivot recording which user/account accepted which terms and from what IP.",
    "subscriptions": "Laravel Cashier subscription records for account billing.",
    "subscription_items": "Laravel Cashier subscription item rows after Cashier upgrade.",
    "currencies": "Global currency list used by users, debts, and gifts.",
    "api_usage": "Daily API usage counters by account/user/IP.",
    "oauth_access_tokens": "Laravel Passport OAuth access tokens.",
    "oauth_auth_codes": "Laravel Passport OAuth authorization codes.",
    "oauth_clients": "Laravel Passport OAuth clients.",
    "oauth_personal_access_clients": "Laravel Passport personal access client registry.",
    "oauth_refresh_tokens": "Laravel Passport refresh tokens.",
    "webauthn_keys": "WebAuthn/FIDO2 credential records.",
    "u2f_key": "Legacy U2F key table retained for older installations.",
    "password_resets": "Password reset tokens.",
    "sessions": "Database session store.",
    "cache": "Database cache store.",
    "jobs": "Database queue jobs.",
    "failed_jobs": "Failed queue job log.",
    "job_batches": "Laravel queue batch metadata.",
    "crons": "Tracks scheduled command execution metadata.",
    "instances": "Instance-level metadata and version/check state.",
    "statistics": "Instance/account aggregate counters used by dashboard/admin/statistics.",
}

common_column_descriptions = {
    "id": "Database primary key. Monica commonly uses raw ids internally and hashed ids in some web routes.",
    "uuid": "Stable UUID used by exports, API/DAV payloads, and cross-system references.",
    "account_id": "Tenant/account foreign key. This is the main data ownership boundary.",
    "user_id": "User foreign key inside the owning account.",
    "contact_id": "Foreign key to the contact this row belongs to.",
    "created_at": "Laravel creation timestamp.",
    "updated_at": "Laravel last-update timestamp.",
    "deleted_at": "Soft-delete timestamp. A non-null value hides the row from normal Eloquent queries.",
    "name": "Display/internal name for this row.",
    "description": "Longer description or note text for this row.",
    "body": "Main note/body text.",
    "comment": "User-entered comment or annotation.",
    "title": "Title or short user-facing label.",
    "email": "Email address.",
    "password": "Hashed password or encrypted secret, depending on table context.",
    "remember_token": "Laravel remember-me token.",
    "first_name": "Given name for a user/contact.",
    "middle_name": "Middle name for a contact.",
    "last_name": "Family name for a user/contact.",
    "nickname": "Contact nickname shown alongside formal name.",
    "locale": "User locale code used for translations.",
    "timezone": "User timezone string used for date display and reminders.",
    "currency_id": "Foreign key to `currencies`; default currency for user or money row.",
    "active": "Boolean active flag.",
    "is_active": "Boolean active/archive flag; for contacts, false means archived.",
    "delible": "Whether the user may delete the row. Monica uses the misspelled column name.",
    "core_monica_data": "Marks default/seeded rows that came from Monica rather than custom user-created rows.",
    "translation_key": "Translation key for default labels instead of raw text.",
    "created_by": "Creator reference if present.",
    "ip_address": "IP address captured for sessions, audit/compliance, or API usage.",
    "user_agent": "Browser/client user-agent string.",
    "payload": "Serialized queued job payload.",
    "queue": "Queue name.",
    "attempts": "Number of queue attempts.",
    "reserved_at": "Unix timestamp when a queued job was reserved.",
    "available_at": "Unix timestamp when a queued job becomes available.",
    "failed_at": "Timestamp when a job failed.",
    "exception": "Serialized exception text for a failed job.",
    "token": "Opaque security token or reset token.",
    "expires_at": "Expiration datetime.",
    "revoked": "OAuth flag indicating a token/client/code has been revoked.",
    "scopes": "OAuth scopes as serialized JSON/text.",
    "secret": "OAuth/shared client secret or encrypted service secret.",
    "provider": "OAuth/social auth provider.",
    "redirect": "OAuth redirect URI list.",
    "client_id": "OAuth client foreign key.",
    "access_token_id": "OAuth access token foreign key.",
    "api_key": "Legacy per-account API key.",
    "stripe_id": "Stripe customer/subscription/item id depending on table.",
    "stripe_price": "Stripe price id after Cashier rename from `stripe_plan`.",
    "stripe_plan": "Legacy Stripe plan id.",
    "stripe_product": "Stripe product id.",
    "quantity": "Subscription item quantity.",
    "trial_ends_at": "Stripe/Cashier trial end timestamp.",
    "ends_at": "Subscription end/cancel timestamp.",
    "pm_type": "Payment method/card brand after Cashier rename.",
    "pm_last_four": "Last four digits of the payment method after Cashier rename.",
    "number_of_invitations_sent": "Counter of invitations sent by this account.",
    "default_time_reminder_is_sent": "Account default HH:MM time for reminder email scheduling.",
    "default_gender_id": "Default gender row for newly-created contacts in the account.",
    "number_of_days_before": "Lead time in days for reminder notifications.",
    "planned_date": "Date/time a reminder notification is planned to be sent.",
    "initial_date": "First/anchor date for a reminder recurrence.",
    "frequency_type": "Reminder recurrence unit such as day/week/month/year.",
    "frequency_number": "Reminder recurrence interval.",
    "inactive": "Reminder disabled flag.",
    "completed": "Boolean task completion flag.",
    "completed_at": "Datetime when a task was completed.",
    "rate": "Daily journal rating value.",
    "post": "Journal entry text content.",
    "date": "Generic date/date-time interpreted by the table context.",
    "happened_at": "When an activity or life event occurred.",
    "happened_at_month_unknown": "Whether the life-event month is intentionally unknown.",
    "happened_at_day_unknown": "Whether the life-event day is intentionally unknown.",
    "specific_information": "JSON payload for type-specific life-event details.",
    "specific_information_structure": "JSON schema/structure describing life-event type-specific fields.",
    "journalable_id": "Polymorphic id for the object represented in the journal.",
    "journalable_type": "Polymorphic class name for the object represented in the journal.",
    "activity_id": "Foreign key to `activities`.",
    "activity_type_id": "Foreign key to `activity_types`.",
    "activity_type_category_id": "Foreign key to `activity_type_categories`.",
    "summary": "Short activity summary.",
    "location_type": "Activity type location behavior/category.",
    "year": "Calendar year for a statistic row.",
    "count": "Aggregate count.",
    "called_at": "Datetime of a logged call.",
    "contact_called": "Whether the contact called the user or the user called the contact.",
    "who_called": "Legacy/canonical direction indicator for a call when present.",
    "content": "Message or call content.",
    "conversation_id": "Foreign key to `conversations`.",
    "written_at": "Datetime when a message was written.",
    "written_by_me": "Boolean indicating the message author is the Monica user.",
    "in_debt": "Direction flag: whether the contact owes the user or the user owes the contact.",
    "amount": "Money amount stored in decimal form after currency migration.",
    "reason": "Reason for a debt or breakup, depending on table context.",
    "status": "State string; meaning depends on table, e.g. gift or export status.",
    "url": "External URL.",
    "original_filename": "Original uploaded client filename.",
    "new_filename": "Generated storage filename.",
    "filesize": "Uploaded file size in bytes.",
    "type": "Type/category discriminator string.",
    "mime_type": "Uploaded file MIME type.",
    "number_of_downloads": "Download counter for documents.",
    "first_met_where": "Free-text place/context where the user first met the contact.",
    "first_met_additional_info": "Additional free-text first-met narrative.",
    "first_met_through_contact_id": "Contact through whom this contact was introduced.",
    "birthday_special_date_id": "Special date row for birthday.",
    "birthday_reminder_id": "Reminder row associated with birthday.",
    "deceased_special_date_id": "Special date row for deceased date.",
    "deceased_reminder_id": "Reminder row associated with deceased date.",
    "is_dead": "Whether the contact is deceased.",
    "is_starred": "Favorite/star flag for a contact.",
    "is_partial": "Partial contact flag for imported/incomplete data.",
    "last_talked_to": "Date of last known interaction/conversation with the contact.",
    "stay_in_touch_frequency": "Number of days/weeks/months Monica uses for stay-in-touch cadence.",
    "stay_in_touch_trigger_date": "Next/last date used to trigger stay-in-touch reminders.",
    "job": "Legacy free-text job field on contacts.",
    "company": "Legacy free-text company field on contacts before normalized companies/occupations.",
    "food_preferences": "Free-text food/allergy/diet preferences.",
    "avatar_source": "Avatar source selector: default, gravatar, adorable, photo, or external depending on UI state.",
    "avatar_gravatar_url": "Cached Gravatar avatar URL.",
    "avatar_adorable_uuid": "UUID used with the old Adorable Avatars provider.",
    "avatar_adorable_url": "Cached Adorable Avatars URL.",
    "avatar_default_url": "Generated default avatar URL.",
    "avatar_photo_id": "Foreign key to `photos` for uploaded avatar.",
    "has_avatar": "Legacy avatar flag/string.",
    "avatar_external_url": "External URL for avatar image after later avatar migration.",
    "avatar_file_name": "Stored avatar filename for generated/uploaded avatar variants.",
    "avatar_location": "Filesystem disk/path hint for avatar storage.",
    "gravatar_url": "Cached Gravatar URL.",
    "has_avatar_bool": "Boolean avatar flag after avatar structure migration.",
    "default_avatar_color": "Default avatar background color.",
    "last_consulted_at": "Timestamp when a contact profile was last viewed/consulted.",
    "number_of_views": "Contact profile view counter.",
    "address_book_id": "Foreign key to local CardDAV address book that owns/imported the contact.",
    "vcard": "Serialized vCard data cached for CardDAV.",
    "distant_etag": "Remote ETag for subscribed CardDAV contacts.",
    "contact_field_type_id": "Foreign key to `contact_field_types`.",
    "data": "Raw contact field value.",
    "fontawesome_icon": "Font Awesome icon name shown for a contact field type.",
    "protocol": "URI protocol prefix for contact fields, e.g. mailto/tel/https.",
    "label": "Custom label text.",
    "label_i18n": "Translation key for a predefined label.",
    "place_id": "Foreign key to `places`.",
    "street": "Street address line.",
    "city": "City/locality.",
    "province": "Province/state/region.",
    "postal_code": "Postal/ZIP code.",
    "country": "Country code/name text, depending on migration stage and helper use.",
    "latitude": "Latitude coordinate.",
    "longitude": "Longitude coordinate.",
    "website": "Company website URL.",
    "number_of_employees": "Company size estimate.",
    "company_id": "Foreign key to `companies`.",
    "salary": "Free-text or numeric salary field for occupation.",
    "salary_unit": "Salary cadence/unit such as year/month/hour.",
    "currently_works_here": "Whether this occupation is current.",
    "start_date": "Occupation start date.",
    "end_date": "Occupation end date.",
    "relationship_type_group_id": "Foreign key to `relationship_type_groups`.",
    "relationship_type_id": "Foreign key to `relationship_types`.",
    "contact_is": "Subject contact in a directional relationship edge.",
    "of_contact": "Object contact in a directional relationship edge.",
    "name_reverse_relationship": "Label to show when traversing relationship in reverse.",
    "relationship_id": "Foreign key to `relationships`.",
    "meet_date": "Love relationship meet date.",
    "official_date": "Love relationship official/start date.",
    "breakup_date": "Love relationship breakup date.",
    "breakup_reason": "Love relationship breakup reason.",
    "is_age_based": "Whether a special date is age/birthday-like.",
    "is_year_unknown": "Whether the year component of a special date is unknown.",
    "life_event_category_id": "Foreign key to `life_event_categories`.",
    "life_event_type_id": "Foreign key to `life_event_types`.",
    "reminder_id": "Foreign key to `reminders`.",
    "note": "Free-text note attached to this event.",
    "emotion_primary_id": "Foreign key to `emotions_primary`.",
    "emotion_secondary_id": "Foreign key to `emotions_secondary`.",
    "emotion_id": "Foreign key to `emotions`.",
    "weather_json": "Cached weather API response JSON.",
    "import_job_id": "Foreign key to `import_jobs`.",
    "filename": "Stored filename/path for import/export artifacts.",
    "contacts_found": "Number of contacts parsed from import file.",
    "contacts_imported": "Number of contacts successfully imported.",
    "contacts_skipped": "Number of contacts skipped.",
    "behavior": "Import behavior, e.g. add-only versus replace.",
    "contact_information": "Serialized imported contact information/report details.",
    "imported": "Whether this import report row created/updated data.",
    "imported_contact_id": "Contact id created or matched during import.",
    "author_id": "User who caused an audit log event.",
    "about_contact_id": "Contact the audit log is about, if any.",
    "author_name": "Snapshot of author name at audit time.",
    "action": "Audit action key.",
    "objects": "Serialized audit object payload.",
    "audited_at": "Domain timestamp of the audited action.",
    "should_appear_on_dashboard": "Whether to show this audit item in dashboard timelines.",
    "key": "Stable module/cache/job key depending on table context.",
    "value": "Generic value payload.",
    "expiration": "Cache expiration timestamp.",
    "last_ran_at": "Last time a cron command ran.",
    "command": "Scheduled command name.",
    "email_verified_at": "Email verification timestamp.",
    "google2fa_secret": "Encrypted/encoded TOTP secret for 2FA.",
    "admin": "Boolean admin flag.",
    "fluid_container": "UI layout preference.",
    "contacts_sort_order": "Contact list sort preference.",
    "name_order": "Display order preference for contact names.",
    "invited_by_user_id": "User that invited this user/invitation.",
    "dashboard_active_tab": "Dashboard selected tab preference.",
    "gifts_active_tab": "Gift tab selected preference.",
    "profile_active_tab": "Default contact profile tab preference.",
    "profile_new_life_event_badge_seen": "Whether the user dismissed the new life-event badge.",
    "temperature_scale": "Weather temperature unit preference.",
    "me_contact_id": "Contact row representing the user themself.",
    "invitation_key": "Opaque key used to accept an invitation.",
    "recovery": "2FA recovery code value.",
    "used": "Whether a recovery code has been consumed.",
    "policy": "Terms/privacy policy markdown or text content.",
    "version": "Version string of a policy/export/app component.",
    "location": "Filesystem disk/location for export artifact.",
    "started_at": "Export job start timestamp.",
    "ended_at": "Export job completion timestamp.",
    "localSyncToken": "Local sync marker for remote address book subscription.",
    "syncToken": "Remote CardDAV sync token.",
    "capabilities": "Serialized DAV server capabilities.",
    "readonly": "Whether a subscribed address book is read-only.",
    "last_synchronized_at": "Timestamp of the last CardDAV subscription sync.",
    "uri": "Remote/local DAV URI.",
    "username": "Remote DAV username.",
}


def column_description(table, column):
    if column in common_column_descriptions:
        return common_column_descriptions[column]
    if column.endswith("_id"):
        return f"Foreign key/reference id for `{column[:-3]}` in this table's domain."
    if column.startswith("number_of_"):
        return "Denormalized counter used for display/statistics."
    if column.startswith("default_"):
        return "Default value/key copied or used when creating account data."
    if column.startswith("is_") or column.startswith("has_"):
        return "Boolean/status flag used by UI and services."
    if column.endswith("_at"):
        return "Timestamp for this table-specific event."
    return "Table-specific value; see model/service usage and migrations for exact behavior."


def format_type(column):
    column_type = column["type"]
    if column.get("length") is not None:
        column_type += f"({column['length']})"
    if column.get("precision") is not None:
        column_type += f"({column['precision']},{column.get('scale')})"
    if column.get("enum"):
        column_type += "(" + ", ".join(column["enum"]) + ")"
    if column.get("unsigned") and not column_type.startswith("unsigned") and column_type not in ("increments", "bigIncrements"):
        column_type = "unsigned " + column_type
    return column_type


schema = {}
for name, data in sorted(final_tables.items()):
    columns = {}
    for column_name, column in data["columns"].items():
        column_dict = column.asdict()
        column_dict["description"] = column_description(name, column_name)
        columns[column_name] = column_dict
    schema[name] = {
        "description": table_descriptions.get(
            name, "System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle."
        ),
        "created_at": data["created_at"],
        "created_line": data["created_line"],
        "columns": columns,
        "foreign_keys": data["foreign_keys"],
        "indexes": data["indexes"],
    }

(outdir / "schema.json").write_text(json.dumps(schema, indent=2, ensure_ascii=False), encoding="utf-8")

categories = {
    "02-schema-core-account.md": [
        "accounts",
        "users",
        "invitations",
        "recovery_codes",
        "terms",
        "term_user",
        "modules",
        "default_contact_modules",
        "subscriptions",
        "subscription_items",
        "export_jobs",
        "import_jobs",
        "import_job_reports",
        "audit_logs",
        "api_usage",
        "currencies",
    ],
    "03-schema-contacts-profile.md": [
        "contacts",
        "genders",
        "contact_fields",
        "contact_field_types",
        "default_contact_field_types",
        "contact_field_labels",
        "contact_field_contact_field_label",
        "addresses",
        "places",
        "address_contact_field_label",
        "companies",
        "occupations",
        "tags",
        "contact_tag",
        "photos",
        "contact_photo",
        "documents",
        "addressbooks",
        "addressbook_subscriptions",
        "synctoken",
        "weather",
    ],
    "04-schema-interactions-journal.md": [
        "activities",
        "activity_contact",
        "activity_statistics",
        "activity_type_categories",
        "activity_types",
        "default_activity_type_categories",
        "default_activity_types",
        "calls",
        "emotion_call",
        "emotion_activity",
        "emotions",
        "emotions_primary",
        "emotions_secondary",
        "notes",
        "conversations",
        "messages",
        "debts",
        "gifts",
        "gift_photo",
        "tasks",
        "reminders",
        "reminder_rules",
        "reminder_outbox",
        "reminders_sent",
        "journal_entries",
        "entries",
        "days",
        "life_event_categories",
        "life_event_types",
        "life_events",
        "default_life_event_categories",
        "default_life_event_types",
        "special_dates",
        "relationship_type_groups",
        "relationship_types",
        "relationships",
        "default_relationship_type_groups",
        "default_relationship_types",
        "metadata_love_relationships",
        "pets",
        "pet_categories",
    ],
    "05-schema-system-platform.md": [
        "oauth_access_tokens",
        "oauth_auth_codes",
        "oauth_clients",
        "oauth_personal_access_clients",
        "oauth_refresh_tokens",
        "webauthn_keys",
        "u2f_key",
        "password_resets",
        "sessions",
        "cache",
        "jobs",
        "failed_jobs",
        "job_batches",
        "crons",
        "instances",
        "statistics",
    ],
}


def write_schema_doc(filename, title, description):
    names = categories[filename]
    lines = [
        f"# {title}",
        "",
        description,
        "",
        "Each column lists the latest migration source that created or changed it. `Null` is inferred from migration chains; older legacy rows may still violate assumptions before cleanup migrations ran.",
        "",
    ]
    for name in names:
        if name not in schema:
            continue
        table = schema[name]
        lines += [f"## `{name}`", "", table["description"], ""]
        if table["created_at"]:
            lines += [f"Created/last recreated at {src_link(table['created_at'], table['created_line'])}.", ""]
        lines += [
            "| Column | Type | Null | Default | Keys | Description | Source |",
            "|---|---:|:---:|---|---|---|---|",
        ]
        for column_name, column in table["columns"].items():
            keys = []
            if column.get("primary"):
                keys.append("PK")
            if column.get("unique"):
                keys.append("unique")
            if column.get("index"):
                keys.append("index")
            for fk in table["foreign_keys"]:
                if fk["column"] == column_name:
                    suffix = f" ({fk['on_delete']})" if fk.get("on_delete") else ""
                    keys.append("FK -> " + fk["references"] + suffix)
            default = "" if column.get("default") is None else str(column.get("default")).replace("|", "\\|")
            desc = column["description"].replace("|", "\\|")
            lines.append(
                f"| `{column_name}` | `{format_type(column)}` | {'yes' if column.get('nullable') else 'no'} | `{default}` | {', '.join(keys)} | {desc} | {src_link(column.get('updated_at') or column.get('created_at'), column.get('updated_line') or column.get('created_line'))} |"
            )
        if table["foreign_keys"]:
            lines += ["", "Foreign keys:"]
            for fk in table["foreign_keys"]:
                lines.append(
                    f"- `{fk['column']}` -> `{fk['references']}`; on delete `{fk.get('on_delete') or 'not specified'}` ({src_link(fk['source'], fk['line'])})."
                )
        lines.append("")
    (outdir / filename).write_text("\n".join(lines), encoding="utf-8")


write_schema_doc("02-schema-core-account.md", "Database Schema: Account, Users, Billing, Import/Export", "Tenant, identity, billing, import/export, compliance, and audit tables.")
write_schema_doc("03-schema-contacts-profile.md", "Database Schema: Contacts And Profile Data", "Person/profile tables and support data for addresses, contact fields, files, DAV, work, tags, and weather.")
write_schema_doc("04-schema-interactions-journal.md", "Database Schema: Interactions, Journal, Relationships", "Interaction and relationship tables: activities, calls, notes, conversations, gifts, tasks, reminders, journal, life events, special dates, relationship graph, emotions, and pets.")
write_schema_doc("05-schema-system-platform.md", "Database Schema: System Platform Tables", "Authentication, OAuth, WebAuthn/U2F, cache/session/queue, cron, instance, and aggregate statistics tables.")

relation_lines = []
for file in sorted((repo / "app" / "Models").rglob("*.php")):
    text = file.read_text(encoding="utf-8")
    namespace_match = re.search(r"namespace\s+([^;]+);", text)
    namespace = namespace_match.group(1) if namespace_match else ""
    relpath = rel(file.relative_to(repo))
    for match in re.finditer(r"public function\s+(\w+)\s*\([^)]*\)\s*\{(.*?)\n\s*\}", text, re.S):
        body = match.group(2)
        relation_match = re.search(
            r"\$this->(belongsToMany|belongsTo|hasMany|hasOne|morphTo|morphMany|morphOne)\((.*?)\)",
            body,
            re.S,
        )
        if relation_match:
            relation_lines.append(
                (
                    namespace + "\\" + file.stem,
                    match.group(1),
                    relation_match.group(1),
                    relation_match.group(2).replace("\n", " ").strip(),
                    relpath,
                    line_no(text, match.start()),
                )
            )

relationship_doc = [
    "# Domain Models And Relationships",
    "",
    "This file maps Eloquent relationships. The database schema docs are the physical source of truth; this file shows how Monica navigates the data in application code.",
    "",
    "## Tenant Boundary",
    "",
    "Almost every user-owned table belongs to `accounts`. `Account` exposes `hasMany` relations for contacts, interactions, customization tables, import/export jobs, and audit logs. `User` belongs to one account and optionally points to a `me_contact_id` contact representing the user in their own address book.",
    "",
    "## Important Patterns",
    "",
    "- Public web routes bind `{contact}` through `IdHasher`, so UI URLs do not expose raw ids directly.",
    "- `HasUuid` auto-fills UUIDs on models that use the trait; UUIDs were added in `2020_12_19_205923_add_uuids.php`.",
    "- `Contact` uses `SoftDeletes` and also has `is_active`; archive and delete are separate lifecycle states.",
    "- `Journalable` connects `activities`, `entries`, and `days` to `journal_entries` through a polymorphic relation.",
    "- DAV uses `addressbooks`, contact `vcard`/`distant_etag`, and `synctoken` to emulate CardDAV/CalDAV sync.",
    "",
    "## Relationship Inventory",
    "",
    "| Model | Method | Relation | Target/options | Source |",
    "|---|---|---|---|---|",
]
for model, method, relation, args, path, line in relation_lines:
    relationship_doc.append(f"| `{model}` | `{method}` | `{relation}` | `{args.replace('|', '\\|')}` | {src_link(path, line)} |")
(outdir / "06-domain-models.md").write_text("\n".join(relationship_doc), encoding="utf-8")

print(f"tables={len(schema)}")
print(f"columns={sum(len(table['columns']) for table in schema.values())}")
print(f"model_relations={len(relation_lines)}")
