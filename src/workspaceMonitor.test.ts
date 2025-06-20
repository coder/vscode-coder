import { Api } from "coder/site/src/api/api";
import { Workspace } from "coder/site/src/api/typesGenerated";
import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import { Storage } from "./storage";
import { WorkspaceMonitor } from "./workspaceMonitor";

// Mock dependencies
vi.mock("vscode");
vi.mock("eventsource");
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./storage");

describe("workspaceMonitor", () => {
	it("should create WorkspaceMonitor instance", () => {
		const mockWorkspace = {} as Workspace;
		const mockRestClient = {
			getAxiosInstance: vi.fn(() => ({
				defaults: { baseURL: "https://test.com" },
			})),
		} as unknown as Api;
		const mockStorage = {
			writeToCoderOutputChannel: vi.fn(),
		} as unknown as Storage;
		const mockVscodeProposed = {} as typeof vscode;

		const monitor = new WorkspaceMonitor(
			mockWorkspace,
			mockRestClient,
			mockStorage,
			mockVscodeProposed,
		);

		expect(monitor).toBeInstanceOf(WorkspaceMonitor);
		expect(typeof monitor.dispose).toBe("function");
		expect(monitor.onChange).toBeDefined();
	});
});
