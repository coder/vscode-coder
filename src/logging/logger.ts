export interface Logger {
	trace(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
	show(): void;
}

/** A logger that buffers below-level entries and can replay them. */
export interface BufferedLogger extends Logger {
	flush(reason: string, options?: { readonly retain?: boolean }): void;
}
