# Repository guidelines

- Keep MoXi a focused Windows application for local Markdown reading and editing.
- Use topic branches and pull requests. Update product capabilities and release notes when behavior changes.
- Run scripts/Test.ps1 and scripts/Check-Privacy.ps1 before committing. Build distributables from clean output with scripts/Package.ps1.
- Preserve unchanged document bytes, encoding, BOM and line endings. Guard external file conflicts and preserve source-only syntax without silent conversion.
- Bundle editor resources locally; use the system WebView2 runtime.
- Keep theme resources consistent between the native shell and embedded editor. Preserve accessibility fallbacks and native resize regions.
- Write public documentation for users or contributors. Exclude private notes, conversations, personal preferences, local-machine observations, credentials and environment-specific paths.
- Keep generated files, runtime user data and development caches out of Git and distribution packages.
- Preserve licenses and required third-party attribution.
- Report validation accurately; distinguish program and headless checks from observed native desktop behavior.
