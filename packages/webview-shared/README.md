# Webview IPC

Typed messaging between the extension and VS Code webviews. Both sides
import the same `Api` definition, so wire formats can't drift and method
typos fail at compile time.

This file is a map; the helpers themselves are the source of truth. When
something here looks wrong, trust the linked source.

## Three message kinds

Defined in `packages/shared/src/ipc/protocol.ts`:

- `defineNotification<D>(method)` - extension to webview, fire-and-forget
- `defineCommand<P>(method)` - webview to extension, fire-and-forget
- `defineRequest<P, R>(method)` - webview to extension, awaits a response

Group them in one `Api` const at `packages/shared/src/<feature>/api.ts`
(see `chat/api.ts`, `speedtest/api.ts`, `tasks/api.ts`).

## Where each handler lives

| Direction                             | Define                  | Extension side (`src/webviews/...`)                    | Webview vanilla               | Webview React                       |
| ------------------------------------- | ----------------------- | ------------------------------------------------------ | ----------------------------- | ----------------------------------- |
| extension -> webview push             | `defineNotification<D>` | `notifyWebview(view, def, data)`                       | `subscribeNotifications(api)` | `apiHook.on<Name>(cb)` via `useIpc` |
| webview -> extension, fire-and-forget | `defineCommand<P>`      | handler in `buildCommandHandlers` -> `dispatchCommand` | `sendCommand(def, params)`    | `apiHook.<name>(params)`            |
| webview -> extension, awaits response | `defineRequest<P, R>`   | handler in `buildRequestHandlers` -> `dispatchRequest` | _not exposed; use a command_  | `await apiHook.<name>(params)`      |

Compile-time exhaustiveness fails the build in three places:

- **Extension**: `buildCommandHandlers(Api, ...)` / `buildRequestHandlers(Api, ...)` (`packages/shared/src/ipc/protocol.ts`).
- **Webview vanilla**: `subscribeNotifications(Api, ...)` (`packages/webview-shared/src/ipc.ts`).
- **Webview React**: `apiHook` is generated from `Api` so every notification has a typed accessor (`buildApiHook` in `packages/shared/src/ipc/protocol.ts`).

## Reference implementations

Use these as the working blueprint when writing a new webview. The
helpers' JSDoc covers their contracts.

| Concern                                 | Look at                                                     |
| --------------------------------------- | ----------------------------------------------------------- |
| Vanilla webview package                 | `packages/speedtest/` (or `packages/chat/`)                 |
| React webview package                   | `packages/tasks/`                                           |
| Extension panel (`WebviewPanel`)        | `src/webviews/speedtest/speedtestPanelFactory.ts`           |
| Extension panel (`WebviewViewProvider`) | `src/webviews/tasks/tasksPanelProvider.ts`                  |
| Iframe-embedding panel                  | `src/webviews/chat/chatPanelProvider.ts` + `packages/chat/` |
| Vite config helper                      | `packages/webview-shared/createWebviewConfig.ts`            |
| Dispatch / lifecycle helpers            | `src/webviews/dispatch.ts`                                  |
| HTML scaffolding                        | `src/webviews/html.ts`                                      |

## Re-sending on lifecycle events

Webviews lose state in two ways the extension has to compensate for:

1. **Hidden webviews are destroyed** unless `retainContextWhenHidden` is
   set (costly; we don't). Push panels must resend when the webview
   comes back visible.
2. **Theme changes don't repaint canvases** (CSS vars update DOM but
   imperative canvas/SVG bake the theme into pixels). Resend on
   `vscode.window.onDidChangeActiveColorTheme` regardless of
   `retainContextWhenHidden`.

`onWhileVisible` in `src/webviews/dispatch.ts` wraps both. See its JSDoc
and the `disposables` array in `speedtestPanelFactory.ts` for usage.

## Checklist for a new webview

1. **Shared API**: add `packages/shared/src/<feature>/api.ts` and
   re-export from `packages/shared/src/index.ts`.
2. **Webview package**: copy `packages/speedtest/` (vanilla) or
   `packages/tasks/` (React). The `vite.config.ts` is one line.
3. **Webview entry**: subscribe with `subscribeNotifications` (vanilla)
   or `useIpc` + the generated `apiHook` (React). Don't hand-roll
   `window.addEventListener("message", ...)`.
4. **Extension panel**: register in `package.json` under
   `contributes.views` (sidebar) or via `vscode.window.createWebviewPanel`
   (editor tab), and wire the provider in `src/extension.ts`.
5. **Extension dispatch**: build both handler maps with
   `buildCommandHandlers` / `buildRequestHandlers` (empty `{}` is what
   locks in future exhaustiveness), then dispatch with
   `isIpcRequest` -> `dispatchRequest` and `isIpcCommand` ->
   `dispatchCommand`. Pass `showErrorToUser` for user-initiated methods.
6. **Lifecycle**: use `onWhileVisible` for `onDidChangeViewState` /
   `onDidChangeVisibility` and `onDidChangeActiveColorTheme`; dispose in
   `onDidDispose`.
7. **Tests**: assert the panel posts the expected payload shape,
   resends on visibility and theme, and handles incoming commands and
   requests. See `test/unit/webviews/` for patterns.
