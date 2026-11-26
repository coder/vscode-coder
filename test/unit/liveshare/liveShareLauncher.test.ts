import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { LiveShareLauncher } from "@/liveshare/liveShareLauncher";
import { shareFolder } from "@/liveshare/share";

import { InMemorySecretStorage } from "../../mocks/testHelpers";

vi.mock("@/liveshare/share", () => ({ shareFolder: vi.fn() }));

const folder = vscode.Uri.parse(
	"vscode-remote://ssh-remote+coder-vscode.test--o--w.main/project",
);
let directory: string;
let launcher: LiveShareLauncher;
let secrets: InMemorySecretStorage;

function select(uri: vscode.Uri) {
	Object.assign(vscode.workspace, {
		workspaceFolders: [{ uri, index: 0, name: "project" }],
	});
	Object.assign(vscode.env, { remoteAuthority: uri.authority });
}

beforeEach(async () => {
	vi.resetAllMocks();
	directory = await mkdtemp(path.join(os.tmpdir(), "coder-live-share-"));
	secrets = new InMemorySecretStorage();
	launcher = new LiveShareLauncher(directory, secrets);
	select(folder);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(directory, { recursive: true, force: true });
});

describe("LiveShareLauncher", () => {
	it("consumes a request once across extension-host instances", async () => {
		await launcher.prepare(folder);
		const reopened = new LiveShareLauncher(directory, secrets);
		await reopened.consume();
		await reopened.consume();
		expect(shareFolder).toHaveBeenCalledExactlyOnceWith(folder);
		expect(await readdir(path.join(directory, "live-share"))).toEqual([]);
	});

	it("does not share an ordinary open with no request", async () => {
		await launcher.consume();
		expect(shareFolder).not.toHaveBeenCalled();
	});

	it("does not let two matching windows consume the same request", async () => {
		await launcher.prepare(folder);
		await Promise.all([
			launcher.consume(),
			new LiveShareLauncher(directory, secrets).consume(),
		]);
		expect(shareFolder).toHaveBeenCalledOnce();
	});

	it("leaves a request for the matching folder and authority", async () => {
		await launcher.prepare(folder);
		for (const uri of [
			folder.with({ path: "/other" }),
			folder.with({ authority: "ssh-remote+another" }),
			vscode.Uri.file("/project"),
		]) {
			select(uri);
			await launcher.consume();
		}
		expect(shareFolder).not.toHaveBeenCalled();
		select(folder);
		await launcher.consume();
		expect(shareFolder).toHaveBeenCalledOnce();
	});

	it("rejects expired requests without replay on the next open", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1000);
		await launcher.prepare(folder);
		now.mockReturnValue(301001);
		await expect(launcher.consume()).rejects.toThrow("expired");
		await launcher.consume();
		expect(shareFolder).not.toHaveBeenCalled();
	});

	it("does not replay a failed sharing operation", async () => {
		await launcher.prepare(folder);
		vi.mocked(shareFolder).mockRejectedValue(new Error("connection lost"));
		await expect(launcher.consume()).rejects.toThrow("connection lost");
		await launcher.consume();
		expect(shareFolder).toHaveBeenCalledOnce();
	});

	it("stores neither a session token nor the invitation link", async () => {
		await launcher.prepare(folder);
		const [file] = await readdir(path.join(directory, "live-share"));
		expect(
			JSON.parse(
				await readFile(path.join(directory, "live-share", file), "utf8"),
			),
		).toEqual({ createdAt: expect.any(Number) });
	});

	it("handles a request that existed before receiver activation", async () => {
		await launcher.prepare(folder);
		const receiver = launcher.start();
		await vi.waitFor(() => expect(shareFolder).toHaveBeenCalledOnce());
		receiver.dispose();
	});

	it("notifies an already-open matching window", async () => {
		const receiver = launcher.start();
		await launcher.prepare(folder);
		await vi.waitFor(() => expect(shareFolder).toHaveBeenCalledOnce());
		receiver.dispose();
	});
});
