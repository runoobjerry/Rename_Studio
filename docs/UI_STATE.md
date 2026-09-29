# UI State

## Stage

Production-ready / Optimization.

The core UI workflow is complete. Current work should refine quality and maintainability rather than add product features.

## Current Focus

- Visual and interaction consistency across light and dark modes.
- Loading/error feedback, accessibility, responsive QA, and component cleanup.
- Keep API and Preview First behavior unchanged.

## Recently Completed

- MUI application shell with responsive Drawer and secondary Settings/RulePicker views.
- Compact file and rename preview tables with internal scrolling.
- Rule editor actions, MUI field controls, rule picker cards, and semantic color system.
- Preview/execute actions below the rule panel with MUI confirmation Dialog.
- Execution results merged into preview rows and directory refresh after success.
- Light/dark mode, OneDrive settings page, tooltips, icon actions, and consistent card geometry.
- Lazy secondary views and manual vendor chunks.
- Removed the unused `LegacyApp` and deleted its obsolete global CSS selectors.
- Migrated active native controls, contextual errors, OneDrive connection status, and the rename preview table to MUI.
- Moved shared input, table, selected-row, and Alert styling into the MUI theme; retained complex workspace layout and scrollbar CSS intentionally.
- Corrected light-mode contrast for checked controls and primary contained buttons, and added the missing destructive-action border in OneDrive settings.

## Next

1. Preserve structured API errors in the frontend client.
2. Add shared Snackbar/Alert notifications.
3. Improve initial/settings/loading distinctions.
4. Add preview expiry and recovery feedback.
5. Complete accessibility and responsive checks.
6. Expand orchestration and settings tests.
7. Revisit remaining page-layout CSS only alongside measured responsive or maintainability work.

## Known Issues

- API errors currently lose HTTP status, code, and details.
- No Toast/Snackbar success feedback.
- Preview expiry is not shown.
- Settings loading can briefly resemble a disconnected state.
- Rule fields support four known rule types only.
- Complex single-screen workspace layout and scrollbar behavior still use targeted CSS by design.
- No RuleSet, History, Undo, Redo, search, sorting, filtering, or virtualization.

## Do Not Touch

- Backend API contract and Pydantic fields.
- Rename Engine, Preview/Execute services, and Preview Store.
- Provider/Rule registries and implementations.
- OneDrive OAuth, token refresh, Graph pagination/batching, retry, and rate limiting.
- Database structure.

