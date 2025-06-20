import { Api } from "coder/site/src/api/api";
import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import { Commands } from "./commands";
import { Storage } from "./storage";

// Mock dependencies
vi.mock("vscode");
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./error");
vi.mock("./storage");
vi.mock("./util");
vi.mock("./workspacesProvider");

describe("commands", () => {
	it("should create Commands instance", () => {
		const mockVscodeProposed = {} as typeof vscode;
		const mockRestClient = {} as Api;
		const mockStorage = {} as Storage;

		const commands = new Commands(
			mockVscodeProposed,
			mockRestClient,
			mockStorage,
		);

		expect(commands).toBeInstanceOf(Commands);
		expect(commands.workspace).toBeUndefined();
		expect(commands.workspaceLogPath).toBeUndefined();
		expect(commands.workspaceRestClient).toBeUndefined();
	});
});
