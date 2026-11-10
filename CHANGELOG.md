# Changelog

All notable changes to Daymap Client are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/Ushio-Kasana/daymap-Client/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/Ushio-Kasana/daymap-Client/releases/tag/v0.1.2
