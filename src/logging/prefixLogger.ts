import type { Logger } from "./logger";

/**
 * Wraps a {@link Logger} so every message is prefixed, letting all lines that
 * share a prefix (a session ID, a workspace name) be found with one search.
 * Extra arguments are forwarded untouched.
 */
export function prefixLogger(inner: Logger, prefix: string): Logger {
	const tag = (message: string) => `${prefix} ${message}`;
	return {
		trace: (message, ...args) => inner.trace(tag(message), ...args),
		debug: (message, ...args) => inner.debug(tag(message), ...args),
		info: (message, ...args) => inner.info(tag(message), ...args),
		warn: (message, ...args) => inner.warn(tag(message), ...args),
		error: (message, ...args) => inner.error(tag(message), ...args),
		show: () => inner.show(),
	};
}
