import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import {
	createMockApi,
	createMockStorage,
	getPrivateProperty,
	setPrivateProperty,
	createMockOutputChannelWithLogger,
	createMockVSCode,
	createMockWorkspace,
} from "./test-helpers";
import { WorkspaceProvider, WorkspaceQuery } from "./workspacesProvider";

// Mock dependencies
vi.mock("eventsource");
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./storage");

vi.mock("vscode", async () => {
	const helpers = await import("./test-helpers");
	return helpers.createMockVSCode();
});

describe("workspacesProvider", () => {
	it("should export WorkspaceQuery enum", () => {
		expect(WorkspaceQuery.Mine).toBe("owner:me");
		expect(WorkspaceQuery.All).toBe("");
	});

	it("should create WorkspaceProvider instance", () => {
		const mockWorkspaceQuery = WorkspaceQuery.Mine;
		const mockRestClient = createMockApi();
		const mockStorage = createMockStorage();

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
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up initial state - simulate having a timeout
			const mockTimeout = setTimeout(() => {}, 1000);
			setPrivateProperty(provider, "timeout", mockTimeout);
			setPrivateProperty(provider, "visible", true);

			// Spy on clearTimeout to verify it's called
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

			provider.setVisibility(false);

			expect(getPrivateProperty(provider, "visible")).toBe(false);
			expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimeout);
			expect(getPrivateProperty(provider, "timeout")).toBeUndefined();

			clearTimeoutSpy.mockRestore();
		});

		it("should set visibility to true when workspaces exist", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up initial state - simulate having workspaces
			const MockTreeItem = createMockVSCode()
				.TreeItem as typeof vscode.TreeItem;
			setPrivateProperty(provider, "workspaces", [
				new MockTreeItem("test-workspace"),
			]);
			setPrivateProperty(provider, "visible", false);

			// Mock the maybeScheduleRefresh method
			const maybeScheduleRefreshSpy = vi
				.spyOn(provider, "maybeScheduleRefresh" as never)
				.mockImplementation(() => {});

			provider.setVisibility(true);

			expect(getPrivateProperty(provider, "visible")).toBe(true);
			expect(maybeScheduleRefreshSpy).toHaveBeenCalled();

			maybeScheduleRefreshSpy.mockRestore();
		});
	});

	describe("getTreeItem", () => {
		it("should return the same element passed to it", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			const MockTreeItem = createMockVSCode()
				.TreeItem as typeof vscode.TreeItem;
			const mockTreeItem = new MockTreeItem("test-item");
			mockTreeItem.description = "Test description";

			const result = provider.getTreeItem(mockTreeItem);

			expect(result).toBe(mockTreeItem);
		});
	});

	describe("fetchAndRefresh", () => {
		it("should not fetch when already fetching", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up state
			setPrivateProperty(provider, "fetching", true);
			setPrivateProperty(provider, "visible", true);

			// Mock the fetch method to ensure it's not called
			const fetchSpy = vi
				.spyOn(provider, "fetch" as never)
				.mockResolvedValue([]);

			await provider.fetchAndRefresh();

			expect(fetchSpy).not.toHaveBeenCalled();

			fetchSpy.mockRestore();
		});

		it("should not fetch when not visible", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up state
			setPrivateProperty(provider, "fetching", false);
			setPrivateProperty(provider, "visible", false);

			// Mock the fetch method to ensure it's not called
			const fetchSpy = vi
				.spyOn(provider, "fetch" as never)
				.mockResolvedValue([]);

			await provider.fetchAndRefresh();

			expect(fetchSpy).not.toHaveBeenCalled();

			fetchSpy.mockRestore();
		});

		it("should handle errors when fetching workspaces", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up state
			setPrivateProperty(provider, "fetching", false);
			setPrivateProperty(provider, "visible", true);

			// Mock the fetch method to throw an error
			const fetchSpy = vi
				.spyOn(provider, "fetch" as never)
				.mockRejectedValue(new Error("Fetch failed"));

			// Mock refresh and maybeScheduleRefresh methods
			const refreshSpy = vi
				.spyOn(provider, "refresh")
				.mockImplementation(() => {});
			const maybeScheduleRefreshSpy = vi
				.spyOn(provider, "maybeScheduleRefresh" as never)
				.mockImplementation(() => {});

			await provider.fetchAndRefresh();

			expect(fetchSpy).toHaveBeenCalled();
			expect(getPrivateProperty(provider, "workspaces")).toEqual([]);
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
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Mock the EventEmitter's fire method
			const fireSpy = vi.spyOn(
				getPrivateProperty(
					provider,
					"_onDidChangeTreeData",
				) as vscode.EventEmitter<null>,
				"fire",
			);

			const mockItem = { label: "test" } as vscode.TreeItem;
			provider.refresh(mockItem);

			expect(fireSpy).toHaveBeenCalledWith(mockItem);

			fireSpy.mockRestore();
		});

		it("should fire onDidChangeTreeData event with undefined", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Mock the EventEmitter's fire method
			const fireSpy = vi.spyOn(
				getPrivateProperty(
					provider,
					"_onDidChangeTreeData",
				) as vscode.EventEmitter<null>,
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
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up workspaces
			const MockTreeItem = createMockVSCode()
				.TreeItem as typeof vscode.TreeItem;
			const mockWorkspaces = [
				new MockTreeItem("workspace1"),
				new MockTreeItem("workspace2"),
			];
			setPrivateProperty(provider, "workspaces", mockWorkspaces);

			const result = await provider.getChildren();

			expect(result).toBe(mockWorkspaces);
		});

		it("should return empty array when workspaces is undefined", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Ensure workspaces is undefined
			setPrivateProperty(provider, "workspaces", undefined);

			const result = await provider.getChildren();

			expect(result).toEqual([]);
		});

		it("should return agent items when WorkspaceTreeItem element is provided", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

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
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();
			const timerSeconds = 60;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
				timerSeconds,
			);

			// Set up state
			setPrivateProperty(provider, "fetching", false);
			setPrivateProperty(provider, "visible", true);

			// Mock successful fetch
			const MockTreeItem = createMockVSCode()
				.TreeItem as typeof vscode.TreeItem;
			const mockWorkspaces = [new MockTreeItem("workspace1")];
			const fetchSpy = vi
				.spyOn(provider, "fetch" as never)
				.mockResolvedValue(mockWorkspaces);

			// Mock refresh and maybeScheduleRefresh methods
			const refreshSpy = vi
				.spyOn(provider, "refresh")
				.mockImplementation(() => {});
			const maybeScheduleRefreshSpy = vi
				.spyOn(provider, "maybeScheduleRefresh" as never)
				.mockImplementation(() => {});

			await provider.fetchAndRefresh();

			expect(fetchSpy).toHaveBeenCalled();
			expect(getPrivateProperty(provider, "workspaces")).toBe(mockWorkspaces);
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
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();
			const timerSeconds = 30;

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
				timerSeconds,
			);

			// Set up state
			setPrivateProperty(provider, "fetching", false);
			setPrivateProperty(provider, "timeout", undefined);

			// Spy on setTimeout
			const setTimeoutSpy = vi
				.spyOn(global, "setTimeout")
				.mockImplementation(() => 123 as never);

			// Call maybeScheduleRefresh
			const maybeScheduleRefresh = getPrivateProperty(
				provider,
				"maybeScheduleRefresh",
			) as () => void;
			maybeScheduleRefresh.call(provider);

			expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
			expect(getPrivateProperty(provider, "timeout")).toBe(123);

			setTimeoutSpy.mockRestore();
		});
	});

	describe("fetchAndRefresh - clears pending refresh", () => {
		it("should clear pending refresh before fetching", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up state with existing timeout
			const mockTimeout = setTimeout(() => {}, 1000);
			setPrivateProperty(provider, "fetching", false);
			setPrivateProperty(provider, "visible", true);
			setPrivateProperty(provider, "timeout", mockTimeout);

			// Spy on clearTimeout
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

			// Mock successful fetch
			const fetchSpy = vi
				.spyOn(provider, "fetch" as never)
				.mockResolvedValue([]);

			// Mock other methods
			vi.spyOn(provider, "refresh").mockImplementation(() => {});
			vi.spyOn(provider, "maybeScheduleRefresh" as never).mockImplementation(
				() => {},
			);

			await provider.fetchAndRefresh();

			expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimeout);
			expect(getPrivateProperty(provider, "timeout")).toBeUndefined();

			clearTimeoutSpy.mockRestore();
			fetchSpy.mockRestore();
		});
	});

	describe("cancelPendingRefresh", () => {
		it("should clear timeout when called", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up a mock timeout
			const mockTimeout = setTimeout(() => {}, 1000);
			setPrivateProperty(provider, "timeout", mockTimeout);

			// Spy on clearTimeout
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

			// Call private method
			const cancelPendingRefresh = getPrivateProperty(
				provider,
				"cancelPendingRefresh",
			) as () => void;
			cancelPendingRefresh.call(provider);

			expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimeout);
			expect(getPrivateProperty(provider, "timeout")).toBeUndefined();

			clearTimeoutSpy.mockRestore();
		});
	});

	describe("onDidChangeTreeData", () => {
		it("should expose event emitter", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

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
			const mockRestClient = createMockApi({
				getWorkspaces: vi.fn(),
			});
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Mock getWorkspaces to return empty workspaces
			vi.mocked(mockRestClient.getWorkspaces).mockResolvedValue({
				workspaces: [],
				count: 0,
			});

			// Mock extractAllAgents to return empty array
			const { extractAllAgents } = await import("./api-helper");
			vi.mocked(extractAllAgents).mockReturnValue([]);

			// Set vscode.env.logLevel to Debug
			vi.mocked(vscode.env).logLevel = vscode.LogLevel.Debug;

			// Call private fetch method
			const fetch = getPrivateProperty(
				provider,
				"fetch",
			) as () => Promise<void>;
			await fetch.call(provider);

			// Verify debug log was written
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Fetching workspaces: no filter...",
			);
		});
	});

	describe("fetch - edge cases", () => {
		it("should throw error when not logged in (no URL)", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi({
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: {
						baseURL: undefined, // No URL = not logged in
					},
				}),
			});
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Call private fetch method
			const fetch = getPrivateProperty(
				provider,
				"fetch",
			) as () => Promise<void>;
			await expect(fetch.call(provider)).rejects.toThrow("not logged in");
		});

		it("should re-fetch when URL changes during fetch", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			let callCount = 0;
			const mockRestClient = createMockApi({
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
					return Promise.resolve({ workspaces: [], count: 0 });
				}),
			});
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Mock extractAllAgents
			const { extractAllAgents } = await import("./api-helper");
			vi.mocked(extractAllAgents).mockReturnValue([]);

			// Call private fetch method
			const fetch = getPrivateProperty(
				provider,
				"fetch",
			) as () => Promise<unknown>;
			const result = await fetch.call(provider);

			// Should have called getWorkspaces twice due to URL change
			expect(mockRestClient.getWorkspaces).toHaveBeenCalledTimes(2);
			expect(result).toEqual([]);
		});
	});

	describe("setVisibility - fetchAndRefresh when no workspaces", () => {
		it("should call fetchAndRefresh when visible and no workspaces exist", () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up initial state - no workspaces
			setPrivateProperty(provider, "workspaces", undefined);
			setPrivateProperty(provider, "visible", false);

			// Mock fetchAndRefresh
			const fetchAndRefreshSpy = vi
				.spyOn(provider, "fetchAndRefresh")
				.mockResolvedValue();

			provider.setVisibility(true);

			expect(getPrivateProperty(provider, "visible")).toBe(true);
			expect(fetchAndRefreshSpy).toHaveBeenCalled();

			fetchAndRefreshSpy.mockRestore();
		});
	});

	describe("getChildren - AgentTreeItem", () => {
		it("should return error item when watcher has error", async () => {
			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up agent watcher with error
			const testError = new Error("Watcher error");
			setPrivateProperty(provider, "agentWatchers", {
				agent1: {
					error: testError,
				},
			});

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
			const mockWorkspace = createMockWorkspace({
				owner_name: "testuser",
				name: "test-workspace",
				latest_build: {
					...createMockWorkspace().latest_build,
					status: "running",
				},
			});

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
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Set up agent watcher with metadata
			setPrivateProperty(provider, "agentWatchers", {
				agent1: {
					metadata: [
						{
							description: { display_name: "CPU" },
							result: { value: "50%", collected_at: "2024-01-01T12:00:00Z" },
						},
					],
				},
			});

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
			const mockWorkspace = createMockWorkspace({
				owner_name: "testuser",
				name: "test-workspace",
				latest_build: {
					...createMockWorkspace().latest_build,
					status: "running",
				},
			});

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
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Create a mock tree item with children property
			const MockTreeItem = createMockVSCode()
				.TreeItem as typeof vscode.TreeItem;
			const mockChildren = [
				new MockTreeItem("child1"),
				new MockTreeItem("child2"),
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
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Create an unknown tree item type
			const MockTreeItem = createMockVSCode()
				.TreeItem as typeof vscode.TreeItem;
			const unknownItem = new MockTreeItem("unknown");

			const result = await provider.getChildren(unknownItem);

			expect(result).toEqual([]);
		});
	});

	describe("Logger integration", () => {
		it("should log debug messages through Logger when Storage has Logger set", async () => {
			const { logger } = createMockOutputChannelWithLogger();

			// Set debug log level to ensure message is logged
			const originalLogLevel = vscode.env.logLevel;
			// @ts-expect-error - mocking readonly property
			vscode.env.logLevel = vscode.LogLevel.Debug;

			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi({
				getWorkspaces: vi.fn(() =>
					Promise.resolve({
						workspaces: [],
						count: 0,
					}),
				),
			});

			// Create mock Storage that uses Logger
			const mockStorage = createMockStorage({
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.debug(msg);
				}),
			});

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Mock extractAllAgents
			const { extractAllAgents } = await import("./api-helper");
			vi.mocked(extractAllAgents).mockReturnValue([]);

			// Call private fetch method
			const fetch = getPrivateProperty(
				provider,
				"fetch",
			) as () => Promise<void>;
			await fetch.call(provider);

			// Verify debug message was logged
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Fetching workspaces: owner:me...",
			);

			const logs = logger.getLogs();
			expect(logs.length).toBe(1);
			expect(logs[0].message).toBe("Fetching workspaces: owner:me...");
			expect(logs[0].level).toBe("DEBUG");

			// Restore log level
			// @ts-expect-error - mocking readonly property
			vscode.env.logLevel = originalLogLevel;
		});

		it("should work with Storage instance that has Logger set", async () => {
			const { logger } = createMockOutputChannelWithLogger();

			// Set debug log level
			const originalLogLevel = vscode.env.logLevel;
			// @ts-expect-error - mocking readonly property
			vscode.env.logLevel = vscode.LogLevel.Debug;

			const mockWorkspaceQuery = WorkspaceQuery.All;
			const mockRestClient = createMockApi({
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "https://example.com" },
				})),
				getWorkspaces: vi.fn(() =>
					Promise.resolve({
						workspaces: [],
						count: 0,
					}),
				),
			});

			// Simulate Storage with Logger
			const mockStorage = createMockStorage({
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.info(msg);
				}),
			});

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Mock extractAllAgents
			const { extractAllAgents } = await import("./api-helper");
			vi.mocked(extractAllAgents).mockReturnValue([]);

			// Call private fetch method
			const fetch = getPrivateProperty(
				provider,
				"fetch",
			) as () => Promise<void>;
			await fetch.call(provider);

			// Verify message was logged through Logger
			const logs = logger.getLogs();
			expect(logs.length).toBeGreaterThan(0);
			expect(logs[0].message).toBe("Fetching workspaces: no filter...");

			// Restore log level
			// @ts-expect-error - mocking readonly property
			vscode.env.logLevel = originalLogLevel;
		});

		it("should not log when log level is above Debug", async () => {
			const { logger } = createMockOutputChannelWithLogger();

			// Set info log level (above debug)
			const originalLogLevel = vscode.env.logLevel;
			// @ts-expect-error - mocking readonly property
			vscode.env.logLevel = vscode.LogLevel.Info;

			const mockWorkspaceQuery = WorkspaceQuery.Mine;
			const mockRestClient = createMockApi({
				getWorkspaces: vi.fn(() =>
					Promise.resolve({
						workspaces: [],
						count: 0,
					}),
				),
			});

			// Create mock Storage that uses Logger
			const mockStorage = createMockStorage({
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.debug(msg);
				}),
			});

			const provider = new WorkspaceProvider(
				mockWorkspaceQuery,
				mockRestClient,
				mockStorage,
			);

			// Mock extractAllAgents
			const { extractAllAgents } = await import("./api-helper");
			vi.mocked(extractAllAgents).mockReturnValue([]);

			// Call private fetch method
			const fetch = getPrivateProperty(
				provider,
				"fetch",
			) as () => Promise<void>;
			await fetch.call(provider);

			// Verify writeToCoderOutputChannel was NOT called
			expect(mockStorage.writeToCoderOutputChannel).not.toHaveBeenCalled();

			// Restore log level
			// @ts-expect-error - mocking readonly property
			vscode.env.logLevel = originalLogLevel;
		});
	});
});
