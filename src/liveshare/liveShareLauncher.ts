import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { z } from "zod";

import { errToStr } from "../error/normalize";
import { vscodeProposed } from "../vscode/proposed";

import { shareFolder } from "./share";

const NOTIFICATION_KEY = "coder.liveShare.request";
const MAX_AGE_MS = 5 * 60 * 1000;
const PendingRequest = z.object({ createdAt: z.number().finite() });

/** Carry a one-shot request across the extension-host restart when opening SSH. */
export class LiveShareLauncher {
	private busy = false;
	private readonly directory: string;

	constructor(
		storagePath: string,
		private readonly secrets: vscode.SecretStorage,
	) {
		this.directory = path.join(storagePath, "live-share");
	}

	async prepare(folder: vscode.Uri): Promise<void> {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const temporary = path.join(this.directory, randomUUID());
		await writeFile(temporary, JSON.stringify({ createdAt: Date.now() }), {
			mode: 0o600,
		});
		await rename(temporary, this.requestPath(folder));
		await this.secrets.store(NOTIFICATION_KEY, randomUUID());
	}

	start(): vscode.Disposable {
		let checks = Promise.resolve();
		const check = () => {
			checks = checks
				.then(() => this.consume())
				.catch((error: unknown) => {
					void vscode.window.showErrorMessage(
						`Unable to start Live Share: ${errToStr(error)}`,
					);
				});
		};
		const listener = this.secrets.onDidChange((event) => {
			if (event.key === NOTIFICATION_KEY) check();
		});
		const folders = vscode.workspace.onDidChangeWorkspaceFolders(check);
		check();
		return {
			dispose: () => {
				listener.dispose();
				folders.dispose();
			},
		};
	}

	async consume(): Promise<void> {
		const folders = vscode.workspace.workspaceFolders;
		if (this.busy || folders?.length !== 1) return;
		const folder = folders[0].uri;
		if (
			folder.scheme !== "vscode-remote" ||
			folder.authority !== vscodeProposed.env.remoteAuthority
		)
			return;
		this.busy = true;
		try {
			const claimed = path.join(this.directory, randomUUID());
			try {
				// Atomic rename ensures only one matching window consumes a request.
				await rename(this.requestPath(folder), claimed);
			} catch (error) {
				if (
					error instanceof Error &&
					"code" in error &&
					error.code === "ENOENT"
				)
					return;
				throw error;
			}
			let request: z.infer<typeof PendingRequest>;
			try {
				request = PendingRequest.parse(
					JSON.parse(await readFile(claimed, "utf8")),
				);
			} finally {
				await unlink(claimed);
			}
			const age = Date.now() - request.createdAt;
			if (age < 0 || age > MAX_AGE_MS) {
				throw new Error(
					"The Live Share request expired. Click Open Liveshare again.",
				);
			}
			await shareFolder(folder);
		} finally {
			this.busy = false;
		}
	}

	private requestPath(folder: vscode.Uri): string {
		const key = createHash("sha256").update(folder.toString()).digest("hex");
		return path.join(this.directory, `${key}.json`);
	}
}
