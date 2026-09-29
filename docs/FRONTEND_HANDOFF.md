# Frontend Handoff

## Current Status

Production-ready UI baseline completed. Current stage: refinement, consistency, performance, accessibility, and maintainability.

The working frontend supports Local Files and OneDrive Personal from browsing through preview-confirmed rename execution. RuleSet, History, and Undo/Redo are not available and must not be presented as working features.

## Tech Stack

- React 18 and TypeScript 5.6
- Vite 5
- Material UI 9 and Emotion
- TanStack Query 5
- Zustand 5
- Vitest, Testing Library, and JSDOM

## Current Architecture

- `src/App.tsx` is a minimal default export of `WorkspaceApp`; the unused legacy application has been removed.
- `WorkspaceApp.tsx` owns query/mutation orchestration and three in-memory views: workspace, rule picker, and settings. There is no URL router or deep-link routing.
- Settings and rule picker views are lazy-loaded.
- `features/` contains file browsing, rule editing, rename preview/actions, and settings UI.
- TanStack Query owns server state and cache invalidation. Zustand only stores selected IDs and the current rule chain.
- `api/client.ts` is the only frontend HTTP layer; `types/index.ts` mirrors API response shapes.
- `theme.ts` defines light/dark semantic colors and shared MUI overrides. `styles.css` is limited to page layout, internal scrolling, responsive composition, and custom component geometry.

## Implemented Features

- Responsive MUI Drawer with Local Files, OneDrive, and Settings navigation.
- Persisted light/dark mode based on user choice and system preference.
- Local root path input plus backend-hosted folder picker.
- OneDrive App ID settings, OAuth popup login, account switch, disconnect, and credential clearing.
- Directory browsing, parent navigation, manual refresh, file/folder icons, name tooltips, modified time, and internal table scrolling.
- File and folder selection with row checkbox, select all, invert selection, selected count, and selection reset on context changes.
- Rule picker and ordered rule chain for `padding`, `replace`, `remove`, and `insert`.
- Rule enable/disable, move up/down, duplicate, delete, and clear-all controls.
- Server-generated rename preview with changed, unchanged, invalid, and conflict/error presentation.
- Preview-first execution, MUI confirmation Dialog, duplicate-submit prevention, per-item execution status merged into the preview table, selection clearing, and background directory refresh.
- Baseline loading, empty, error, disabled, tooltip, and responsive states.

Renaming a selected folder changes that folder's name only; it does not recursively rename its contents.

## Important Components

- `frontend/src/WorkspaceApp.tsx` — application shell, view state, queries, mutations, and invalidation rules.
- `frontend/src/features/files/FileBrowser.tsx` — directory table, navigation, and selection.
- `frontend/src/features/rules/RuleEditor.tsx` — ordered rule chain and rule actions.
- `frontend/src/features/rules/RuleFields.tsx` — configuration UI for the four supported rule types.
- `frontend/src/features/rules/RulePickerPage.tsx` — secondary rule selection page.
- `frontend/src/features/rename/PreviewPanel.tsx` — preview and merged execution results.
- `frontend/src/features/rename/RenameActions.tsx` — preview/execute buttons and confirmation Dialog.
- `frontend/src/features/settings/SettingsPage.tsx` and `OneDriveSettingsPanel.tsx` — appearance and OneDrive settings.
- `frontend/src/api/client.ts`, `frontend/src/types/index.ts`, `frontend/src/stores/useRenameStore.ts`, `frontend/src/theme.ts`, and `frontend/src/styles.css` — shared boundaries.

## Stable Areas

- Backend API contract and Pydantic field names.
- Preview-first safety model and one-time `preview_id` execution.
- Rename Engine, Rule Registry, Provider Registry, conflict planning, and rollback behavior.
- Local and OneDrive provider behavior, OAuth flow, token refresh, Graph pagination/batching, retry, and rate-limit handling.
- Query keys and state-clearing behavior when provider, path, selection, rules, or local root changes.

UI refinement should not modify these areas unless the task explicitly requires it.

## Known Limitations

- `api/client.ts` converts API failures to plain `Error` and drops HTTP status, `error.code`, and `details`.
- There is no Snackbar/Toast system. Errors are shown through a global Alert or local inline messages; successful settings actions have no transient notification.
- Preview `expires_at` is not displayed and `PREVIEW_EXPIRED` has no dedicated recovery UI.
- Initial directory and settings loading use text or implicit state rather than complete Skeleton/progress treatment; OneDrive settings can briefly look disconnected while loading.
- The four rule field layouts are handwritten. A backend rule added to `/rules` does not automatically gain frontend fields.
- `styles.css` now focuses on page layout, internal scrolling, responsive composition, and custom component geometry; shared control styling lives in the MUI theme.
- Automated frontend tests cover FileBrowser, RuleEditor, PreviewPanel, and RenameActions only. Workspace orchestration, Settings, RulePicker, theme switching, and error/loading flows are not covered.
- No frontend search, sort, filtering, virtualization, RuleSet, History, Undo, or Redo. `/files` has no pagination/query API; OneDrive Graph pagination is aggregated by the backend.
- Real-account OneDrive authentication and rename still require environment-specific acceptance testing.

## Development Rules

- Default to changes under `frontend/` and documentation under `docs/`.
- Do not change the backend, API contract, Rename Engine, Rules, Providers, database, or OAuth flow for a visual issue.
- Preserve Preview First and existing query invalidation/state reset behavior.
- Read the target page, its direct components/styles, and the relevant `API_REFERENCE.md` section before editing.
- Prefer small local changes and reuse current MUI components and semantic theme tokens.
- Do not reintroduce completed UI migration plans or expose unavailable backend capabilities.
- By default perform static checks only; the user runs builds and tests unless explicitly requested.

