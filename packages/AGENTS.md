# Webview Development Guidelines

Webviews are isolated browser contexts with no Node.js or `vscode` access.
Each panel is a Vite package here; its extension side is in
`src/webviews/<panel>/`. Package boundaries:
[CODE_STRUCTURE.md](../docs/CODE_STRUCTURE.md).

## IPC

[webview-shared/README.md](webview-shared/README.md) defines the IPC
contract and the new-panel checklist.

- Never hand-roll `window.addEventListener("message", ...)` or
  `postMessage`. Use `onNotification` / `sendCommand` (vanilla) or `useIpc`
  (React) from `@repo/webview-shared`.
- Extension panels call both `buildCommandHandlers` and
  `buildRequestHandlers` (`{}` is fine), so an API method without a handler
  fails to compile.
- Panels that push data re-send it on visibility and theme changes with
  `onWhileVisible`; hidden webviews lose state and canvases keep old colors.

## React

The React Compiler runs on every build, so follow the rules of React: no
reading or writing refs during render, no mutating props, state or rendered
values, hooks called unconditionally. A component that breaks them silently
loses its memoization.

- Put parameter defaults that read another prop
  (`focused = adapter?.focusedId === row.node.id`) in the body.
- `useMemo` / `useCallback` are rarely needed; when kept they must list every
  dependency or lint fails.
- Effects are a last resort. Compute derived values during render, handle
  user actions in event handlers, and load requested data with React Query
  (pushed data arrives through `useIpc`).
  Use `useEffect` only to sync with an external system, and audit every
  dependency so it doesn't resubscribe on each update.
- Build React Query keys from the panel's key factory (`queryKeys` in
  `tasks/src/config.ts`); never retype one as a literal, and export it if
  needed. `isLoading` means
  no data yet and `isFetching` includes refetches: don't blank valid data
  while refetching. Invalidate every affected query after a mutation, even
  on partial failure. Prefer `mutate()` with callbacks; never wrap
  `mutateAsync()` in an empty `catch`.
- Views handle loading (spinner, never blank), error (actionable message),
  empty (deliberate copy) and refetch (keep data, never reset input or
  selection). Show a fallback ("Unknown") for missing text.

## Accessibility

- Every interactive element is keyboard reachable, including the reason a
  control is disabled.
- The accessible name contains the visible label (WCAG 2.5.3); don't replace
  it with an unrelated `aria-label`.
- Generate IDs for labels and `aria-*` with `useId`; hardcoded IDs collide.
- Hidden interactive elements leave the tab order too; prefer not rendering
  them.
- Check what a primitive does with `aria-*` and `role` before setting them.

## `@repo/ui` and Storybook

- `@repo/ui` holds generic VS Code-style components
  ([README](ui/README.md)). It imports no other workspace package and styles
  only through `--ui-*` tokens. Anything that knows about Coder belongs in a
  panel package. Reuse its components before writing new ones.
- Stories sit next to components as `Foo.stories.tsx` and render in captured
  VS Code themes ([.storybook/README.md](../.storybook/README.md)).
- Pixel screenshots every story in CI after its `play` function, in light
  and dark (`pixel.jsonc`); `PIXEL_ALL_THEMES` (`@repo/ui`'s `#storybook`) in
  `parameters.pixel` adds the high-contrast themes.
- `@repo/mocks` and `@repo/storybook-utils` are for stories and tests only.

## Tests

Tests live in `test/webview/<pkg>/` and run in jsdom (`pnpm test:webview`).
[docs/TESTING.md](../docs/TESTING.md) has the general rules. These follow
Testing Library's guidance; apply them to tests you add or change:

- Use `const user = userEvent.setup()` before rendering, not `fireEvent`,
  except for events `user-event` can't produce.
- Assert what the interaction did (IPC message, callback arguments, state);
  stories cover how it looks.
- Query by role and accessible name. `data-testid` only for elements with no
  role or name; never `querySelector` or class names.
- Use `find*` instead of `waitFor` around `get*`, and `query*` only to assert
  absence. Keep `waitFor` to one assertion and no side effects.
- Stay deterministic: time as a prop or fake timers, explicit locales.
- Stub globals with `vi.stubGlobal` (undo in-test stubs with
  `vi.unstubAllGlobals()`), never `Object.defineProperty`.
- Wrap React Query components with `renderWithQuery`
  (`test/webview/render.tsx`).
