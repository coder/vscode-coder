/**
 * Type-safe IPC protocol for VS Code webview communication.
 *
 * Inspired by tRPC's approach: types are carried in a phantom `_types` property
 * that exists only for TypeScript inference, not at runtime.
 */

// --- Message definitions ---

/** Request definition: params P, response R */
export interface RequestDef<P = void, R = void> {
	readonly method: string;
	/** @internal Phantom types for inference - not present at runtime */
	readonly _types?: { params: P; response: R };
}

/** Command definition: params P, no response */
export interface CommandDef<P = void> {
	readonly method: string;
	/** @internal Phantom type for inference - not present at runtime */
	readonly _types?: { params: P };
}

/** Notification definition: data D (extension to webview) */
export interface NotificationDef<D = void> {
	readonly method: string;
	/** @internal Phantom type for inference - not present at runtime */
	readonly _types?: { data: D };
}

// --- Factory functions ---

/** Define a request with typed params and response */
export function defineRequest<P = void, R = void>(
	method: string,
): RequestDef<P, R> {
	return { method } as RequestDef<P, R>;
}

/** Define a fire-and-forget command */
export function defineCommand<P = void>(method: string): CommandDef<P> {
	return { method } as CommandDef<P>;
}

/** Define a push notification (extension to webview) */
export function defineNotification<D = void>(
	method: string,
): NotificationDef<D> {
	return { method } as NotificationDef<D>;
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

// --- Handler utilities ---

/** Extract params type from a request/command definition */
export type ParamsOf<T> = T extends { _types?: { params: infer P } } ? P : void;

/** Extract response type from a request definition */
export type ResponseOf<T> = T extends { _types?: { response: infer R } }
	? R
	: void;

/** Type-safe request handler - infers params and return type from definition */
export function requestHandler<P, R>(
	_def: RequestDef<P, R>,
	fn: (params: P) => Promise<R>,
): (params: unknown) => Promise<unknown> {
	return fn as (params: unknown) => Promise<unknown>;
}

/** Type-safe command handler - infers params type from definition */
export function commandHandler<P>(
	_def: CommandDef<P>,
	fn: (params: P) => void | Promise<void>,
): (params: unknown) => void | Promise<void> {
	return fn as (params: unknown) => void | Promise<void>;
}
