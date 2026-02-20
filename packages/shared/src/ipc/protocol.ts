/**
 * Type-safe IPC protocol for VS Code webview communication.
 *
 * Inspired by tRPC's approach: types are carried in a phantom `_types` property
 * that exists only for TypeScript inference, not at runtime.
 */

// --- Message definitions ---

/** Request definition: params P, response R */
export interface RequestDef<P = void, R = void> {
	readonly kind: "request";
	readonly method: string;
	/** @internal Phantom types for inference - not present at runtime */
	readonly _types?: { params: P; response: R };
}

/** Command definition: params P, no response */
export interface CommandDef<P = void> {
	readonly kind: "command";
	readonly method: string;
	/** @internal Phantom type for inference - not present at runtime */
	readonly _types?: { params: P };
}

/** Notification definition: data D (extension to webview) */
export interface NotificationDef<D = void> {
	readonly kind: "notification";
	readonly method: string;
	/** @internal Phantom type for inference - not present at runtime */
	readonly _types?: { data: D };
}

// --- Factory functions ---

/** Define a request with typed params and response */
export function defineRequest<P = void, R = void>(
	method: string,
): RequestDef<P, R> {
	return { kind: "request", method } as RequestDef<P, R>;
}

/** Define a fire-and-forget command */
export function defineCommand<P = void>(method: string): CommandDef<P> {
	return { kind: "command", method } as CommandDef<P>;
}

/** Define a push notification (extension to webview) */
export function defineNotification<D = void>(
	method: string,
): NotificationDef<D> {
	return { kind: "notification", method } as NotificationDef<D>;
}

// --- Wire format ---

/** Request from webview to extension */
export interface IpcRequest<P = unknown> {
	readonly requestId: string;
	readonly method: string;
	readonly params?: P;
}

/** Response from extension to webview */
export interface IpcResponse<T = unknown> {
	readonly requestId: string;
	readonly method: string;
	readonly success: boolean;
	readonly data?: T;
	readonly error?: string;
}

/** Push notification from extension to webview */
export interface IpcNotification<D = unknown> {
	readonly type: string;
	readonly data?: D;
}

// --- Mapped types for handler completeness ---

/** Requires a handler for every RequestDef in Api. Compile error if one is missing. */
export type RequestHandlerMap<Api> = {
	[K in keyof Api as Api[K] extends { kind: "request" }
		? K
		: never]: Api[K] extends RequestDef<infer P, infer R>
		? (params: P) => Promise<R>
		: never;
};

/** Requires a handler for every CommandDef in Api. Compile error if one is missing. */
export type CommandHandlerMap<Api> = {
	[K in keyof Api as Api[K] extends { kind: "command" }
		? K
		: never]: Api[K] extends CommandDef<infer P>
		? (params: P) => void | Promise<void>
		: never;
};

// --- API hook type ---

/** Derives a fully typed hook interface from an API definition object. */
export type ApiHook<Api> = {
	[K in keyof Api as Api[K] extends { kind: "request" }
		? K
		: never]: Api[K] extends RequestDef<infer P, infer R>
		? (...args: P extends void ? [] : [params: P]) => Promise<R>
		: never;
} & {
	[K in keyof Api as Api[K] extends { kind: "command" }
		? K
		: never]: Api[K] extends CommandDef<infer P>
		? (...args: P extends void ? [] : [params: P]) => void
		: never;
} & {
	[K in keyof Api as Api[K] extends { kind: "notification" }
		? `on${Capitalize<K & string>}`
		: never]: Api[K] extends NotificationDef<infer D>
		? D extends void
			? (cb: () => void) => () => void
			: (cb: (data: D) => void) => () => void
		: never;
};

// --- Builder functions ---

/** Build a method-indexed map of request handlers with compile-time completeness. */
export function buildRequestHandlers<
	Api extends Record<string, { method: string }>,
>(
	api: Api,
	handlers: RequestHandlerMap<Api>,
): Record<string, (params: unknown) => Promise<unknown>>;
export function buildRequestHandlers(
	api: Record<string, { method: string }>,
	handlers: Record<string, (params: unknown) => Promise<unknown>>,
) {
	const result: Record<string, (params: unknown) => Promise<unknown>> = {};
	for (const key of Object.keys(handlers)) {
		result[api[key].method] = handlers[key];
	}
	return result;
}

/** Build a method-indexed map of command handlers with compile-time completeness. */
export function buildCommandHandlers<
	Api extends Record<string, { method: string }>,
>(
	api: Api,
	handlers: CommandHandlerMap<Api>,
): Record<string, (params: unknown) => void | Promise<void>>;
export function buildCommandHandlers(
	api: Record<string, { method: string }>,
	handlers: Record<string, (params: unknown) => void | Promise<void>>,
) {
	const result: Record<string, (params: unknown) => void | Promise<void>> = {};
	for (const key of Object.keys(handlers)) {
		result[api[key].method] = handlers[key];
	}
	return result;
}

/** Build a typed API hook from an API definition and IPC primitives. */
export function buildApiHook<
	Api extends Record<string, { kind: string; method: string }>,
>(
	api: Api,
	ipc: {
		request: <P, R>(
			def: { method: string; _types?: { params: P; response: R } },
			...args: P extends void ? [] : [params: P]
		) => Promise<R>;
		command: <P>(
			def: { method: string; _types?: { params: P } },
			...args: P extends void ? [] : [params: P]
		) => void;
		onNotification: <D>(
			def: { method: string; _types?: { data: D } },
			cb: (data: D) => void,
		) => () => void;
	},
): ApiHook<Api>;
export function buildApiHook(
	api: Record<string, { kind: string; method: string }>,
	ipc: {
		request: (def: { method: string }, params: unknown) => Promise<unknown>;
		command: (def: { method: string }, params: unknown) => void;
		onNotification: (
			def: { method: string },
			cb: (data: unknown) => void,
		) => () => void;
	},
) {
	const result: Record<string, unknown> = {};
	for (const [key, def] of Object.entries(api)) {
		switch (def.kind) {
			case "request":
				result[key] = (params: unknown) => ipc.request(def, params);
				break;
			case "command":
				result[key] = (params: unknown) => ipc.command(def, params);
				break;
			case "notification":
				result[`on${key[0].toUpperCase()}${key.slice(1)}`] = (
					cb: (data: unknown) => void,
				) => ipc.onNotification(def, cb);
				break;
		}
	}
	return result;
}
