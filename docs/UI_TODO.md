# UI TODO

This file contains future work only. Completed capabilities are summarized in `FRONTEND_HANDOFF.md`.

## Done

The production UI baseline is complete. Finished migration tasks are intentionally not repeated as a checklist here.

- Removed the unused `LegacyApp` and its obsolete CSS layer.
- Migrated active path/settings/rule inputs, action buttons, contextual errors, connection status, and rename preview table to MUI.
- Consolidated shared outlined-input, table, selected-row, and alert styling in the MUI theme while retaining only page-specific layout CSS.
- Added mode-aware primary colors for selected controls and emphasized buttons, and standardized the destructive settings action as an outlined button.

## Optimization

- [ ] Continue UI consistency review across spacing, typography, focus states, status colors, and dark-mode contrast.
- [ ] Improve initial directory, background refresh, OAuth/settings, preview, and execution loading feedback without changing request behavior.
- [ ] Refine empty and error presentation so authentication, provider, validation, conflict, expired preview, and partial execution states are visually distinct.
- [ ] Complete accessibility review: keyboard traversal, visible focus, table semantics, error association, live status announcements, and non-color status cues.
- [ ] Validate responsive behavior from 320px through desktop, including tables, rule controls, dialogs, and the temporary Drawer.
- [ ] Keep remaining CSS limited to page layout, internal scrolling, responsive composition, and custom component geometry; migrate it only when a component is otherwise being changed.
- [ ] Expand frontend tests for Workspace state clearing, Settings/OAuth feedback, RulePicker, theme switching, loading/error states, and Dialog edge cases.
- [ ] Monitor bundle size and large-directory rendering; keep current lazy views/manual chunks and optimize only from measured evidence.

## Pending

- [ ] Add a typed `ApiError` that preserves HTTP status, `error.code`, `message`, and `details` from the existing API response.
- [ ] Add a shared MUI Snackbar/Alert notification layer for settings, OAuth, preview, execute, and refresh outcomes while retaining contextual inline errors.
- [ ] Display preview expiry information and provide a direct re-preview path for `PREVIEW_EXPIRED`.
- [ ] Replace the native credential-clear `window.confirm` with the established MUI Dialog pattern.

## Deferred

- RuleSet UI until RuleSet API and persistence exist.
- History, Undo, and Redo until corresponding backend APIs and persistence exist.
- Search, sorting, filtering, and large-directory virtualization until requirements and API strategy are defined.
- Drag-and-drop rule ordering; keep the accessible move up/down controls.
- Shortcuts, rule templates, advanced workflows, optional motion, and deeper branding.
- New Providers, advanced rules, and plugin UI.

## Removed

- Breadcrumb navigation: the current design uses the path control plus parent navigation.
- Moving OneDrive settings into a Dialog: Settings is now a dedicated secondary page.
- A file-size table column: the accepted compact table shows name, extension, and modified time.
- Old tasks to install MUI or add the app shell, Drawer, theme, dark mode, file table, rule picker, preview table, and execute Dialog; these are implemented and no longer TODO items.

