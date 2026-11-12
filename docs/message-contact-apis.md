# Where contact, student and parent details come from

The client does not call a parent-specific endpoint. Parent and student names arrive from the
same three message/contact responses the mobile site uses, and the client removes parents
before showing or saving anything. This note lists the endpoints and fields so that filtering
is easy to audit.

Every request below goes to the school's own API host, discovered at sign-in from
`https://<school>.daymap.net/daymap/dws/discover.ashx` (the `api` field), with:

- `Authorization: Bearer <access token>`
- `DaymapClientId: <client id>` (`ApiClient` requests only)
- `api-version=3.0` (`ApiClient` requests only; the portal paths do not take it)

## 1. Directory search — `contacts/find`

Used by `messages::search_contacts` (when a term is typed) and `messages::directory_people`
(empty filter, full directory during mailbox sync). This is the same endpoint the Daymap
website uses for recipient search, and the only one that reliably contains staff.

```text
GET {api_base}/contacts/find?filter=<term>&api-version=3.0
```

The response array is read from `Contacts`, `contacts`, `Results`, `results`, `Items` or
`items`. Each entry is normalised by `normalize_person` in `src-tauri/src/messages.rs`:

| Field | Keys read |
| --- | --- |
| id | `ContactID`, `ContactId`, `contactID`, `contactId`, `PersonID`, `PersonId`, `personID`, `personId`, `ID`, `Id`, `id` |
| name | `DisplaynameSurname`, `DisplayNameSurname`, else `Firstname` + `Surname`, else `Displayname`, `DisplayName`, `Name` |
| type | `ContactType`, `PersonType`, `Type`, `ContactTypeName`, `PersonTypeName` |

## 2. Message thread participants — `/lms/api/coms/message/{id}/thread`

Used by `messages::load_recipients` for the People list and to record who a thread included.
This is where student and parent names come from when the directory result is staff-only:
thread participants can be anyone the message was sent to.

```text
GET {api_base}/lms/api/coms/message/{messageId}/thread
```

The response is a list of messages (`Messages`, `messages`, `Items`, `items`). Each message may
carry a recipient array under `Recipients`, `recipients`, `People`, `people`, `Contacts` or
`contacts`, and each entry is normalised exactly like a directory entry.

## 3. Mailbox listings — `/lms/api/coms/folders` and `/lms/api/coms/folder/{id}`

Used by `messages::load_folders` and `messages::load_folder_pages`; the dashboard's
`messages/folder` call returns the same message shape.

```text
GET {api_base}/lms/api/coms/folders
GET {api_base}/lms/api/coms/folder/{folderId}?page=<n>&msgsPerPage=100
```

Per-message fields read by `api::normalize_messages`: `MessageID`/`ID`, `Subject`, `Text`,
`SenderName`, `SentOn`, `ThreadCount`, `HasAttachments`, `Read`, `SentTo`, `Priority`.
`SenderName` and `SentTo` are Daymap's own free text, not contact records.

## How a person gets a type label

`person_type_label_from` in `messages.rs` maps the API value to the label used by the UI and
by the parent filter:

| API value | Label |
| --- | --- |
| numeric `ContactType` / `PersonType` / `Type` = 1 | Staff |
| = 2 | Student |
| = 3 | Parent |
| any other numeric code | Contact |
| text containing `student` | Student |
| text containing `parent` | Parent |
| text containing `staff` or `teacher` | Staff |
| anything else | Contact |

## What the client keeps

- `cache::retain_visible` drops every entry where `MessagePerson::is_parent` is true, both
  when contact data is written and when the cache is read back.
- `auth::search_contacts` applies the same filter to the `contacts/find` response, so a parent
  never appears as a recipient suggestion even with contact caching off.
- `auth::load_message_recipients` filters thread participants, so the People list and the
  recipient names recorded in the cache contain staff and students only.
- `offline-cache.json` therefore stores only staff/student entries under `people` and
  `thread_people`; existing parent entries are removed the next time the cache is read or the
  contact switch is changed.
- Message subjects, bodies and the `SenderName`/`SentTo` text are not filtered: a parent can
  still be named inside a message's own content.

## Caveat

These keys are what the client reads, not a published Daymap contract. If a school returns
different field names, `person_type_label_from` falls back to `Contact`; unclassified entries
are kept (only explicit `Parent` entries are removed) so a differently coded directory does
not become empty. A parent misclassified as `Contact` would not be filtered.
