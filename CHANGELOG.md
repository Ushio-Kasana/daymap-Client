# Changelog

All notable changes to Daymap Client are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/Ushio-Kasana/daymap-Client/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/Ushio-Kasana/daymap-Client/releases/tag/v0.1.4
[0.1.3]: https://github.com/Ushio-Kasana/daymap-Client/releases/tag/v0.1.3
[0.1.2]: https://github.com/Ushio-Kasana/daymap-Client/releases/tag/v0.1.2
