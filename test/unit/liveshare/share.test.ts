import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { shareFolder } from "@/liveshare/share";

const folder = vscode.Uri.parse(
	"vscode-remote://ssh-remote+coder-vscode.test--o--w.main/project",
);
const invitation = vscode.Uri.parse(
	"https://prod.liveshare.vsengsaas.visualstudio.com/join?test-session",
);
const writeText = vi.fn().mockResolvedValue(undefined);
const share = vi.fn();
const getApi = vi.fn();
const activate = vi.fn();

function setFolders(uris: vscode.Uri[]) {
	Object.assign(vscode.workspace, {
		workspaceFolders: uris.map((uri, index) => ({
			uri,
			index,
			name: "project",
		})),
	});
}

function installMock() {
	vi.mocked(vscode.extensions.getExtension).mockReturnValue({
		activate,
	} as unknown as vscode.Extension<unknown>);
}

describe("shareFolder", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		setFolders([folder]);
		Object.assign(vscode.workspace, { isTrusted: true });
		Object.assign(vscode.env, { clipboard: { writeText } });
		vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
			"Start Sharing" as never,
		);
		vi.mocked(vscode.window.withProgress).mockImplementation((_options, task) =>
			task({ report: vi.fn() }, new vscode.CancellationTokenSource().token),
		);
		share.mockResolvedValue(invitation);
		getApi.mockResolvedValue({ share });
		activate.mockResolvedValue({ getApi });
		installMock();
	});

	it("uses an installed extension and copies the actual invitation", async () => {
		await shareFolder(folder);
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		expect(getApi).toHaveBeenCalledWith("1.0.4753", "coder.coder-remote");
		expect(share).toHaveBeenCalledOnce();
		expect(writeText).toHaveBeenCalledWith(invitation.toString());
	});

	it("installs only after sharing is confirmed", async () => {
		vi.mocked(vscode.extensions.getExtension).mockReturnValueOnce(undefined);
		await shareFolder(folder);
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"workbench.extensions.installExtension",
			"ms-vsliveshare.vsliveshare",
		);
		expect(share).toHaveBeenCalledOnce();
	});

	it("does nothing when the confirmation is dismissed", async () => {
		vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
		await shareFolder(folder);
		expect(vscode.extensions.getExtension).not.toHaveBeenCalled();
		expect(share).not.toHaveBeenCalled();
		expect(writeText).not.toHaveBeenCalled();
	});

	it("rejects an untrusted workspace", async () => {
		Object.assign(vscode.workspace, { isTrusted: false });
		await expect(shareFolder(folder)).rejects.toThrow("trusted workspace");
		expect(vscode.extensions.getExtension).not.toHaveBeenCalled();
	});

	it("rejects a different folder and multi-root workspaces", async () => {
		setFolders([vscode.Uri.parse("file:///other")]);
		await expect(shareFolder(folder)).rejects.toThrow("selected folder");
		setFolders([folder, vscode.Uri.parse("file:///other")]);
		await expect(shareFolder(folder)).rejects.toThrow("selected folder");
		expect(share).not.toHaveBeenCalled();
	});

	it("does not share a folder changed while the extension activates", async () => {
		activate.mockImplementation(() => {
			setFolders([vscode.Uri.parse("file:///other")]);
			return { getApi };
		});
		await expect(shareFolder(folder)).rejects.toThrow("workspace changed");
		expect(share).not.toHaveBeenCalled();
	});

	it("preserves installation errors without reporting success", async () => {
		vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined);
		vi.mocked(vscode.commands.executeCommand).mockRejectedValue(
			new Error("Marketplace unavailable"),
		);
		await expect(shareFolder(folder)).rejects.toThrow(
			"Marketplace unavailable",
		);
		expect(writeText).not.toHaveBeenCalled();
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it("reports an extension that is still unavailable after installation", async () => {
		vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined);
		await expect(shareFolder(folder)).rejects.toThrow(
			"Live Share is not available",
		);
	});

	it("rejects an unavailable API", async () => {
		getApi.mockResolvedValue(null);
		await expect(shareFolder(folder)).rejects.toThrow("required API");
	});

	it("does not fabricate a link when sign-in or sharing is cancelled", async () => {
		share.mockResolvedValue(null);
		await shareFolder(folder);
		expect(writeText).not.toHaveBeenCalled();
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			expect.stringContaining("not started"),
		);
	});

	it("propagates sharing failures", async () => {
		share.mockRejectedValue(new Error("Live Share service unavailable"));
		await expect(shareFolder(folder)).rejects.toThrow(
			"Live Share service unavailable",
		);
		expect(writeText).not.toHaveBeenCalled();
	});

	it("waits for the remote filesystem and preserves connection errors", async () => {
		vi.mocked(vscode.workspace.fs.stat).mockRejectedValue(
			new Error("SSH disconnected"),
		);
		await expect(shareFolder(folder)).rejects.toThrow("SSH disconnected");
		expect(share).not.toHaveBeenCalled();
	});
});
