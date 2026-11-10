# Daymap for Windows and Linux

This is the cross-platform Tauri port of the native macOS Daymap client. It keeps the same
Daymap API and sign-in flow, but replaces SwiftUI/AppKit with a React interface and a Rust
desktop backend.

> [!WARNING]
> **Unofficial client — not affiliated with, endorsed by, or supported by Daymap or any school.**
>
> - Use it at your own risk. Your school's acceptable-use policy may restrict third-party
>   clients, and this app could stop working whenever Daymap changes its API.
> - It talks to the same service your school's Daymap mobile site uses, with your own account,
>   and sends nothing to any third-party server.
> - Your password is only ever typed on your school's own login page. Tokens are held in the
>   operating system keychain by the Rust backend and never exposed to the webview.
> - No warranty of any kind. Read the code before trusting it with a school account.

The goal is one desktop codebase that builds for **Windows, Linux and macOS**. The app is
unofficial and is not affiliated with Daymap.

## Current milestone

Working:

- Daymap school discovery and OIDC sign-in in an embedded system webview.
- Access/refresh token handling in Rust.
- Session persistence in the operating system keychain (macOS Keychain, Windows Credential
  Manager, Linux Secret Service).
- Overview with due-soon, overdue, unread and notices counts.
- Tasks with search, filters, grouping and task details.
- Weekly timetable with lessons, attendance status and lesson resource links.
- Messages with folders, search, recipient lists, replies and a compose window.
- Contact search that combines staff results with students and parents indexed from message threads.
- Assignment detail with class resources, file downloads and student work uploads through Daymap's
  Azure Blob SAS flow.
- A token-free offline cache for the dashboard, tasks, timetable, notices, message folders and contact index.
- School notices with a card list and reading view.
- Settings with profile details, refresh cadence, session actions and app information.
- Latest-message previews and school notices on the overview.
- Sample-data mode for previewing the interface without a Daymap account.
- Cross-platform build workflow under `.github/workflows/build-desktop.yml`.

Not ported yet:

- Native notifications, contact CSV export, automatic updates and menu-bar behavior.

The native macOS client is archived separately as a standalone Swift package; this
repository contains only the cross-platform app.

## Development

Requirements:

- Node.js 20 or newer.
- Rust 1.77.2 or newer.
- The usual Tauri platform prerequisites. On Linux, install WebKitGTK 4.1, libdbus, libsecret
  and the other Tauri build dependencies for your distribution; the CI workflow lists the Ubuntu
  packages.
- macOS: Xcode command line tools.
- Windows: WebView2 runtime (installed by default on current Windows 10/11) and the MSVC
  build tools.

From this directory:

```bash
npm install
npm run tauri dev
```

For a browser-only interface preview:

```bash
npm run dev
```

The browser preview starts in sample-data mode. Native sign-in is intentionally unavailable
outside the desktop shell because it needs the embedded webview and the Rust keychain bridge.

## Build installers

```bash
npm run tauri build
```

Tauri writes platform bundles under `src-tauri/target/release/bundle/`:

- Windows: NSIS `.exe` and MSI.
- Linux: `.deb` and `.AppImage` (depending on the installed bundler tools).
- macOS: `.app` and `.dmg`.

Windows and Linux installers should be produced on their respective operating systems, or
through the included GitHub Actions workflow. The workflow is manual/tag-triggered and uploads
the bundles as artifacts; no signing keys are configured.

The workflow lives at the repository root, so it runs as-is with no working-directory
overrides.

## Sign-in and security

- The password is entered only on the school's Daymap/EdPass page in the embedded webview.
- Access and refresh tokens stay in Rust. The React layer only receives profile/dashboard data.
- The session is stored as one JSON value in the operating system keychain.
- The app does not log tokens. Keychain failures are reported locally without printing the
  session contents.
- HTTPS validation uses the operating system's certificate store, including school-installed
  private CAs installed by some schools. A Windows or Linux machine must trust that CA too.
- Linux requires a working Secret Service provider (GNOME Keyring, KWallet with the Secret
  Service bridge, or equivalent). Without one, the app can still run for the current session but
  it cannot persist sign-in across restarts.

The OIDC callback is detected by the native webview's navigation handler. Third-party SSO
providers that open a separate popup window may require additional handling; this needs testing
against each school's identity provider.

## Architecture

```text
src/                 React UI
  App.tsx            session lifecycle and auth events
  components/        login, shell, overview, tasks, messages, notices, timetable, settings
  dates.ts           Daymap date parsing and display helpers
  demo.ts            sample dashboard

src-tauri/src/
  auth.rs            discovery, PKCE, auth window, token refresh, keychain
  api.rs             authenticated Daymap requests and dashboard normalization
  messages.rs        message folders, threads, contacts, replies and compose requests
  cache.rs           account-scoped offline dashboard, mailbox and contact cache
  models.rs          bridge models shared with the frontend
```

The API calls are made by Rust rather than the browser, so the webview never handles bearer
tokens and the Daymap endpoints do not need browser CORS support.

## Verification status

Verified locally on macOS:

- `npm run build` (TypeScript and Vite production build).
- `cargo check` for the Rust backend.
- macOS Keychain round-trip through `keyring` (write, read and delete).
- Discovery against a school's Daymap host succeeds using the operating system trust store.
- `npx tauri build --debug --no-bundle`.
- `npx tauri build --debug` produced a macOS app bundle and DMG on the local machine.
- Browser sample mode: overview, tasks, messages, notices, timetable and settings rendered
  without console errors or horizontal overflow; compose and message-detail states were checked.

Not verified here:

- A real school sign-in from start to finish. It requires an account and interactive credentials.
- Windows and Linux compilation and installers. Build those through the included workflow or on
  native machines.
- Linux Secret Service availability at runtime.
