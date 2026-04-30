# Webview IPC

Typed messaging between the extension and VS Code webviews. Both sides
import the same `Api` definition, so wire formats can't drift and method
typos fail at compile time.

## Three message kinds

```ts
defineNotification<D>(method); // extension to webview, fire-and-forget
defineCommand<P>(method); // webview to extension, fire-and-forget
defineRequest<P, R>(method); // webview to extension, awaits response
```

Define them all in one `Api` so both sides share the strings:

```ts
// packages/shared/src/myfeature/api.ts
export const MyFeatureApi = {
	data: defineNotification<MyFeatureData>("myfeature/data"),
	doThing: defineCommand<{ id: string }>("myfeature/doThing"),
	getThings: defineRequest<void, Thing[]>("myfeature/getThings"),
} as const;
```

## Extension side (`src/webviews/...`)

Push notifications:

```ts
import { notifyWebview } from "../dispatch";

notifyWebview(panel.webview, MyFeatureApi.data, payload);
```

Receive commands and requests. Every panel builds both handler maps (an
empty `{}` is fine). The maps are mapped over the `Api`, so adding a new
`defineCommand` or `defineRequest` produces a compile error in any panel
missing a handler. That's how new methods can't ship and silently drop.

```ts
import { buildCommandHandlers, buildRequestHandlers } from "@repo/shared";
import {
	dispatchCommand,
	dispatchRequest,
	isIpcCommand,
	isIpcRequest,
} from "../dispatch";

const commandHandlers = buildCommandHandlers(MyFeatureApi, {
	doThing: async (p) => { ... },
});
// Empty is fine; it still locks in future additions.
const requestHandlers = buildRequestHandlers(MyFeatureApi, {
	getThings: async () => this.fetchThings(),
});

panel.webview.onDidReceiveMessage((message: unknown) => {
	if (isIpcRequest(message)) {
		void dispatchRequest(message, requestHandlers, panel.webview, {
			logger,
			showErrorToUser: (m) => USER_ACTION_METHODS.has(m),
		});
	} else if (isIpcCommand(message)) {
		void dispatchCommand(message, commandHandlers, { logger });
	}
});
```

### Error handling

Both dispatchers log handler failures via `logger.warn`. Requests also
post a `success: false` response so the webview's awaited promise rejects.

Neither pops a dialog by default. Pass `showErrorToUser: (method) => ...`
to opt in for methods where a silent failure would confuse the user.

## Webview side, vanilla

```ts
import { MyFeatureApi } from "@repo/shared";
import { onNotification, sendCommand } from "@repo/webview-shared";

const unsubscribe = onNotification(MyFeatureApi.data, (payload) => {
	render(payload);
});

sendCommand(MyFeatureApi.doThing, { id: "42" });
```

Call the returned unsubscribe function on cleanup.

## Webview side, React

Use `useIpc` from `packages/webview-shared/src/react/useIpc`. Same
semantics, plus request/response correlation with timeouts and UUID
bookkeeping.

## Re-sending on lifecycle events

Webviews lose state in two ways the extension has to compensate for.

**Hidden webviews are destroyed.** Switching tabs discards in-memory state,
listeners, and canvas pixels. Push-driven panels resend when the webview
comes back. Subscribe to `panel.onDidChangeViewState` (`WebviewPanel`) or
`view.onDidChangeVisibility` (`WebviewViewProvider`) and resend on
`visible`. Setting `retainContextWhenHidden` avoids this but is costly,
so we don't.

**Theme changes don't repaint canvases.** CSS vars update automatically,
but canvas and SVG drawn imperatively bake the theme into pixels.
Subscribe to `vscode.window.onDidChangeActiveColorTheme` and resend so
the webview redraws. This applies regardless of `retainContextWhenHidden`.

`onWhileVisible(panel, event, handler)` in `src/webviews/dispatch.ts`
works with both panel shapes. Collect disposables and clear them in
`onDidDispose`.

See `speedtestPanelFactory.ts` for a `WebviewPanel` example and
`tasksPanelProvider.ts` for a `WebviewViewProvider` example.

## Checklist for a new webview

1. Register the view in `package.json` under `contributes.views` (sidebar)
   or call `vscode.window.createWebviewPanel` (editor tab).
2. Register the provider in `src/extension.ts`.
3. Define the API in `packages/shared/src/<feature>/api.ts` and export it
   from `packages/shared/src/index.ts`.
4. Build both handler maps with `buildCommandHandlers` and
   `buildRequestHandlers` (empty `{}` is fine).
5. Dispatch with `isIpcRequest` -> `dispatchRequest` and `isIpcCommand` ->
   `dispatchCommand`, both with a logger.
6. Use `onWhileVisible` for `onDidChangeViewState` /
   `onDidChangeVisibility` and `onDidChangeActiveColorTheme`, and dispose
   in `onDidDispose`.
7. On the webview side, use `onNotification` / `sendCommand` (vanilla) or
   `useIpc` (React). Don't hand-roll `window.addEventListener("message",
...)` in webview package code. The one exception is an inline HTML
   shim bridging a third-party iframe (see `chatPanelProvider.ts`); keep
   it small.
8. Tests: assert the panel posts the expected payload shape, resends on
   visibility and theme, and handles incoming commands.
