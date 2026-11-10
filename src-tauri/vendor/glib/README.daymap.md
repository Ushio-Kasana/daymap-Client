# Vendored glib 0.18.5

This is the published `glib` 0.18.5 crate with the upstream `VariantStrIter`
soundness backport applied to `src/variant_iter.rs`.

Tauri 2's Linux GTK3 stack requires `glib` 0.18. `glib` 0.20 is the GTK4
generation and is not compatible with that stack, and the gtk-rs maintainers
have said there will be no `glib` 0.18.6 release. The backport changes only the
unsound out-argument from `&p` to `&mut p`:

- <https://github.com/gtk-rs/gtk-rs-core/pull/2009>
- <https://github.com/advisories/GHSA-wrw7-89jp-8q8g>

Remove this patch when Tauri's Linux backend moves to a maintained GTK stack
with `glib >= 0.20`.
