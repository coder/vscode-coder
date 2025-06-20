import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import { Commands } from "./commands";
import { Remote } from "./remote";
import { Storage } from "./storage";

// Mock dependencies
vi.mock("vscode");
vi.mock("axios");
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./cliManager");
vi.mock("./commands");
vi.mock("./featureSet");
vi.mock("./headers");
vi.mock("./inbox");
vi.mock("./sshConfig");
vi.mock("./sshSupport");
vi.mock("./storage");
vi.mock("./util");
vi.mock("./workspaceMonitor");

describe("remote", () => {
	it("should create Remote instance", () => {
		const mockVscodeProposed = {} as typeof vscode;
		const mockStorage = {} as Storage;
		const mockCommands = {} as Commands;
		const mockMode = {} as vscode.ExtensionMode;

		const remote = new Remote(
			mockVscodeProposed,
			mockStorage,
			mockCommands,
			mockMode,
		);

		expect(remote).toBeInstanceOf(Remote);
	});
});
