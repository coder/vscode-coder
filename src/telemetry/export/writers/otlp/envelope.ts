import { createWriteStream } from "node:fs";

import { wrapError } from "../../../../error/errorUtils";

/** `openBlock` and `append` are not re-entrant. */
export interface EnvelopeFile {
	/** Opens a new block, closing the previous one with the block suffix. */
	openBlock(prefix: string): Promise<void>;
	/** Appends one record to the open block; rejects if no block is open. */
	append(value: unknown): Promise<void>;
	close(): Promise<void>;
}

/**
 * Streams `<filePrefix>block,block,...<fileSuffix>` JSON into `filePath`,
 * where each block is `<prefix>v1,v2,...<blockSuffix>`.
 */
export async function openEnvelopeFile(
	filePath: string,
	filePrefix: string,
	blockSuffix: string,
	fileSuffix: string,
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
		await writeChunk(filePrefix);
	} catch (err) {
		stream.destroy();
		throw wrapError("write", filePath, err);
	}
	let blockOpen = false;
	let written = 0;
	let closed = false;
	return {
		async openBlock(prefix) {
			try {
				await writeChunk((blockOpen ? blockSuffix + "," : "") + prefix);
			} catch (err) {
				throw wrapError("write", filePath, err);
			}
			blockOpen = true;
			written = 0;
		},
		async append(value) {
			if (!blockOpen) {
				throw new Error(`No open block to append to in ${filePath}`);
			}
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
				await writeChunk((blockOpen ? blockSuffix : "") + fileSuffix);
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
