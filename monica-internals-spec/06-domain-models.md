# Domain Models And Relationships

This file maps Eloquent relationships. The database schema docs are the physical source of truth; this file shows how Monica navigates the data in application code.

## Tenant Boundary

Almost every user-owned table belongs to `accounts`. `Account` exposes `hasMany` relations for contacts, interactions, customization tables, import/export jobs, and audit logs. `User` belongs to one account and optionally points to a `me_contact_id` contact representing the user in their own address book.

## Important Patterns

- Public web routes bind `{contact}` through `IdHasher`, so UI URLs do not expose raw ids directly.
- `HasUuid` auto-fills UUIDs on models that use the trait; UUIDs were added in `2020_12_19_205923_add_uuids.php`.
- `Contact` uses `SoftDeletes` and also has `is_active`; archive and delete are separate lifecycle states.
- `Journalable` connects `activities`, `entries`, and `days` to `journal_entries` through a polymorphic relation.
- DAV uses `addressbooks`, contact `vcard`/`distant_etag`, and `synctoken` to emulate CardDAV/CalDAV sync.

## Relationship Inventory

| Model | Method | Relation | Target/options | Source |
|---|---|---|---|---|
| `App\Models\Account\Account` | `activities` | `hasMany` | `Activity::class` | [source](../monica-4.x/app/Models/Account/Account.php#L92) |
| `App\Models\Account\Account` | `allContacts` | `hasMany` | `Contact::class` | [source](../monica-4.x/app/Models/Account/Account.php#L102) |
| `App\Models\Account\Account` | `invitations` | `hasMany` | `Invitation::class` | [source](../monica-4.x/app/Models/Account/Account.php#L127) |
| `App\Models\Account\Account` | `debts` | `hasMany` | `Debt::class` | [source](../monica-4.x/app/Models/Account/Account.php#L137) |
| `App\Models\Account\Account` | `gifts` | `hasMany` | `Gift::class` | [source](../monica-4.x/app/Models/Account/Account.php#L147) |
| `App\Models\Account\Account` | `notes` | `hasMany` | `Note::class` | [source](../monica-4.x/app/Models/Account/Account.php#L157) |
| `App\Models\Account\Account` | `reminders` | `hasMany` | `Reminder::class` | [source](../monica-4.x/app/Models/Account/Account.php#L167) |
| `App\Models\Account\Account` | `reminderOutboxes` | `hasMany` | `ReminderOutbox::class` | [source](../monica-4.x/app/Models/Account/Account.php#L177) |
| `App\Models\Account\Account` | `tasks` | `hasMany` | `Task::class` | [source](../monica-4.x/app/Models/Account/Account.php#L187) |
| `App\Models\Account\Account` | `users` | `hasMany` | `User::class` | [source](../monica-4.x/app/Models/Account/Account.php#L197) |
| `App\Models\Account\Account` | `relationships` | `hasMany` | `Relationship::class` | [source](../monica-4.x/app/Models/Account/Account.php#L207) |
| `App\Models\Account\Account` | `activityStatistics` | `hasMany` | `ActivityStatistic::class` | [source](../monica-4.x/app/Models/Account/Account.php#L217) |
| `App\Models\Account\Account` | `activityTypes` | `hasMany` | `ActivityType::class` | [source](../monica-4.x/app/Models/Account/Account.php#L227) |
| `App\Models\Account\Account` | `activityTypeCategories` | `hasMany` | `ActivityTypeCategory::class` | [source](../monica-4.x/app/Models/Account/Account.php#L237) |
| `App\Models\Account\Account` | `entries` | `hasMany` | `Entry::class` | [source](../monica-4.x/app/Models/Account/Account.php#L247) |
| `App\Models\Account\Account` | `importjobs` | `hasMany` | `ImportJob::class` | [source](../monica-4.x/app/Models/Account/Account.php#L257) |
| `App\Models\Account\Account` | `importJobReports` | `hasMany` | `ImportJobReport::class` | [source](../monica-4.x/app/Models/Account/Account.php#L267) |
| `App\Models\Account\Account` | `tags` | `hasMany` | `Tag::class` | [source](../monica-4.x/app/Models/Account/Account.php#L277) |
| `App\Models\Account\Account` | `calls` | `hasMany` | `Call::class` | [source](../monica-4.x/app/Models/Account/Account.php#L287) |
| `App\Models\Account\Account` | `contactFieldTypes` | `hasMany` | `ContactFieldType::class` | [source](../monica-4.x/app/Models/Account/Account.php#L297) |
| `App\Models\Account\Account` | `contactFields` | `hasMany` | `ContactField::class` | [source](../monica-4.x/app/Models/Account/Account.php#L307) |
| `App\Models\Account\Account` | `journalEntries` | `hasMany` | `JournalEntry::class` | [source](../monica-4.x/app/Models/Account/Account.php#L317) |
| `App\Models\Account\Account` | `specialDates` | `hasMany` | `SpecialDate::class` | [source](../monica-4.x/app/Models/Account/Account.php#L327) |
| `App\Models\Account\Account` | `days` | `hasMany` | `Day::class` | [source](../monica-4.x/app/Models/Account/Account.php#L337) |
| `App\Models\Account\Account` | `genders` | `hasMany` | `Gender::class` | [source](../monica-4.x/app/Models/Account/Account.php#L347) |
| `App\Models\Account\Account` | `reminderRules` | `hasMany` | `ReminderRule::class` | [source](../monica-4.x/app/Models/Account/Account.php#L357) |
| `App\Models\Account\Account` | `relationshipTypes` | `hasMany` | `RelationshipType::class` | [source](../monica-4.x/app/Models/Account/Account.php#L367) |
| `App\Models\Account\Account` | `relationshipTypeGroups` | `hasMany` | `RelationshipTypeGroup::class` | [source](../monica-4.x/app/Models/Account/Account.php#L377) |
| `App\Models\Account\Account` | `modules` | `hasMany` | `Module::class` | [source](../monica-4.x/app/Models/Account/Account.php#L387) |
| `App\Models\Account\Account` | `conversations` | `hasMany` | `Conversation::class` | [source](../monica-4.x/app/Models/Account/Account.php#L397) |
| `App\Models\Account\Account` | `messages` | `hasMany` | `Message::class` | [source](../monica-4.x/app/Models/Account/Account.php#L407) |
| `App\Models\Account\Account` | `documents` | `hasMany` | `Document::class` | [source](../monica-4.x/app/Models/Account/Account.php#L417) |
| `App\Models\Account\Account` | `lifeEventCategories` | `hasMany` | `LifeEventCategory::class` | [source](../monica-4.x/app/Models/Account/Account.php#L427) |
| `App\Models\Account\Account` | `lifeEventTypes` | `hasMany` | `LifeEventType::class` | [source](../monica-4.x/app/Models/Account/Account.php#L437) |
| `App\Models\Account\Account` | `lifeEvents` | `hasMany` | `LifeEvent::class` | [source](../monica-4.x/app/Models/Account/Account.php#L447) |
| `App\Models\Account\Account` | `photos` | `hasMany` | `Photo::class` | [source](../monica-4.x/app/Models/Account/Account.php#L457) |
| `App\Models\Account\Account` | `weathers` | `hasMany` | `Weather::class` | [source](../monica-4.x/app/Models/Account/Account.php#L467) |
| `App\Models\Account\Account` | `places` | `hasMany` | `Place::class` | [source](../monica-4.x/app/Models/Account/Account.php#L477) |
| `App\Models\Account\Account` | `addresses` | `hasMany` | `Address::class` | [source](../monica-4.x/app/Models/Account/Account.php#L487) |
| `App\Models\Account\Account` | `addressBooks` | `hasMany` | `AddressBook::class` | [source](../monica-4.x/app/Models/Account/Account.php#L497) |
| `App\Models\Account\Account` | `addressBookSubscriptions` | `hasMany` | `AddressBookSubscription::class` | [source](../monica-4.x/app/Models/Account/Account.php#L507) |
| `App\Models\Account\Account` | `companies` | `hasMany` | `Company::class` | [source](../monica-4.x/app/Models/Account/Account.php#L517) |
| `App\Models\Account\Account` | `occupations` | `hasMany` | `Occupation::class` | [source](../monica-4.x/app/Models/Account/Account.php#L527) |
| `App\Models\Account\Account` | `auditLogs` | `hasMany` | `AuditLog::class` | [source](../monica-4.x/app/Models/Account/Account.php#L537) |
| `App\Models\Account\Activity` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/Activity.php#L61) |
| `App\Models\Account\Activity` | `contacts` | `belongsToMany` | `Contact::class` | [source](../monica-4.x/app/Models/Account/Activity.php#L71) |
| `App\Models\Account\Activity` | `type` | `belongsTo` | `ActivityType::class, 'activity_type_id'` | [source](../monica-4.x/app/Models/Account/Activity.php#L81) |
| `App\Models\Account\Activity` | `journalEntries` | `morphMany` | `JournalEntry::class, 'journalable'` | [source](../monica-4.x/app/Models/Account/Activity.php#L89) |
| `App\Models\Account\Activity` | `emotions` | `belongsToMany` | `Emotion::class, 'emotion_activity', 'activity_id', 'emotion_id'` | [source](../monica-4.x/app/Models/Account/Activity.php#L99) |
| `App\Models\Account\ActivityStatistic` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/ActivityStatistic.php#L27) |
| `App\Models\Account\ActivityStatistic` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Account/ActivityStatistic.php#L35) |
| `App\Models\Account\ActivityType` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/ActivityType.php#L33) |
| `App\Models\Account\ActivityType` | `category` | `belongsTo` | `ActivityTypeCategory::class, 'activity_type_category_id'` | [source](../monica-4.x/app/Models/Account/ActivityType.php#L43) |
| `App\Models\Account\ActivityType` | `activities` | `hasMany` | `Activity::class` | [source](../monica-4.x/app/Models/Account/ActivityType.php#L53) |
| `App\Models\Account\ActivityTypeCategory` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/ActivityTypeCategory.php#L34) |
| `App\Models\Account\ActivityTypeCategory` | `activityTypes` | `hasMany` | `ActivityType::class` | [source](../monica-4.x/app/Models/Account/ActivityTypeCategory.php#L44) |
| `App\Models\Account\AddressBook` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/AddressBook.php#L51) |
| `App\Models\Account\AddressBook` | `user` | `belongsTo` | `User::class` | [source](../monica-4.x/app/Models/Account/AddressBook.php#L61) |
| `App\Models\Account\AddressBook` | `contacts` | `hasMany` | `Contact::class` | [source](../monica-4.x/app/Models/Account/AddressBook.php#L71) |
| `App\Models\Account\AddressBookSubscription` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/AddressBookSubscription.php#L84) |
| `App\Models\Account\AddressBookSubscription` | `user` | `belongsTo` | `User::class` | [source](../monica-4.x/app/Models/Account/AddressBookSubscription.php#L94) |
| `App\Models\Account\AddressBookSubscription` | `addressBook` | `belongsTo` | `AddressBook::class` | [source](../monica-4.x/app/Models/Account/AddressBookSubscription.php#L104) |
| `App\Models\Account\Company` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/Company.php#L39) |
| `App\Models\Account\Company` | `occupations` | `hasMany` | `Occupation::class` | [source](../monica-4.x/app/Models/Account/Company.php#L49) |
| `App\Models\Account\ExportJob` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/ExportJob.php#L74) |
| `App\Models\Account\ExportJob` | `user` | `belongsTo` | `User::class` | [source](../monica-4.x/app/Models/Account/ExportJob.php#L84) |
| `App\Models\Account\ImportJob` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/ImportJob.php#L75) |
| `App\Models\Account\ImportJob` | `user` | `belongsTo` | `User::class` | [source](../monica-4.x/app/Models/Account/ImportJob.php#L85) |
| `App\Models\Account\ImportJob` | `importJobReports` | `hasMany` | `ImportJobReport::class` | [source](../monica-4.x/app/Models/Account/ImportJob.php#L95) |
| `App\Models\Account\ImportJobReport` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/ImportJobReport.php#L35) |
| `App\Models\Account\ImportJobReport` | `user` | `belongsTo` | `User::class` | [source](../monica-4.x/app/Models/Account/ImportJobReport.php#L45) |
| `App\Models\Account\ImportJobReport` | `importJob` | `belongsTo` | `ImportJob::class` | [source](../monica-4.x/app/Models/Account/ImportJobReport.php#L55) |
| `App\Models\Account\Invitation` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/Invitation.php#L31) |
| `App\Models\Account\Invitation` | `invitedBy` | `belongsTo` | `User::class, 'invited_by_user_id'` | [source](../monica-4.x/app/Models/Account/Invitation.php#L41) |
| `App\Models\Account\Photo` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/Photo.php#L38) |
| `App\Models\Account\Photo` | `contacts` | `belongsToMany` | `Contact::class` | [source](../monica-4.x/app/Models/Account/Photo.php#L48) |
| `App\Models\Account\Place` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/Place.php#L38) |
| `App\Models\Account\Place` | `weathers` | `hasMany` | `Weather::class` | [source](../monica-4.x/app/Models/Account/Place.php#L48) |
| `App\Models\Account\Weather` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Account/Weather.php#L48) |
| `App\Models\Account\Weather` | `place` | `belongsTo` | `Place::class` | [source](../monica-4.x/app/Models/Account/Weather.php#L58) |
| `App\Models\Contact\Address` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Address.php#L42) |
| `App\Models\Contact\Address` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Address.php#L52) |
| `App\Models\Contact\Address` | `place` | `belongsTo` | `Place::class` | [source](../monica-4.x/app/Models/Contact/Address.php#L62) |
| `App\Models\Contact\Address` | `labels` | `belongsToMany` | `ContactFieldLabel::class` | [source](../monica-4.x/app/Models/Contact/Address.php#L72) |
| `App\Models\Contact\Call` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Call.php#L55) |
| `App\Models\Contact\Call` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Call.php#L65) |
| `App\Models\Contact\Call` | `emotions` | `belongsToMany` | `Emotion::class, 'emotion_call', 'call_id', 'emotion_id'` | [source](../monica-4.x/app/Models/Contact/Call.php#L75) |
| `App\Models\Contact\Contact` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L176) |
| `App\Models\Contact\Contact` | `addressBook` | `belongsTo` | `AddressBook::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L186) |
| `App\Models\Contact\Contact` | `gender` | `belongsTo` | `Gender::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L214) |
| `App\Models\Contact\Contact` | `activities` | `belongsToMany` | `Activity::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L224) |
| `App\Models\Contact\Contact` | `activityStatistics` | `hasMany` | `ActivityStatistic::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L234) |
| `App\Models\Contact\Contact` | `debts` | `hasMany` | `Debt::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L244) |
| `App\Models\Contact\Contact` | `gifts` | `hasMany` | `Gift::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L254) |
| `App\Models\Contact\Contact` | `notes` | `hasMany` | `Note::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L264) |
| `App\Models\Contact\Contact` | `reminders` | `hasMany` | `Reminder::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L274) |
| `App\Models\Contact\Contact` | `tasks` | `hasMany` | `Task::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L284) |
| `App\Models\Contact\Contact` | `tags` | `belongsToMany` | `Tag::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L294) |
| `App\Models\Contact\Contact` | `calls` | `hasMany` | `Call::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L304) |
| `App\Models\Contact\Contact` | `entries` | `hasMany` | `Entry::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L314) |
| `App\Models\Contact\Contact` | `relationships` | `hasMany` | `Relationship::class, 'contact_is'` | [source](../monica-4.x/app/Models/Contact/Contact.php#L324) |
| `App\Models\Contact\Contact` | `contactFields` | `hasMany` | `ContactField::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L334) |
| `App\Models\Contact\Contact` | `addresses` | `hasMany` | `Address::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L344) |
| `App\Models\Contact\Contact` | `pets` | `hasMany` | `Pet::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L354) |
| `App\Models\Contact\Contact` | `specialDates` | `hasMany` | `SpecialDate::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L364) |
| `App\Models\Contact\Contact` | `birthdate` | `hasOne` | `SpecialDate::class, 'id', 'birthday_special_date_id'` | [source](../monica-4.x/app/Models/Contact/Contact.php#L374) |
| `App\Models\Contact\Contact` | `deceasedDate` | `hasOne` | `SpecialDate::class, 'id', 'deceased_special_date_id'` | [source](../monica-4.x/app/Models/Contact/Contact.php#L384) |
| `App\Models\Contact\Contact` | `firstMetDate` | `hasOne` | `SpecialDate::class, 'id', 'first_met_special_date_id'` | [source](../monica-4.x/app/Models/Contact/Contact.php#L394) |
| `App\Models\Contact\Contact` | `conversations` | `hasMany` | `Conversation::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L404) |
| `App\Models\Contact\Contact` | `messages` | `hasMany` | `Message::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L414) |
| `App\Models\Contact\Contact` | `documents` | `hasMany` | `Document::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L424) |
| `App\Models\Contact\Contact` | `photos` | `belongsToMany` | `Photo::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L434) |
| `App\Models\Contact\Contact` | `lifeEvents` | `hasMany` | `LifeEvent::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L444) |
| `App\Models\Contact\Contact` | `occupations` | `hasMany` | `Occupation::class` | [source](../monica-4.x/app/Models/Contact/Contact.php#L454) |
| `App\Models\Contact\Contact` | `avatarPhoto` | `hasOne` | `Photo::class, 'id', 'avatar_photo_id'` | [source](../monica-4.x/app/Models/Contact/Contact.php#L464) |
| `App\Models\Contact\Contact` | `logs` | `hasMany` | `AuditLog::class, 'about_contact_id', 'id'` | [source](../monica-4.x/app/Models/Contact/Contact.php#L474) |
| `App\Models\Contact\ContactField` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/ContactField.php#L35) |
| `App\Models\Contact\ContactField` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/ContactField.php#L45) |
| `App\Models\Contact\ContactField` | `labels` | `belongsToMany` | `ContactFieldLabel::class` | [source](../monica-4.x/app/Models/Contact/ContactField.php#L55) |
| `App\Models\Contact\ContactField` | `contactFieldType` | `belongsTo` | `ContactFieldType::class` | [source](../monica-4.x/app/Models/Contact/ContactField.php#L65) |
| `App\Models\Contact\ContactFieldLabel` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/ContactFieldLabel.php#L40) |
| `App\Models\Contact\ContactFieldType` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/ContactFieldType.php#L52) |
| `App\Models\Contact\ContactFieldType` | `conversations` | `hasMany` | `Conversation::class` | [source](../monica-4.x/app/Models/Contact/ContactFieldType.php#L62) |
| `App\Models\Contact\Conversation` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Conversation.php#L34) |
| `App\Models\Contact\Conversation` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Conversation.php#L44) |
| `App\Models\Contact\Conversation` | `contactFieldType` | `belongsTo` | `ContactFieldType::class` | [source](../monica-4.x/app/Models/Contact/Conversation.php#L54) |
| `App\Models\Contact\Conversation` | `messages` | `hasMany` | `Message::class` | [source](../monica-4.x/app/Models/Contact/Conversation.php#L64) |
| `App\Models\Contact\Debt` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Debt.php#L46) |
| `App\Models\Contact\Debt` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Debt.php#L56) |
| `App\Models\Contact\Debt` | `currency` | `belongsTo` | `Currency::class` | [source](../monica-4.x/app/Models/Contact/Debt.php#L66) |
| `App\Models\Contact\Document` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Document.php#L45) |
| `App\Models\Contact\Document` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Document.php#L55) |
| `App\Models\Contact\Gender` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Gender.php#L75) |
| `App\Models\Contact\Gender` | `contacts` | `hasMany` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Gender.php#L85) |
| `App\Models\Contact\Gift` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Gift.php#L60) |
| `App\Models\Contact\Gift` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Gift.php#L70) |
| `App\Models\Contact\Gift` | `recipient` | `hasOne` | `Contact::class, 'id', 'is_for'` | [source](../monica-4.x/app/Models/Contact/Gift.php#L80) |
| `App\Models\Contact\Gift` | `photos` | `belongsToMany` | `Photo::class` | [source](../monica-4.x/app/Models/Contact/Gift.php#L90) |
| `App\Models\Contact\LifeEvent` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/LifeEvent.php#L62) |
| `App\Models\Contact\LifeEvent` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/LifeEvent.php#L72) |
| `App\Models\Contact\LifeEvent` | `lifeEventType` | `belongsTo` | `LifeEventType::class, 'life_event_type_id'` | [source](../monica-4.x/app/Models/Contact/LifeEvent.php#L82) |
| `App\Models\Contact\LifeEvent` | `reminder` | `belongsTo` | `Reminder::class` | [source](../monica-4.x/app/Models/Contact/LifeEvent.php#L92) |
| `App\Models\Contact\LifeEventCategory` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/LifeEventCategory.php#L43) |
| `App\Models\Contact\LifeEventCategory` | `lifeEventTypes` | `hasMany` | `LifeEventType::class` | [source](../monica-4.x/app/Models/Contact/LifeEventCategory.php#L53) |
| `App\Models\Contact\LifeEventType` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/LifeEventType.php#L44) |
| `App\Models\Contact\LifeEventType` | `lifeEventCategory` | `belongsTo` | `LifeEventCategory::class, 'life_event_category_id'` | [source](../monica-4.x/app/Models/Contact/LifeEventType.php#L54) |
| `App\Models\Contact\LifeEventType` | `lifeEvents` | `hasMany` | `LifeEvent::class` | [source](../monica-4.x/app/Models/Contact/LifeEventType.php#L64) |
| `App\Models\Contact\Message` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Message.php#L42) |
| `App\Models\Contact\Message` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Message.php#L52) |
| `App\Models\Contact\Message` | `conversation` | `belongsTo` | `Conversation::class` | [source](../monica-4.x/app/Models/Contact/Message.php#L62) |
| `App\Models\Contact\Note` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Note.php#L69) |
| `App\Models\Contact\Note` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Note.php#L79) |
| `App\Models\Contact\Occupation` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Occupation.php#L63) |
| `App\Models\Contact\Occupation` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Occupation.php#L73) |
| `App\Models\Contact\Occupation` | `company` | `belongsTo` | `Company::class` | [source](../monica-4.x/app/Models/Contact/Occupation.php#L83) |
| `App\Models\Contact\Pet` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Pet.php#L26) |
| `App\Models\Contact\Pet` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Pet.php#L36) |
| `App\Models\Contact\Pet` | `petCategory` | `belongsTo` | `PetCategory::class` | [source](../monica-4.x/app/Models/Contact/Pet.php#L46) |
| `App\Models\Contact\Reminder` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Reminder.php#L59) |
| `App\Models\Contact\Reminder` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Reminder.php#L69) |
| `App\Models\Contact\Reminder` | `reminderOutboxes` | `hasMany` | `ReminderOutbox::class` | [source](../monica-4.x/app/Models/Contact/Reminder.php#L79) |
| `App\Models\Contact\ReminderOutbox` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/ReminderOutbox.php#L47) |
| `App\Models\Contact\ReminderOutbox` | `reminder` | `belongsTo` | `Reminder::class` | [source](../monica-4.x/app/Models/Contact/ReminderOutbox.php#L57) |
| `App\Models\Contact\ReminderOutbox` | `user` | `belongsTo` | `User::class` | [source](../monica-4.x/app/Models/Contact/ReminderOutbox.php#L67) |
| `App\Models\Contact\ReminderRule` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/ReminderRule.php#L34) |
| `App\Models\Contact\Tag` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Tag.php#L32) |
| `App\Models\Contact\Tag` | `contacts` | `belongsToMany` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Tag.php#L40) |
| `App\Models\Contact\Task` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Contact/Task.php#L65) |
| `App\Models\Contact\Task` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Contact/Task.php#L75) |
| `App\Models\Instance\AuditLog` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Instance/AuditLog.php#L55) |
| `App\Models\Instance\AuditLog` | `author` | `belongsTo` | `User::class` | [source](../monica-4.x/app/Models/Instance/AuditLog.php#L65) |
| `App\Models\Instance\AuditLog` | `contact` | `belongsTo` | `Contact::class, 'about_contact_id'` | [source](../monica-4.x/app/Models/Instance/AuditLog.php#L75) |
| `App\Models\Instance\Emotion\Emotion` | `primary` | `belongsTo` | `PrimaryEmotion::class, 'emotion_primary_id'` | [source](../monica-4.x/app/Models/Instance/Emotion/Emotion.php#L33) |
| `App\Models\Instance\Emotion\Emotion` | `secondary` | `belongsTo` | `SecondaryEmotion::class, 'emotion_secondary_id'` | [source](../monica-4.x/app/Models/Instance/Emotion/Emotion.php#L43) |
| `App\Models\Instance\Emotion\Emotion` | `calls` | `belongsToMany` | `Call::class, 'emotion_call', 'emotion_id', 'call_id'` | [source](../monica-4.x/app/Models/Instance/Emotion/Emotion.php#L53) |
| `App\Models\Instance\Emotion\Emotion` | `activities` | `belongsToMany` | `Activity::class, 'emotion_activity', 'emotion_id', 'activity_id'` | [source](../monica-4.x/app/Models/Instance/Emotion/Emotion.php#L65) |
| `App\Models\Instance\Emotion\PrimaryEmotion` | `emotions` | `hasMany` | `Emotion::class, 'emotion_primary_id'` | [source](../monica-4.x/app/Models/Instance/Emotion/PrimaryEmotion.php#L30) |
| `App\Models\Instance\Emotion\PrimaryEmotion` | `secondaries` | `hasMany` | `SecondaryEmotion::class, 'emotion_primary_id'` | [source](../monica-4.x/app/Models/Instance/Emotion/PrimaryEmotion.php#L40) |
| `App\Models\Instance\Emotion\SecondaryEmotion` | `primary` | `belongsTo` | `PrimaryEmotion::class, 'emotion_primary_id'` | [source](../monica-4.x/app/Models/Instance/Emotion/SecondaryEmotion.php#L31) |
| `App\Models\Instance\Emotion\SecondaryEmotion` | `emotions` | `hasMany` | `Emotion::class` | [source](../monica-4.x/app/Models/Instance/Emotion/SecondaryEmotion.php#L41) |
| `App\Models\Instance\SpecialDate` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Instance/SpecialDate.php#L85) |
| `App\Models\Instance\SpecialDate` | `contact` | `belongsTo` | `Contact::class` | [source](../monica-4.x/app/Models/Instance/SpecialDate.php#L95) |
| `App\Models\Journal\Day` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Journal/Day.php#L30) |
| `App\Models\Journal\Entry` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Journal/Entry.php#L45) |
| `App\Models\Journal\JournalEntry` | `journalable` | `morphTo` | `` | [source](../monica-4.x/app/Models/Journal/JournalEntry.php#L50) |
| `App\Models\Journal\JournalEntry` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Journal/JournalEntry.php#L60) |
| `App\Models\Relationship\Relationship` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Relationship/Relationship.php#L45) |
| `App\Models\Relationship\Relationship` | `contactIs` | `belongsTo` | `Contact::class, 'contact_is'` | [source](../monica-4.x/app/Models/Relationship/Relationship.php#L55) |
| `App\Models\Relationship\Relationship` | `ofContact` | `belongsTo` | `Contact::class, 'of_contact'` | [source](../monica-4.x/app/Models/Relationship/Relationship.php#L65) |
| `App\Models\Relationship\Relationship` | `relationshipType` | `belongsTo` | `RelationshipType::class, 'relationship_type_id'` | [source](../monica-4.x/app/Models/Relationship/Relationship.php#L75) |
| `App\Models\Relationship\RelationshipType` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Relationship/RelationshipType.php#L37) |
| `App\Models\Relationship\RelationshipType` | `relationshipTypeGroup` | `belongsTo` | `RelationshipTypeGroup::class` | [source](../monica-4.x/app/Models/Relationship/RelationshipType.php#L47) |
| `App\Models\Relationship\RelationshipTypeGroup` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/Relationship/RelationshipTypeGroup.php#L34) |
| `App\Models\Settings\Term` | `users` | `belongsToMany` | `User::class` | [source](../monica-4.x/app/Models/Settings/Term.php#L20) |
| `App\Models\User\Changelog` | `users` | `belongsToMany` | `User::class` | [source](../monica-4.x/app/Models/User/Changelog.php#L30) |
| `App\Models\User\Module` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/User/Module.php#L37) |
| `App\Models\User\User` | `account` | `belongsTo` | `Account::class` | [source](../monica-4.x/app/Models/User/User.php#L102) |
| `App\Models\User\User` | `me` | `hasOne` | `Contact::class, 'id', 'me_contact_id'` | [source](../monica-4.x/app/Models/User/User.php#L112) |
| `App\Models\User\User` | `terms` | `belongsToMany` | `Term::class` | [source](../monica-4.x/app/Models/User/User.php#L122) |
| `App\Models\User\User` | `recoveryCodes` | `hasMany` | `RecoveryCode::class` | [source](../monica-4.x/app/Models/User/User.php#L132) |
| `App\Models\User\User` | `currency` | `belongsTo` | `Currency::class` | [source](../monica-4.x/app/Models/User/User.php#L142) |