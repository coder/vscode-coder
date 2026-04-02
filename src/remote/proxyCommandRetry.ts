import * as fs from "node:fs/promises";
import * as path from "node:path";

import { renameWithRetry, tempFilePath } from "../util";

import type { Logger } from "../logging/logger";

/**
 * POSIX shell script that wraps `coder ssh` with retry logic for the SSH
 * ProxyCommand. After sleep/wake, DNS failures cause `coder ssh` to exit
 * instantly, producing unparsable output that the Remote SSH extension
 * treats as a permanent error ("Reload Window"). Retrying with a delay
 * allows DNS to recover, including across system suspend/resume.
 *
 * Only retries when the command exits quickly (< CODER_RETRY_MIN_RUNTIME).
 */
const RETRY_SCRIPT = `#!/bin/sh
# Coder SSH ProxyCommand retry wrapper.
# Written by the Coder VS Code extension; do not edit.
max_retries=\${CODER_RETRY_MAX_RETRIES:-10}
retry_sleep=\${CODER_RETRY_SLEEP:-5}
min_runtime=\${CODER_RETRY_MIN_RUNTIME:-10}
n=0
while [ $n -lt $max_retries ]; do
    start=$(date +%s)
    "$@"
    rc=$?
    elapsed=$(($(date +%s) - start))
    [ $elapsed -ge $min_runtime ] && exit $rc
    [ $rc -eq 0 ] && exit 0
    n=$((n + 1))
    echo "coder-retry: attempt $n/$max_retries failed (rc=$rc, elapsed=\${elapsed}s)" >&2
    [ $n -lt $max_retries ] && sleep $retry_sleep
done
exit "$rc"
`;

const SCRIPT_NAME = "coder-ssh-retry.sh";

/**
 * Ensure the retry wrapper script exists on disk and return its path.
 */
export async function ensureRetryScript(
	baseDir: string,
	logger: Logger,
): Promise<string> {
	await fs.mkdir(baseDir, { recursive: true });
	const scriptPath = path.join(baseDir, SCRIPT_NAME);

	// Atomic write: temp file + rename to avoid races between concurrent
	// VS Code windows writing the same script simultaneously.
	const tmpPath = tempFilePath(scriptPath, "tmp");
	await fs.writeFile(tmpPath, RETRY_SCRIPT, { mode: 0o755 });
	try {
		await renameWithRetry(
			(src, dest) => fs.rename(src, dest),
			tmpPath,
			scriptPath,
		);
	} catch (error) {
		await fs.unlink(tmpPath).catch((unlinkErr: NodeJS.ErrnoException) => {
			if (unlinkErr.code !== "ENOENT") {
				logger.warn("Failed to clean up temp retry script", tmpPath, unlinkErr);
			}
		});
		throw new Error(`Failed to write retry script to ${scriptPath}`, {
			cause: error,
		});
	}
	return scriptPath;
}
