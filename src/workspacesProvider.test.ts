import { Api } from "coder/site/src/api/api";
import { describe, it, expect, vi } from "vitest";
import { Storage } from "./storage";
import { WorkspaceProvider, WorkspaceQuery } from "./workspacesProvider";

// Mock dependencies
vi.mock("vscode");
vi.mock("eventsource");
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./storage");

describe("workspacesProvider", () => {
	it("should export WorkspaceQuery enum", () => {
		expect(WorkspaceQuery.Mine).toBe("owner:me");
		expect(WorkspaceQuery.All).toBe("");
	});

	it("should create WorkspaceProvider instance", () => {
		const mockWorkspaceQuery = WorkspaceQuery.Mine;
		const mockRestClient = {} as Api;
		const mockStorage = {} as Storage;

		const provider = new WorkspaceProvider(
			mockWorkspaceQuery,
			mockRestClient,
			mockStorage,
		);

		expect(provider).toBeInstanceOf(WorkspaceProvider);
	});
});
