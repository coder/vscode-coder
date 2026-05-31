import { createWriteStream } from "node:fs";

import { wrapError } from "../../../../error/errorUtils";

/** `append` is not re-entrant. */
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
	// callbacks; capture them so pending operations reject instead of hanging.
	const errRef: { current?: Error } = {};
	stream.once("error", (err) => {
		errRef.current ??= err;
	});

	const awaitOp = (op: (cb: (err?: Error | null) => void) => void) =>
		new Promise<void>((resolve, reject) => {
			if (errRef.current) {
				reject(errRef.current);
				return;
			}
			op((err) => {
				const failure = err ?? errRef.current;
				if (failure) {
					reject(failure);
				} else {
					resolve();
				}
			});
		});

	const writeChunk = (chunk: string) =>
		awaitOp((cb) => stream.write(chunk, "utf8", cb));

	try {
		await writeChunk(prefix);
	} catch (err) {
		stream.destroy();
		throw wrapError("write", filePath, err);
	}
	let written = 0;
	let closed = false;
	return {
		async append(value) {
			try {
				await writeChunk((written === 0 ? "" : ",") + JSON.stringify(value));
			} catch (err) {
				throw wrapError("write", filePath, err);
			}
			written += 1;
		},
		async close() {
			if (closed) {
				return;
			}
			closed = true;
			try {
				await writeChunk(suffix);
				await awaitOp((cb) => stream.end(cb));
			} catch (err) {
				// destroy() never throws synchronously, so it can't mask the
				// rethrown error; any teardown failure routes to the 'error' event.
				stream.destroy();
				throw wrapError("close", filePath, err);
			}
		},
	};
}
