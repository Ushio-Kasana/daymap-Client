# Changelog

All notable changes to Daymap Client are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/).

## [0.1.8] - 2026-11-12

### Added

- Settings has **Cache content** and **Cache contacts** switches. With content caching off,
  the dashboard, timetable, tasks, messages, class notes and assignment details are no longer
  saved on this computer. Contact caching is off by default, so recipient search asks Daymap
  on every search the way the Daymap website does instead of showing everyone already saved;
  turning it on saves staff and student names. Turning a switch off also deletes the data it
  covered from the saved copy.
- Timetable lessons now list the files a teacher attached. Choosing one asks where to save it,
  downloads it through Daymap instead of opening a browser and needing an EdPass login again,
  shows progress on the lesson, and finishes with a popup offering **Open file**, **Show in
  folder** or **Close**. Daymap file links in a lesson's text download the same way.

### Changed

- Desktop builds now cover seven targets: macOS Apple silicon and Intel, Windows x64, ARM64
  and 32-bit, and Linux x86_64 and ARM64. The in-app update check reads the computer's
  architecture and only offers the installer built for it.

## [0.1.7] - 2026-11-11

### Added

- macOS update downloads now show a warning before the installer downloads, explaining
  that macOS may ask for the login keychain password and to choose **Always Allow**.
- Classes are now clickable in the overview and timetable, and the class label on a task
  opens a class overview. It shows the class code, subject, teacher and room, an overall
  attendance percentage instead of a status on every lesson, and the class's assessment
  tasks.
- The newest class note opens expanded, with the files the teacher attached to that lesson
  listed underneath and downloadable from there. Older notes keep their own files and sit
  behind an **Other notes and files** toggle, so lessons without either aren't listed at
  all.
- Class overviews and the notes opened in them are saved in the offline cache, so a class
  opened while online still opens when Daymap can't be reached, marked **Offline** with the
  time it was saved.
- A class's newest notes are now fetched and cached in the background when the class
  overview opens, so they can be read offline without opening each note first.
- A finished task now shows the released result: the mark out of the task's maximum and
  any letter grade, next to the plagiarism check's similarity percentage. When Daymap
  includes the full report, a button opens it in the browser, and files Daymap attaches to
  the submission as results are listed under **Results**.
- A mark Daymap hasn't released yet no longer appears as `-1`, as if it were a real mark;
  the result says **Not released yet** instead.

### Changed

- Background caching of class notes and mail now retries a temporary failure a few times
  before giving up, so a dropped connection no longer leaves notes or messages out of the
  offline cache. Rejected requests and missing data are not retried.

## [0.1.6] - 2026-11-10

### Fixed

- Windows sign-in no longer deadlocks while opening the Daymap/EdPass window.

## [0.1.5] - 2026-11-10

This release includes the 0.1.4 timetable, offline-cache, loading-state and Touch ID
changes.

### Added

- A new open-book app icon with a blue-to-violet gradient. The 1024 px source artwork
  fills the icon canvas and is kept in `src-tauri/icons/app-icon.png`.
- Settings now has **Clear keychain and cache**, with a confirmation step, to
  sign out and remove both the saved keychain session and all offline data.
- Overdue-work controls. Settings can mute overdue work for a class, including a
  class you no longer take, and an assignment can be marked as not overdue from
  its task page. These overrides are account-scoped, stored only on this computer,
  and excluded from the overdue badge, overview and task filters.

### Changed

- All bundled platform icons were regenerated from the new artwork.
- Desktop builds are now manual-only. Branch and tag pushes no longer start a build;
  dispatch **Build desktop apps** from `main` when ready.

### Security

- Pinned the upstream `glib` 0.18 backport for Tauri's Linux GTK3 stack, fixing the
  `VariantStrIter` soundness issue (GHSA-wrw7-89jp-8q8g) while Tauri 2 remains on GTK3.

### Fixed

- HTML entities in message and notice bodies now display as their intended characters.
- Wrapped message and notice text now hyphenates broken words so continuation is visible.
- Message subjects now wrap to two lines in the list, and full available subjects and
  previews are exposed in tooltips.
- Future and not-yet-started lessons no longer show a stale attendance status such as
  **Late**. Attendance is only shown after the lesson has started.

## [0.1.4] - 2026-11-10

### Added

