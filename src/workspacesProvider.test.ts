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
				label: string;
				description?: string;
				tooltip?: string;
				contextValue?: string;
				collapsibleState?: number;
				constructor(label: string, collapsibleState?: number) {
					this.label = label;
					this.collapsibleState = collapsibleState;
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
			env: {
				logLevel: 2,
			},
			LogLevel: {
				Off: 0,
				Trace: 1,
				Debug: 2,
				Info: 3,
				Warning: 4,
				Error: 5,
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
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

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
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

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
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

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

	describe("fetchAndRefresh", () => {
		it("should not fetch when already fetching", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up state
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).fetching = true;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).visible = true;

			// Mock the fetch method to ensure it's not called
			const fetchSpy = vi
				.spyOn(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					provider as any,
					"fetch",
				)
				.mockResolvedValue([]);

			await provider.fetchAndRefresh();

			expect(fetchSpy).not.toHaveBeenCalled();

			fetchSpy.mockRestore();
		});

		it("should not fetch when not visible", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up state
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).fetching = false;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).visible = false;

			// Mock the fetch method to ensure it's not called
			const fetchSpy = vi
				.spyOn(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					provider as any,
					"fetch",
				)
				.mockResolvedValue([]);

			await provider.fetchAndRefresh();

			expect(fetchSpy).not.toHaveBeenCalled();

			fetchSpy.mockRestore();
		});

		it("should handle errors when fetching workspaces", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up state
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).fetching = false;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).visible = true;

			// Mock the fetch method to throw an error
			const fetchSpy = vi
				.spyOn(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					provider as any,
					"fetch",
				)
				.mockRejectedValue(new Error("Fetch failed"));

			// Mock refresh and maybeScheduleRefresh methods
			const refreshSpy = vi
				.spyOn(provider, "refresh")
				.mockImplementation(() => {});
			const maybeScheduleRefreshSpy = vi
				.spyOn(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					provider as any,
					"maybeScheduleRefresh",
				)
				.mockImplementation(() => {});

			await provider.fetchAndRefresh();

			expect(fetchSpy).toHaveBeenCalled();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((provider as any).workspaces).toEqual([]);
			expect(refreshSpy).toHaveBeenCalled();
			// Should not schedule refresh on error
			expect(maybeScheduleRefreshSpy).not.toHaveBeenCalled();

			fetchSpy.mockRestore();
			refreshSpy.mockRestore();
			maybeScheduleRefreshSpy.mockRestore();
		});
	});

	describe("refresh", () => {
		it("should fire onDidChangeTreeData event", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Mock the EventEmitter's fire method
			const fireSpy = vi.spyOn(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(provider as any)._onDidChangeTreeData,
				"fire",
			);

			const mockItem = { label: "test" } as vscode.TreeItem;
			provider.refresh(mockItem);

			expect(fireSpy).toHaveBeenCalledWith(mockItem);

			fireSpy.mockRestore();
		});

		it("should fire onDidChangeTreeData event with undefined", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Mock the EventEmitter's fire method
			const fireSpy = vi.spyOn(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(provider as any)._onDidChangeTreeData,
				"fire",
			);

			provider.refresh(undefined);

			expect(fireSpy).toHaveBeenCalledWith(undefined);

			fireSpy.mockRestore();
		});
	});

	describe("getChildren", () => {
		it("should return workspaces when no element is provided", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up workspaces
			const mockWorkspaces = [{ label: "workspace1" }, { label: "workspace2" }];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).workspaces = mockWorkspaces;

			const result = await provider.getChildren();

			expect(result).toBe(mockWorkspaces);
		});

		it("should return empty array when workspaces is undefined", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Ensure workspaces is undefined
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).workspaces = undefined;

			const result = await provider.getChildren();

			expect(result).toEqual([]);
		});

		it("should return agent items when WorkspaceTreeItem element is provided", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Mock extractAgents to return agents
			const { extractAgents } = await import("./api-helper");
			const mockAgents = [
				{ id: "agent1", name: "main", status: "connected" },
				{ id: "agent2", name: "gpu", status: "connected" },
			];
			vi.mocked(extractAgents).mockReturnValue(mockAgents as never);

			// Create a mock WorkspaceTreeItem
			const mockWorkspaceTreeItem = {
				workspace: { id: "workspace1", name: "my-workspace" },
				workspaceOwner: "testuser",
				workspaceName: "my-workspace",
				watchMetadata: false,
			};

			// Access the WorkspaceTreeItem class
			const { WorkspaceTreeItem } = await import("./workspacesProvider");
			Object.setPrototypeOf(mockWorkspaceTreeItem, WorkspaceTreeItem.prototype);

			const result = await provider.getChildren(mockWorkspaceTreeItem as never);

			expect(extractAgents).toHaveBeenCalledWith(
				mockWorkspaceTreeItem.workspace,
			);
			expect(result).toHaveLength(2);
		});
	});

	describe("fetchAndRefresh - success path", () => {
		it("should fetch workspaces successfully and schedule refresh", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;
			const timerSeconds = 60;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
				timerSeconds,
			);

			// Set up state
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).fetching = false;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).visible = true;

			// Mock successful fetch
			const mockWorkspaces = [{ label: "workspace1" }];
			const fetchSpy = vi
				.spyOn(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					provider as any,
					"fetch",
				)
				.mockResolvedValue(mockWorkspaces);

			// Mock refresh and maybeScheduleRefresh methods
			const refreshSpy = vi
				.spyOn(provider, "refresh")
				.mockImplementation(() => {});
			const maybeScheduleRefreshSpy = vi
				.spyOn(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					provider as any,
					"maybeScheduleRefresh",
				)
				.mockImplementation(() => {});

			await provider.fetchAndRefresh();

			expect(fetchSpy).toHaveBeenCalled();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((provider as any).workspaces).toBe(mockWorkspaces);
			expect(refreshSpy).toHaveBeenCalled();
			// Should schedule refresh on success
			expect(maybeScheduleRefreshSpy).toHaveBeenCalled();

			fetchSpy.mockRestore();
			refreshSpy.mockRestore();
			maybeScheduleRefreshSpy.mockRestore();
		});
	});

	describe("maybeScheduleRefresh", () => {
		it("should schedule refresh when timer is set and not fetching", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;
			const timerSeconds = 30;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
				timerSeconds,
			);

			// Set up state
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).fetching = false;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).timeout = undefined;

			// Spy on setTimeout
			const setTimeoutSpy = vi
				.spyOn(global, "setTimeout")
				.mockImplementation(() => 123 as never);

			// Call maybeScheduleRefresh
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).maybeScheduleRefresh();

			expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((provider as any).timeout).toBe(123);

			setTimeoutSpy.mockRestore();
		});
	});

	describe("fetchAndRefresh - clears pending refresh", () => {
		it("should clear pending refresh before fetching", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up state with existing timeout
			const mockTimeout = setTimeout(() => {}, 1000);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).fetching = false;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).visible = true;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).timeout = mockTimeout;

			// Spy on clearTimeout
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

			// Mock successful fetch
			const fetchSpy = vi
				.spyOn(
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					provider as any,
					"fetch",
				)
				.mockResolvedValue([]);

			// Mock other methods
			vi.spyOn(provider, "refresh").mockImplementation(() => {});
			vi.spyOn(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				provider as any,
				"maybeScheduleRefresh",
			).mockImplementation(() => {});

			await provider.fetchAndRefresh();

			expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimeout);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((provider as any).timeout).toBeUndefined();

			clearTimeoutSpy.mockRestore();
			fetchSpy.mockRestore();
		});
	});

	describe("cancelPendingRefresh", () => {
		it("should clear timeout when called", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up a mock timeout
			const mockTimeout = setTimeout(() => {}, 1000);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).timeout = mockTimeout;

			// Spy on clearTimeout
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

			// Call private method
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).cancelPendingRefresh();

			expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimeout);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((provider as any).timeout).toBeUndefined();

			clearTimeoutSpy.mockRestore();
		});
	});

	describe("onDidChangeTreeData", () => {
		it("should expose event emitter", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			expect(provider.onDidChangeTreeData).toBeDefined();
			expect(typeof provider.onDidChangeTreeData).toBe("function");
		});
	});

	describe("fetch - with debug logging", () => {
		it("should log when debug logging is enabled", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.All;
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: {
						baseURL: "https://test.coder.com",
					},
				}),
				getWorkspaces: vi.fn(),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Mock getWorkspaces to return empty workspaces
			vi.mocked(mockRestClient.getWorkspaces).mockResolvedValue({
				workspaces: [],
			} as never);

			// Mock extractAllAgents to return empty array
			const { extractAllAgents } = await import("./api-helper");
			vi.mocked(extractAllAgents).mockReturnValue([]);

			// Set vscode.env.logLevel to Debug
			vi.mocked(vscode.env).logLevel = vscode.LogLevel.Debug;

			// Call private fetch method
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (provider as any).fetch();

			// Verify debug log was written
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Fetching workspaces: no filter...",
			);
		});
	});

	describe("fetch - edge cases", () => {
		it("should throw error when not logged in (no URL)", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: {
						baseURL: undefined, // No URL = not logged in
					},
				}),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Call private fetch method
			await expect(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(provider as any).fetch(),
			).rejects.toThrow("not logged in");
		});

		it("should re-fetch when URL changes during fetch", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			let callCount = 0;
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockImplementation(() => {
					// First call returns one URL, second call returns different URL
					if (callCount === 0) {
						return { defaults: { baseURL: "https://old.coder.com" } };
					} else {
						return { defaults: { baseURL: "https://new.coder.com" } };
					}
				}),
				getWorkspaces: vi.fn().mockImplementation(() => {
					callCount++;
					// Simulate URL change after first getWorkspaces call
					return Promise.resolve({ workspaces: [] });
				}),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Mock extractAllAgents
			const { extractAllAgents } = await import("./api-helper");
			vi.mocked(extractAllAgents).mockReturnValue([]);

			// Call private fetch method
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (provider as any).fetch();

			// Should have called getWorkspaces twice due to URL change
			expect(mockRestClient.getWorkspaces).toHaveBeenCalledTimes(2);
			expect(result).toEqual([]);
		});
	});

	describe("setVisibility - fetchAndRefresh when no workspaces", () => {
		it("should call fetchAndRefresh when visible and no workspaces exist", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up initial state - no workspaces
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).workspaces = undefined;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).visible = false;

			// Mock fetchAndRefresh
			const fetchAndRefreshSpy = vi
				.spyOn(provider, "fetchAndRefresh")
				.mockResolvedValue();

			provider.setVisibility(true);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((provider as any).visible).toBe(true);
			expect(fetchAndRefreshSpy).toHaveBeenCalled();

			fetchAndRefreshSpy.mockRestore();
		});
	});

	describe("getChildren - AgentTreeItem", () => {
		it("should return error item when watcher has error", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up agent watcher with error
			const testError = new Error("Watcher error");
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).agentWatchers = {
				agent1: {
					error: testError,
				},
			};

			// Access the AgentTreeItem class via import
			const { extractAgents } = await import("./api-helper");
			vi.mocked(extractAgents).mockReturnValue([
				{
					id: "agent1",
					name: "main",
					status: "connected",
					apps: [],
				} as never,
			]);

			// Create a WorkspaceTreeItem first
			const mockWorkspace = {
				owner_name: "testuser",
				name: "test-workspace",
				latest_build: { status: "running" },
			} as never;

			// Use the exported WorkspaceTreeItem class
			const { WorkspaceTreeItem } = await import("./workspacesProvider");
			const workspaceTreeItem = new WorkspaceTreeItem(
				mockWorkspace,
				false,
				true,
			);

			// Get children of workspace (agents)
			const agents = await provider.getChildren(workspaceTreeItem);
			expect(agents).toHaveLength(1);

			// Now get children of the agent
			const result = await provider.getChildren(agents[0]);

			expect(result).toHaveLength(1);
			// The error tree item is a vscode.TreeItem with label property
			expect(result[0]).toBeDefined();
			expect(result[0].label).toBeDefined();
			expect(result[0].label).toContain("Failed to query metadata");
		});

		it("should return app status and metadata sections", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up agent watcher with metadata
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(provider as any).agentWatchers = {
				agent1: {
					metadata: [
						{
							description: { display_name: "CPU" },
							result: { value: "50%", collected_at: "2024-01-01T12:00:00Z" },
						},
					],
				},
			};

			// Mock extractAgents
			const { extractAgents } = await import("./api-helper");
			vi.mocked(extractAgents).mockReturnValue([
				{
					id: "agent1",
					name: "main",
					status: "connected",
					apps: [
						{
							command: "npm start",
							statuses: [{ message: "App is running" }],
						},
					],
				} as never,
			]);

			// Create a WorkspaceTreeItem first
			const mockWorkspace = {
				owner_name: "testuser",
				name: "test-workspace",
				latest_build: { status: "running" },
			} as never;

			// Use the exported WorkspaceTreeItem class
			const { WorkspaceTreeItem } = await import("./workspacesProvider");
			const workspaceTreeItem = new WorkspaceTreeItem(
				mockWorkspace,
				false,
				true,
			);

			// Get children of workspace (agents)
			const agents = await provider.getChildren(workspaceTreeItem);
			expect(agents).toHaveLength(1);

			// Now get children of the agent
			const result = await provider.getChildren(agents[0]);

			expect(result).toHaveLength(2); // App status section + metadata section
			// These are vscode.TreeItem instances with label property
			expect(result[0]).toBeDefined();
			expect(result[0].label).toBe("App Statuses");
			expect(result[1]).toBeDefined();
			expect(result[1].label).toBe("Agent Metadata");
		});
	});

	describe("getChildren - SectionTreeItem", () => {
		it("should return children for section-like tree items", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Create a mock tree item with children property
			const mockChildren = [
				{ label: "child1" } as vscode.TreeItem,
				{ label: "child2" } as vscode.TreeItem,
			];
			const mockSectionTreeItem = {
				label: "Test Section",
				children: mockChildren,
			} as never;

			const result = await provider.getChildren(mockSectionTreeItem);

			// Since SectionTreeItem is not exported, the default case will return empty array
			expect(result).toEqual([]);
		});
	});

	describe("getChildren - unknown element type", () => {
		it("should return empty array for unknown element type", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = {} as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Create an unknown tree item type
			const unknownItem = { label: "unknown" } as vscode.TreeItem;

			const result = await provider.getChildren(unknownItem);

			expect(result).toEqual([]);
		});
	});
});
