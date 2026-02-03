/**
 * Type-safe IPC protocol for VS Code webview communication.
 *
 * Provides compile-time binding between request params and response types,
 * eliminating runtime type mismatches.
 */

/** Base for all IPC messages */
export interface IpcMessageBase {
	method: string;
	scope?: string;
}

/**
 * Request expecting a response. Generic params ensure type safety:
 * - P: request payload type
 * - R: response type (phantom - not sent over wire)
 */
export interface IpcRequest<P = void, R = void> extends IpcMessageBase {
	readonly requestId: string;
	readonly params: P;
	/** Phantom type for compile-time response inference */
	readonly _response?: R;
}

/** Fire-and-forget command, no response expected */
export interface IpcCommand<P = void> extends IpcMessageBase {
	readonly params: P;
}

/** Extension-to-webview push notification */
export interface IpcNotification<D = void> extends IpcMessageBase {
	readonly data: D;
}

/** Response from extension to webview */
export interface IpcResponse<T = unknown> {
	readonly requestId: string;
	readonly method: string;
	readonly success: boolean;
	readonly data?: T;
	readonly error?: string;
}

// =============================================================================
// Type definition helpers - create type-safe message contracts
// =============================================================================

/** Define a request with compile-time param→response binding */
export function defineRequest<P = void, R = void>(
	method: string,
	scope?: string,
) {
	return {
		method,
		scope,
		_params: undefined as unknown as P,
		_response: undefined as unknown as R,
	} as const;
}

/** Define a fire-and-forget command */
export function defineCommand<P = void>(method: string, scope?: string) {
	return {
		method,
		scope,
		_params: undefined as unknown as P,
	} as const;
}

/** Define a push notification (extension → webview) */
export function defineNotification<D = void>(method: string, scope?: string) {
	return {
		method,
		scope,
		_data: undefined as unknown as D,
	} as const;
}

// =============================================================================
// Type extraction utilities
// =============================================================================

/** Extract params type from a request/command definition */
export type ParamsOf<T> = T extends { _params: infer P } ? P : never;

/** Extract response type from a request definition */
export type ResponseOf<T> = T extends { _response: infer R } ? R : never;

/** Extract data type from a notification definition */
export type DataOf<T> = T extends { _data: infer D } ? D : never;

/** Message definition with method and optional scope */
export interface MessageDefinition {
	method: string;
	scope?: string;
}
