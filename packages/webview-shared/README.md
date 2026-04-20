# Webview IPC

Shared primitives for typed, reliable messaging between the extension host
and VS Code webviews. Both sides use the **same `Api` definition object** so
wire formats can't drift and method-name typos are caught at compile time.

## Message kinds

```ts
// packages/shared/src/ipc/protocol.ts
defineNotification<D>(method); // extension to webview, fire-and-forget
defineCommand<P>(method); // webview to extension, fire-and-forget
defineRequest<P, R>(method); // webview to extension, awaits response
```

Define all three together in one `Api` const so both sides import the exact
same method strings:

```ts
// packages/shared/src/myfeature/api.ts
export const MyFeatureApi = {
	data: defineNotification<MyFeatureData>("myfeature/data"),
	doThing: defineCommand<{ id: string }>("myfeature/doThing"),
	getThings: defineRequest<void, Thing[]>("myfeature/getThings"),
} as const;
```

## Extension side (`src/webviews/...`)

### Sending notifications

```ts
import { notifyWebview } from "../util";

notifyWebview(panel.webview, MyFeatureApi.data, payload);
```

### Handling incoming messages (exhaustiveness)

Every panel **must** build handler maps with `buildCommandHandlers` and
`buildRequestHandlers`, even if it has zero requests today. Both builders
are mapped over the `Api` definition, so adding a new `defineCommand` or
`defineRequest` entry **produces a compile error** at the panel that forgot
to wire a handler. This makes it impossible to ship an API surface that
the extension silently drops.

```ts
import { buildCommandHandlers, buildRequestHandlers } from "@repo/shared";
import {
	dispatchCommand,
	dispatchRequest,
	isIpcCommand,
	isIpcRequest,
} from "../util";

const commandHandlers = buildCommandHandlers(MyFeatureApi, {
	doThing: async (p) => { ... },
});
// Empty is fine; it still enforces future additions.
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

**Error semantics** (built into `dispatchCommand` / `dispatchRequest`):

|               | Logs          | Response sent?                | `showErrorMessage` default |
| ------------- | ------------- | ----------------------------- | -------------------------- |
| Command fails | `logger.warn` | n/a                           | **yes** (user action)      |
| Request fails | `logger.warn` | `success: false` with `error` | **no** (often background)  |

Pass `showErrorToUser: (method) => …` to override per-method.

## Webview side, vanilla (`@repo/webview-shared`)

```ts
import { MyFeatureApi } from "@repo/shared";
import { onNotification, sendCommand } from "@repo/webview-shared";

// Subscribe to pushes.
const unsubscribe = onNotification(MyFeatureApi.data, (payload) => {
	render(payload);
});

// Fire a command.
sendCommand(MyFeatureApi.doThing, { id: "42" });
```

`onNotification` returns an unsubscribe function; call it on cleanup.

## Webview side, React

Use `useIpc` (`packages/webview-shared/src/react/useIpc`). Same semantics
plus request/response correlation with timeout and UUID bookkeeping.

## The "no dropped events" guarantee

Webview contexts are **destroyed when hidden** unless
`retainContextWhenHidden` is set (costly; avoid). This means the webview's
in-memory state, event listeners, and canvas pixels are lost whenever the
user switches tabs.

Every webview that pushes state from the extension must therefore **re-send
on these signals**, so the revived webview isn't left empty or stale:

1. **Visibility change**: `panel.onDidChangeViewState(() => panel.visible && resend())`.
   The webview was just re-created from HTML, so no in-memory state remains.
2. **Color theme change**: `vscode.window.onDidChangeActiveColorTheme(() => panel.visible && resend())`.
   DOM elements update via CSS vars, but canvas and SVG drawn imperatively
   do not: pixels are baked in. The webview must redraw against the new
   theme.

The `onWhileVisible(panel, event, handler)` helper in `src/webviews/util.ts`
wraps both cases. Both disposables must be collected and disposed in
`panel.onDidDispose` so they don't leak when the user closes the tab.

See `src/webviews/speedtest/speedtestPanel.ts` for a minimal reference.

## Checklist for a new webview

1. Define the API in `packages/shared/src/<feature>/api.ts` and export from `packages/shared/src/index.ts`.
2. Extension side: `buildCommandHandlers` **and** `buildRequestHandlers` (empty `{}` is fine; both are needed for exhaustiveness).
3. Extension side: dispatch through `isIpcRequest` to `dispatchRequest` and `isIpcCommand` to `dispatchCommand`, both with a logger.
4. Extension side: use `onWhileVisible` for `onDidChangeViewState` and `onDidChangeActiveColorTheme`, dispose in `onDidDispose`.
5. Webview side: use `onNotification` / `sendCommand` (vanilla) or `useIpc` (React). Never hand-roll `window.addEventListener("message", ...)`.
6. Tests: verify the panel posts the expected payload shape, re-sends on visibility and theme, and handles incoming commands.
