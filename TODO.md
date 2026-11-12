# Daymap Client — TODO

Working list of reported bugs, platform work and planned features. When an item is
finished, add it to `CHANGELOG.md` under `[Unreleased]` and tick it off here.

## Reported bugs

- [x] **Wrapped message and notice text doesn't show where it continues.** When a long
  message or notice wraps onto a new line, add the `-` continuation marker in the same way
  normal text wrapping does, so the text visibly continues instead of looking cut off.
- [x] **Future lessons show "Late".** Every lesson that hasn't happened yet shows the
  "Late" attendance pill. Future lessons should show no attendance status; only display a
  status that Daymap actually reports.
- [x] **HTML entities appear literally in messages.** Bodies render entities such as
  `&#39;` instead of the character they represent. Decode entities when showing message
  and notice text.
- [x] **Message subjects and previews are cut off mid-word.** Long subjects end part-way
  through a word, hiding the rest of the subject. Show the full subject, or truncate
  cleanly while keeping the full text available (for example in a tooltip).
- [ ] **Linux tiling window managers.** Investigate reports that Arch with Hyprland (and
  similar tiling compositors) can break the app's UI and layout. Check window sizing,
  scale factors and WebKitGTK rendering.

## Builds and platform support

- [x] Add **Intel macOS** (`x86_64-apple-darwin`) to the release matrix alongside Apple
  silicon.
- [x] Add **ARM64 Windows** (`aarch64-pc-windows-msvc`).
- [x] Add **32-bit Windows** (`i686-pc-windows-msvc`).
- [x] Add **ARM64 Linux** (`aarch64-unknown-linux-gnu`) alongside the existing x86_64
  Linux builds.
- [x] Update the build workflow, installer naming, README download table and update
  download labels for the expanded matrix.

## Features

- [x] **Class notes and class overview.** Make classes clickable to open a class overview,
  including class notes.
- [x] **Assignment results.** Show released results and marks for completed assignments,
  alongside the plagiarism check's similarity percentage and a link to the full report.
- [x] **Download timetable assignment files in the client.** Clicking an assignment file in
  the timetable currently opens an external browser and can require an EdPass login. Download
  it through Daymap instead, with a progress bar. When it finishes, show a popup with options
  to open the downloaded file or its folder, plus a close button.
- [ ] Per-sender colour customisation for messages, so messages from specific people can
  be colour-tagged.
- [ ] Colour customisation for assignments.
- [ ] A custom local display name in Settings that overrides the name Daymap returns.
- [ ] Show the account's Daymap profile image in place of the initials, with a Settings toggle
  to enable or disable it. When disabled, use initials and do not fetch or cache the image.
- [ ] Locally stored custom profiles in the client.
- [x] Overdue-work management: mute overdue notifications for a specific class
  (including classes the user is no longer in) and mark assignments as not
  overdue, so false positives such as written Maths and English work can be
  corrected locally.
