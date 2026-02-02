/**
 * Logger interface that can be customized to send logs elsewhere (e.g., to the extension).
 */
export interface Logger {
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
}

/**
 * Default logger that writes to the browser console.
 * In webviews, this appears in the DevTools console.
 */
const consoleLogger: Logger = {
	/* eslint-disable no-console */
	debug: (...args) => console.debug("[webview]", ...args),
	info: (...args) => console.info("[webview]", ...args),
	warn: (...args) => console.warn("[webview]", ...args),
	error: (...args) => console.error("[webview]", ...args),
	/* eslint-enable no-console */
};

let currentLogger: Logger = consoleLogger;

/**
 * Set a custom logger implementation.
 * Call this early in your webview's initialization to redirect logs.
 */
export function setLogger(logger: Logger): void {
	currentLogger = logger;
}

// Convenience exports for direct use
export const logger = {
	debug: (...args: unknown[]) => currentLogger.debug(...args),
	info: (...args: unknown[]) => currentLogger.info(...args),
	warn: (...args: unknown[]) => currentLogger.warn(...args),
	error: (...args: unknown[]) => currentLogger.error(...args),
};
