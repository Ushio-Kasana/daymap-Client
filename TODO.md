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

- [ ] Add **Intel macOS** (`x86_64-apple-darwin`) to the release matrix alongside Apple
  silicon.
- [ ] Add **ARM64 Windows** (`aarch64-pc-windows-msvc`).
- [ ] Add **32-bit Windows** (`i686-pc-windows-msvc`).
- [ ] Add **ARM64 Linux** (`aarch64-unknown-linux-gnu`) alongside the existing x86_64
  Linux builds.
- [ ] Update the build workflow, installer naming, README download table and update
  download labels for the expanded matrix.

## Features

- [ ] Per-sender colour customisation for messages, so messages from specific people can
  be colour-tagged.
- [ ] Colour customisation for assignments.
- [ ] A custom local display name in Settings that overrides the name Daymap returns.
- [ ] Locally stored custom profiles in the client.
- [x] Overdue-work management: mute overdue notifications for a specific class
  (including classes the user is no longer in) and mark assignments as not
  overdue, so false positives such as written Maths and English work can be
  corrected locally.
