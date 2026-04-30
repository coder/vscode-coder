import { type ExecFileException, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";

import { isAbortError, toError } from "../error/errorUtils";
import {
	type CliAuth,
	getGlobalFlags,
	getGlobalShellFlags,
} from "../settings/cli";
import { escapeCommandArg } from "../util";

/** Resolved CLI environment for invoking the coder binary. */
export interface CliEnv {
	binary: string;
	auth: CliAuth;
	configs: Pick<vscode.WorkspaceConfiguration, "get">;
	/** Forwarded to the child as `CODER_URL` / `CODER_SESSION_TOKEN`. Empty token is valid for mTLS. */
	authEnv: { url: string; token: string };
}

const execFileAsync = promisify(execFile);

function buildChildEnv(env: CliEnv): NodeJS.ProcessEnv {
	return {
		...process.env,
		CODER_URL: env.authEnv.url,
		CODER_SESSION_TOKEN: env.authEnv.token,
	};
}

function isExecFileException(error: unknown): error is ExecFileException {
	return error instanceof Error && "code" in error;
}

/** Prefer stderr over the default message which includes the full command line. */
function cliError(error: unknown): Error {
	// Pass aborts through; wrapping erases the AbortError name and would surface stale CLI warnings as the failure.
	if (isAbortError(error)) {
		return error;
	}
	if (isExecFileException(error)) {
		const stderr = error.stderr?.trim();
		if (stderr) {
			return new Error(stderr, { cause: error });
		}
	}
	return toError(error);
}

/**
 * Return the version from the binary.  Throw if unable to execute the binary or
 * find the version for any reason.
 */
export async function version(binPath: string): Promise<string> {
	let stdout: string;
	try {
		const result = await execFileAsync(binPath, [
			"version",
			"--output",
			"json",
		]);
		stdout = result.stdout;
	} catch (error) {
		// It could be an old version without support for --output.
		if (
			isExecFileException(error) &&
			error.stderr?.includes("unknown flag: --output")
		) {
			const result = await execFileAsync(binPath, ["version"]);
			if (result.stdout?.startsWith("Coder")) {
				const v = result.stdout.split(" ")[1]?.trim();
				if (!v) {
					throw new Error(`No version found in output: ${result.stdout}`, {
						cause: error,
					});
				}
				return v;
			}
		}
		throw cliError(error);
	}

	const json = JSON.parse(stdout) as { version?: string };
	if (!json.version) {
		throw new Error(`No version found in output: ${stdout}`);
	}
	return json.version;
}

/**
 * Run `coder speedtest` and return the raw JSON output.
 */
export async function speedtest(
	env: CliEnv,
	workspaceName: string,
	duration?: string,
	signal?: AbortSignal,
): Promise<string> {
	const globalFlags = getGlobalFlags(env.configs, env.auth);
	const args = [...globalFlags, "speedtest", workspaceName, "--output", "json"];
	if (duration) {
		args.push("-t", duration);
	}
	try {
		const result = await execFileAsync(env.binary, args, {
			signal,
			env: buildChildEnv(env),
		});
		return result.stdout;
	} catch (error) {
		throw cliError(error);
	}
}

/**
 * Run `coder support bundle` and save the output zip to the given path.
 */
export async function supportBundle(
	env: CliEnv,
	workspaceName: string,
	outputPath: string,
	signal?: AbortSignal,
): Promise<void> {
	const globalFlags = getGlobalFlags(env.configs, env.auth);
	const args = [
		...globalFlags,
		"support",
		"bundle",
		workspaceName,
		"--output-file",
		outputPath,
		"--yes",
	];
	try {
		await execFileAsync(env.binary, args, {
			signal,
			env: buildChildEnv(env),
		});
	} catch (error) {
		throw cliError(error);
	}
}

/**
 * Run `coder ping` in a PTY terminal with Ctrl+C support.
 */
export function ping(env: CliEnv, workspaceName: string): vscode.Terminal {
	const globalFlags = getGlobalShellFlags(env.configs, env.auth);
	return spawnCliInTerminal({
		name: `Coder Ping: ${workspaceName}`,
		binary: env.binary,
		args: [...globalFlags, "ping", escapeCommandArg(workspaceName)],
		banner: ["Press Ctrl+C (^C) to stop.", "─".repeat(40)],
		env: buildChildEnv(env),
	});
}

/**
 * Spawn a CLI command in a PTY terminal with process lifecycle management.
 */
function spawnCliInTerminal(options: {
	name: string;
	binary: string;
	args: string[];
	banner: string[];
	env: NodeJS.ProcessEnv;
}): vscode.Terminal {
	const writeEmitter = new vscode.EventEmitter<string>();
	const closeEmitter = new vscode.EventEmitter<number | void>();

	const cmd = `${escapeCommandArg(options.binary)} ${options.args.join(" ")}`;
	// On Unix, spawn in a new process group so we can signal the
	// entire group (shell + coder binary) on Ctrl+C. On Windows,
	// detached opens a visible console window and negative-PID kill
	// is unsupported, so we fall back to proc.kill().
	const useProcessGroup = process.platform !== "win32";
	const proc = spawn(cmd, {
		shell: true,
		detached: useProcessGroup,
		env: options.env,
	});

	let closed = false;
	let exited = false;
	let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

	const sendSignal = (sig: "SIGINT" | "SIGKILL") => {
		try {
			if (useProcessGroup && proc.pid) {
				process.kill(-proc.pid, sig);
			} else {
				proc.kill(sig);
			}
		} catch {
			// Process already exited.
		}
	};

	const gracefulKill = () => {
		sendSignal("SIGINT");
		// Escalate to SIGKILL if the process doesn't exit promptly.
		forceKillTimer = setTimeout(() => sendSignal("SIGKILL"), 5000);
	};

	const terminal = vscode.window.createTerminal({
		name: options.name,
		pty: {
			onDidWrite: writeEmitter.event,
			onDidClose: closeEmitter.event,
			open: () => {
				if (options.banner) {
					for (const line of options.banner) {
						writeEmitter.fire(line + "\r\n");
					}
				}
			},
			close: () => {
				closed = true;
				clearTimeout(forceKillTimer);
				sendSignal("SIGKILL");
				writeEmitter.dispose();
				closeEmitter.dispose();
			},
			handleInput: (data: string) => {
				if (exited) {
					closeEmitter.fire();
				} else if (data === "\x03") {
					if (forceKillTimer) {
						// Second Ctrl+C: force kill immediately.
						clearTimeout(forceKillTimer);
						sendSignal("SIGKILL");
					} else {
						if (!closed) {
							writeEmitter.fire("\r\nStopping...\r\n");
						}
						gracefulKill();
					}
				}
			},
		},
	});

	const fireLines = (data: Buffer) => {
		if (closed) {
			return;
		}
		const lines = data
			.toString()
			.split(/\r*\n/)
			.filter((line) => line !== "");
		for (const line of lines) {
			writeEmitter.fire(line + "\r\n");
		}
	};

	proc.stdout?.on("data", fireLines);
	proc.stderr?.on("data", fireLines);
	proc.on("error", (err) => {
		exited = true;
		clearTimeout(forceKillTimer);
		if (closed) {
			return;
		}
		writeEmitter.fire(`\r\nFailed to start: ${err.message}\r\n`);
		writeEmitter.fire("Press any key to close.\r\n");
	});
	proc.on("close", (code, signal) => {
		exited = true;
		clearTimeout(forceKillTimer);
		if (closed) {
			return;
		}
		let reason: string;
		if (signal === "SIGKILL") {
			reason = "Process force killed (SIGKILL)";
		} else if (signal) {
			reason = "Process stopped";
		} else {
			reason = `Process exited with code ${code}`;
		}
		writeEmitter.fire(`\r\n${reason}. Press any key to close.\r\n`);
	});

	terminal.show(false);
	return terminal;
}

/**
 * SSH into a workspace and run a command via `terminal.sendText`.
 */
export async function openAppStatusTerminal(
	env: CliEnv,
	app: {
		name?: string;
		command?: string;
		workspace_name: string;
	},
): Promise<void> {
	const globalFlags = getGlobalShellFlags(env.configs, env.auth);
	const terminal = vscode.window.createTerminal({
		name: app.name,
		env: buildChildEnv(env),
	});
	terminal.sendText(
		`${escapeCommandArg(env.binary)} ${globalFlags.join(" ")} ssh ${escapeCommandArg(app.workspace_name)}`,
	);
	await new Promise((resolve) => setTimeout(resolve, 5000));
	terminal.sendText(app.command ?? "");
	terminal.show(false);
}
