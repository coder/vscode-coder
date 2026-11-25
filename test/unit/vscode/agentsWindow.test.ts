import { afterEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";

import { isAgentsWindow } from "@/vscode/agentsWindow";

const mockWorkspace = vscode.workspace as typeof vscode.workspace & {
	workspaceFile: vscode.Uri | undefined;
};

describe("isAgentsWindow", () => {
	afterEach(() => {
		mockWorkspace.workspaceFile = undefined;
	});

	it.each([
		["/home/me/.config/Code/User/agent-sessions.code-workspace"],
		[
			"/c:/Users/me/AppData/Roaming/Code - Insiders/User/agent-sessions.code-workspace",
		],
	])("detects the Agents window workspace at %s", (path) => {
		mockWorkspace.workspaceFile = vscode.Uri.file(path);
		expect(isAgentsWindow()).toBe(true);
	});

	it.each([
		["no workspace file", undefined],
		[
			"another workspace",
			vscode.Uri.file("/home/me/project/app.code-workspace"),
		],
		[
			"a remote file with the same name",
			vscode.Uri.from({
				scheme: "vscode-remote",
				path: "/home/me/agent-sessions.code-workspace",
			}),
		],
	])("is false for %s", (_label, workspaceFile) => {
		mockWorkspace.workspaceFile = workspaceFile;
		expect(isAgentsWindow()).toBe(false);
	});
});
