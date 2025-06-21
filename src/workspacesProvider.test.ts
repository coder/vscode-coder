import { Api } from "coder/site/src/api/api";
import { describe, it, expect, vi, beforeAll } from "vitest";
import * as vscode from "vscode";
import { Storage } from "./storage";
import { WorkspaceProvider, WorkspaceQuery } from "./workspacesProvider";

// Mock dependencies
vi.mock("eventsource");
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./storage");

beforeAll(() => {
	vi.mock("vscode", () => {
		return {
			TreeItem: class MockTreeItem {
				constructor() {
					// Mock implementation
				}
			},
			TreeItemCollapsibleState: {
				None: 0,
				Collapsed: 1,
				Expanded: 2,
			},
			EventEmitter: class MockEventEmitter {
				fire = vi.fn();
				event = vi.fn();
				dispose = vi.fn();
			},
		};
	});
});

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

	describe("setVisibility", () => {
		it("should set visibility to false and cancel pending refresh", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {} as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up initial state - simulate having a timeout
			const mockTimeout = setTimeout(() => {}, 1000);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).timeout = mockTimeout;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).visible = true;

			// Spy on clearTimeout to verify it's called
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

			provider.setVisibility(false);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((provider as any).visible).toBe(false);
			expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimeout);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((provider as any).timeout).toBeUndefined();

			clearTimeoutSpy.mockRestore();
		});

		it("should set visibility to true when workspaces exist", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {} as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up initial state - simulate having workspaces
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).workspaces = [{ label: "test-workspace" }];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).visible = false;

			// Mock the maybeScheduleRefresh method
			const maybeScheduleRefreshSpy = vi
				.spyOn(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					provider as any,
					"maybeScheduleRefresh",
				)
				.mockImplementation(() => {});

			provider.setVisibility(true);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((provider as any).visible).toBe(true);
			expect(maybeScheduleRefreshSpy).toHaveBeenCalled();

			maybeScheduleRefreshSpy.mockRestore();
		});
	});

	describe("getTreeItem", () => {
		it("should return the same element passed to it", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {} as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			const mockTreeItem = {
				label: "test-item",
				description: "Test description",
			} as vscode.TreeItem;

			const result = provider.getTreeItem(mockTreeItem);

			expect(result).toBe(mockTreeItem);
		});
	});
});
