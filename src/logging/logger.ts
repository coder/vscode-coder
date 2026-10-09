/** A destination that writes log entries, such as the output channel. */
export interface LogSink {
	trace(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
	show(): void;
}

/** A sink that also records below-level entries and can replay them. */
export interface Logger extends LogSink {
	flush(reason: string, options?: { readonly retain?: boolean }): void;
}
