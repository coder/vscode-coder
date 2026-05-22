import { createWriteStream } from "node:fs";

import { toError } from "../../../../error/errorUtils";

/** Append-only writer for one OTLP/JSON envelope file. `append` is not re-entrant. */
export interface EnvelopeFile {
	append(value: unknown): Promise<void>;
	close(): Promise<void>;
}

/** Streams `<prefix>v1,v2,...<suffix>` JSON into `filePath`. */
export async function openEnvelopeFile(
	filePath: string,
	prefix: string,
	suffix: string,
): Promise<EnvelopeFile> {
	const stream = createWriteStream(filePath, { encoding: "utf8" });
	// Open failures (ENOENT/EACCES) surface as 'error' events, not write
	// callbacks; capture them so pending writes reject instead of hanging.
	let asyncError: Error | undefined;
	stream.once("error", (err) => {
		asyncError ??= err;
	});

	await write(stream, prefix, filePath, () => asyncError);
	let written = 0;
	let closed = false;
	return {
		async append(value) {
			await write(
				stream,
				(written === 0 ? "" : ",") + JSON.stringify(value),
				filePath,
				() => asyncError,
			);
			written += 1;
		},
		async close() {
			if (closed) {
				return;
			}
			closed = true;
			try {
				await write(stream, suffix, filePath, () => asyncError);
			} catch (err) {
				// Re-label suffix-write failures as a close failure.
				const inner = (err as { cause?: unknown }).cause;
				const msg =
					inner instanceof Error ? inner.message : toError(err).message;
				throw new Error(`Failed to close ${filePath}: ${msg}`, { cause: err });
			}
			await new Promise<void>((resolve, reject) => {
				stream.end((err?: Error | null) => {
					const failure = err ?? asyncError;
					if (failure) {
						reject(
							new Error(`Failed to close ${filePath}: ${failure.message}`, {
								cause: failure,
							}),
						);
					} else {
						resolve();
					}
				});
			});
		},
	};
}

function write(
	stream: NodeJS.WritableStream,
	chunk: string,
	filePath: string,
	asyncError: () => Error | undefined,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const reject_ = (err: unknown) =>
			reject(
				new Error(`Failed to write ${filePath}: ${toError(err).message}`, {
					cause: err,
				}),
			);
		const existing = asyncError();
		if (existing) {
			reject_(existing);
			return;
		}
		stream.write(chunk, "utf8", (err) => {
			const failure = err ?? asyncError();
			if (failure) {
				reject_(failure);
			} else {
				resolve();
			}
		});
	});
}
