# API Surface

## Registration And Auth

`RouteServiceProvider` mounts API routes under `/api` with namespace `App\Http\Controllers\Api`, OAuth helper routes under `/oauth`, and web routes with the normal web middleware ([source](../monica-4.x/app/Providers/RouteServiceProvider.php#L80)). API throttling is configured by `RATE_LIMIT_PER_MINUTE_API`; OAuth throttling is configured separately by `RATE_LIMIT_PER_MINUTE_OAUTH` ([source](../monica-4.x/app/Providers/RouteServiceProvider.php#L105)).

Public API endpoints are outside the `auth:api` group. All other `/api` endpoints require Laravel Passport bearer authentication through `auth:api` ([routes/api.php](../monica-4.x/routes/api.php#L11)).

## Public API

| Method | Path | Controller | Data |
|---|---|---|---|
| GET | `/api/statistics` | `Statistics\ApiStatisticsController@index` | Public instance statistics if enabled by config ([source](../monica-4.x/routes/api.php#L5)). |
| GET | `/api/compliance` | `Settings\ApiComplianceController@index` | Compliance/terms list ([source](../monica-4.x/routes/api.php#L7)). |
| GET | `/api/compliance/{id}` | `Settings\ApiComplianceController@show` | One compliance/terms record ([source](../monica-4.x/routes/api.php#L7)). |
| GET | `/api/currencies` | `Settings\ApiCurrencyController@index` | Currency list ([source](../monica-4.x/routes/api.php#L9)). |
| GET | `/api/currencies/{currency}` | `Settings\ApiCurrencyController@show` | One currency ([source](../monica-4.x/routes/api.php#L9)). |

## Authenticated API

Standard `Route::apiResource` means:

- `index`: `GET /resource`
- `store`: `POST /resource`
- `show`: `GET /resource/{id}`
- `update`: `PUT/PATCH /resource/{id}`
- `destroy`: `DELETE /resource/{id}`

| Area | Endpoints | Notes |
|---|---|---|
| Session/user | `GET /api/`, `GET /api/me`, `GET /api/me/compliance`, `GET /api/me/compliance/{id}`, `POST /api/me/compliance` | Health/user/compliance current-user endpoints ([source](../monica-4.x/routes/api.php#L12)). |
| Contacts | `apiResource /api/contacts`; `POST /api/me/contact`; `DELETE /api/me/contact`; `PUT /api/contacts/{contact}/work`; `PUT /api/contacts/{contact}/food`; `PUT /api/contacts/{contact}/introduction` | Core contact CRUD plus work, food, introduction, and self-contact helpers ([source](../monica-4.x/routes/api.php#L21)). |
| Genders | `apiResource /api/genders` | Per-account gender vocabulary ([source](../monica-4.x/routes/api.php#L32)). |
| Relationships | `apiResource /api/relationships` except `index`; `GET /api/contacts/{contact}/relationships` | Directional contact graph ([source](../monica-4.x/routes/api.php#L35)). |
| Contact tags | `POST /api/contacts/{contact}/setTags`; `POST /api/contacts/{contact}/unsetTags`; `POST /api/contacts/{contact}/unsetTag` | Batch tag assignment/removal helpers ([source](../monica-4.x/routes/api.php#L41)). |
| Places | `apiResource /api/places` | Normalized address places ([source](../monica-4.x/routes/api.php#L46)). |
| Addresses | `apiResource /api/addresses`; `GET /api/contacts/{contact}/addresses` | Address records and contact-scoped list ([source](../monica-4.x/routes/api.php#L49)). |
| Contact fields | `apiResource /api/contactfields` except `index`; `GET /api/contacts/{contact}/contactfields` | Email/phone/social/profile data values ([source](../monica-4.x/routes/api.php#L54)). |
| Pets | `apiResource /api/pets`; `GET /api/contacts/{contact}/pets` | Contact-associated pets ([source](../monica-4.x/routes/api.php#L58)). |
| Tags | `apiResource /api/tags`; `GET /api/tags/{tag}/contacts` | Account tag CRUD and contacts by tag ([source](../monica-4.x/routes/api.php#L62)). |
| Companies | `apiResource /api/companies` | Account-scoped companies ([source](../monica-4.x/routes/api.php#L66)). |
| Occupations | `apiResource /api/occupations` | Employment records ([source](../monica-4.x/routes/api.php#L69)). |
| Notes | `apiResource /api/notes`; `GET /api/contacts/{contact}/notes` | Contact notes ([source](../monica-4.x/routes/api.php#L72)). |
| Calls | `apiResource /api/calls`; `GET /api/contacts/{contact}/calls` | Calls and emotion links ([source](../monica-4.x/routes/api.php#L77)). |
| Conversations/messages | `apiResource /api/conversations`; `apiResource /api/conversations/{conversation}/messages` except `index/show`; `GET /api/contacts/{contact}/conversations` | Messaging thread and nested message operations ([source](../monica-4.x/routes/api.php#L82)). |
| Activities | `apiResource /api/activities`; `GET /api/contacts/{contact}/activities` | Multi-contact activities ([source](../monica-4.x/routes/api.php#L88)). |
| Reminders | `GET /api/reminders/upcoming/{month}`; `apiResource /api/reminders`; `GET /api/contacts/{contact}/reminders` | Reminder CRUD plus upcoming outbox view ([source](../monica-4.x/routes/api.php#L93)). |
| Tasks | `apiResource /api/tasks`; `GET /api/contacts/{contact}/tasks` | Account/contact tasks ([source](../monica-4.x/routes/api.php#L99)). |
| Gifts | `apiResource /api/gifts`; `GET /api/contacts/{contact}/gifts`; `PUT /api/gifts/{gift}/photo/{photo}` | Gift CRUD and photo association ([source](../monica-4.x/routes/api.php#L103)). |
| Debts | `apiResource /api/debts`; `GET /api/contacts/{contact}/debts` | Debt CRUD and contact-scoped list ([source](../monica-4.x/routes/api.php#L108)). |
| Journal | `apiResource /api/journal` | Journal entries ([source](../monica-4.x/routes/api.php#L112)). |
| Activity type config | `apiResource /api/activitytypes`; `apiResource /api/activitytypecategories` | Per-account activity vocabulary ([source](../monica-4.x/routes/api.php#L116)). |
| Relationship type lookup | `GET /api/relationshiptypegroups`; `GET /api/relationshiptypegroups/{id}`; `GET /api/relationshiptypes`; `GET /api/relationshiptypes/{id}` | Read-only API view of relationship vocabularies ([source](../monica-4.x/routes/api.php#L122)). |
| Life events | `apiResource /api/lifeevents` | Contact life-event CRUD ([source](../monica-4.x/routes/api.php#L128)). |
| Documents | `apiResource /api/documents` except `update`; `GET /api/contacts/{contact}/documents` | Upload/list/show/delete contact documents ([source](../monica-4.x/routes/api.php#L131)). |
| Photos | `apiResource /api/photos` except `update`; `GET /api/contacts/{contact}/photos` | Upload/list/show/delete contact photos ([source](../monica-4.x/routes/api.php#L136)). |
| Avatars | `PUT /api/contacts/{contact}/avatar` | Updates avatar source/data ([source](../monica-4.x/routes/api.php#L141)). |
| Logs | `GET /api/contacts/{contact}/logs`; `apiResource /api/logs` | Contact and account audit logs ([source](../monica-4.x/routes/api.php#L144)). |
| Settings | `apiResource /api/contactfieldtypes` | Contact field type configuration ([source](../monica-4.x/routes/api.php#L149)). |
| Misc | `GET /api/countries` | Country helper list ([source](../monica-4.x/routes/api.php#L155)). |

API JSON shapes are defined in `app/Http/Resources`. Controllers commonly return `Resource::collection()` for indexes and `new Resource($model)` for show/store/update responses, for example contacts use `App\Http\Resources\Contact\Contact` ([source](../monica-4.x/app/Http/Controllers/Api/ApiContactController.php#L18)), notes use `App\Http\Resources\Note\Note` ([source](../monica-4.x/app/Http/Controllers/Api/ApiNoteController.php#L10)), and calls use `App\Http\Resources\Call\Call` ([source](../monica-4.x/app/Http/Controllers/Api/Contact/ApiCallController.php#L15)).

## Web Route Groups

The web app is still important because export/import, subscription, and security settings are web-only. Authenticated, verified, MFA-protected routes include dashboard, contact CRUD, nested contact features, journal, settings, import/export, users, subscriptions, tags, API token settings, DAV setup, and security controls ([routes/web.php](../monica-4.x/routes/web.php#L41)).

Important web-only data routes:

- `/settings/export`, `/settings/exportToSql`, `/settings/exportToJson`, `/settings/export/{uuid}` generate and download SQL/JSON exports ([source](../monica-4.x/routes/web.php#L252)).
- `/settings/import`, `/settings/import/report/{importjobid}`, `/settings/import/upload`, `/settings/import/storeImport` handle vCard imports ([source](../monica-4.x/routes/web.php#L257)).
- `/store/{file}` serves authenticated files from storage after checking the database record belongs to the user's account ([source](../monica-4.x/routes/web.php#L50)).
- `/people/{contact}/vcard` exports a single contact as vCard ([source](../monica-4.x/routes/web.php#L99)).

## OAuth And DAV

OAuth helper routes are mounted at `/oauth` and handle OAuth login, MFA validation, and verification ([routes/oauth.php](../monica-4.x/routes/oauth.php#L5)).

CardDAV/CalDAV are mounted by LaravelSabre at `/dav` when enabled by `DAV_ENABLED` or `CARDDAV_ENABLED` ([config](../monica-4.x/config/laravelsabre.php#L30)). Middleware includes API middleware, basic-auth-token support, account limitation checks, and LaravelSabre authorization ([config](../monica-4.x/config/laravelsabre.php#L54)). The app also redirects `/.well-known/carddav` and `/.well-known/caldav` to `/dav/` ([routes/web.php](../monica-4.x/routes/web.php#L24)).

The DAV service provider registers:

- Principal collection for authenticated users.
- CardDAV address book root for contacts.
- CalDAV calendar root for birthdays and tasks.
- Auth, CardDAV, CalDAV, Sync, and ACL plugins ([source](../monica-4.x/app/Providers/DAVServiceProvider.php#L74)).
