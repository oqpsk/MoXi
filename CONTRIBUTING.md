# Contributing

MoXi is a Windows application built with WPF and a locally bundled Markdown editor.

## Build

Prerequisites: Windows, Node.js 24, .NET SDK 10 and Microsoft Edge WebView2 Runtime.

```powershell
npm ci
./scripts/Test.ps1
./scripts/Check-Privacy.ps1
./scripts/Build.ps1
```

To produce a portable ZIP from a clean build:

```powershell
./scripts/Package.ps1
```

## Pull requests

Create a topic branch from main. Describe the problem and resulting behavior, keep changes focused, and update FEATURES.md and CHANGELOG.md when appropriate. Windows CI runs tests, source checks and packaging.

Check reading, editing and source views when changing editor behavior. For visual changes, consider day/dark themes, narrow and wide windows, keyboard navigation and DPI scaling. Distinguish automated checks from native desktop observations.

Do not include credentials, personal documents, local environment details, caches or runtime user data. Preserve third-party licenses and notices.