- Timetable history: the day strip shows the whole selected week, with previous
  and next week buttons, so days that have already passed can be viewed again.
- Past and future timetable weeks load on demand, with a full-page loading
  state and an inline loading bar when part of the week is already on screen.
- Timetable weeks are cached on disk. The previous, current and upcoming weeks
  open instantly and stay available without a connection.
- Assignment details, resources and submitted work are cached the first time a
  task is opened, so previously opened tasks work offline.
- Settings now has **Clear offline data**, with a confirmation step.
- An “Obtaining the latest from Daymap…” notice, and section placeholders, while
  fresh data loads in the background.
- On macOS, reopening a saved session asks for Touch ID when biometrics are
  enrolled, with the login password available as the system fallback. This can
  be turned off in Settings; it is on by default.

### Changed

- Signing in or restoring a session now shows the saved dashboard immediately,
  then refreshes in the background instead of waiting on the network first.
- A failed timetable week or assignment request now falls back to the cached
  copy instead of showing an empty view.

### Fixed

- The timetable no longer hides days before today, or reports a past week as
  empty while it is still loading.
- macOS builds now keep a stable code signature across updates, so the
  saved-session keychain item can be allowed once instead of macOS treating each
  build as a new app.

## [0.1.3] - 2026-11-10

### Added

- Day and Week timetable views. Week view hides Saturday and Sunday when they
  have no lessons.
- A week picker with selectable ranges such as `9 Nov – 15 Nov`; choosing a
  range updates the displayed week.
- Room, teacher and substitute teacher details on each timetable lesson.
- In-app update checks against the latest GitHub release, with a download link for the matching installer.
- In-app update downloads with a progress bar, saving the installer to Downloads and verifying GitHub's SHA-256 asset digest when one is provided.
- Platform-specific install hand-off: macOS opens the DMG and quits Daymap so the app can be dragged into Applications; Windows and Linux open their respective installers and quit so the package can replace the app.
- In-app instructions explaining the installer hand-off, including the macOS Downloads-folder permission prompt, and what to do after Daymap quits.

### Changed

- The timetable no longer shows the `Class Lessons` placeholder or empty
  weekend columns.
- Week mode uses range chips instead of individual day chips; Day mode keeps
  the existing day strip.
- After navigating to another week, the Day strip follows that week so the
  selected day stays visible.
- Desktop builds now run automatically on pushes to `main`; tagged builds still publish installers to GitHub releases.
- GitHub releases now use the matching `CHANGELOG.md` section as their release body.
- Release builds now publish installers to GitHub releases; updates are downloaded inside Daymap, then handed to the operating system.
- Downloaded installers are saved to Downloads. Daymap opens the installer and quits instead of restarting automatically, so the user can complete the platform installer flow.
- macOS DMGs now use a compact drag-to-Applications window with a custom arrow background and larger app icons.

### Security

- Added a privacy gate that scans staged files and history for credentials,
  personal details and local school or class identifiers. CI runs the same scan
  on every push.
- Update downloads are restricted to Daymap's GitHub release assets and checked against GitHub's SHA-256 digest when available. There is no separate app-level update signature; only releases published from this repository should be installed.

## [0.1.2] - 2026-11-10

### Added

- Cross-platform installers for macOS, Windows and Linux.
- File attachments in messages.

### Changed

- Refreshed the README for cross-platform builds and bumped the app to 0.1.2.

### Fixed

- Assignment details now read the portal's task payload, so resources and the
  upload control are populated correctly.

[Unreleased]: https://github.com/Ushio-Kasana/daymap-Client/compare/v0.1.8...HEAD
[0.1.8]: https://github.com/Ushio-Kasana/daymap-Client/releases/tag/v0.1.8
[0.1.7]: https://github.com/Ushio-Kasana/daymap-Client/releases/tag/v0.1.7
[0.1.6]: https://github.com/Ushio-Kasana/daymap-Client/releases/tag/v0.1.6
[0.1.5]: https://github.com/Ushio-Kasana/daymap-Client/releases/tag/v0.1.5
[0.1.4]: https://github.com/Ushio-Kasana/daymap-Client/releases/tag/v0.1.4
[0.1.3]: https://github.com/Ushio-Kasana/daymap-Client/releases/tag/v0.1.3
[0.1.2]: https://github.com/Ushio-Kasana/daymap-Client/releases/tag/v0.1.2
