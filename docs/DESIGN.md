# Architecture

MoXi combines a WPF shell with a WebView2-hosted Markdown editor. All editor assets are bundled with the application.

| Component | Responsibility |
| --- | --- |
| Moxi.App | Window, theme, native controls, file dialogs and host integration |
| Moxi.Core | Encoding, document state, atomic save, conflicts and local resource resolution |
| Moxi.Checks | Native document and resource checks |
| web | Editor, preview, search and style resources |
| tests | Editor and host-message protocol checks |

## Document integrity

Opening a document, reading or switching views does not change its original bytes. Actual edits preserve the detected encoding and line endings. Saving checks for external changes and replaces the destination atomically. Structures that cannot round-trip safely through the rich-text editor remain editable as source.

## Views and host messages

Files open in a read-only focus view; new blank documents begin in editing mode. The host and editor exchange document-scoped messages for actions, state and snapshots. Switching views preserves document content and relevant editor state.

Search uses DOM ranges and CSS Custom Highlights. A text mirror provides source highlighting while the textarea retains input and caret ownership. Search navigation scrolls to a match without moving focus out of the search field.

## Native appearance

The native shell controls the Windows backdrop and accessibility fallback. The embedded surface becomes transparent only after the host confirms that the backdrop is active. Native and web theme resources change together, and the WebView layout leaves the resize region available to the native window.
