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

// Helper to create WorkspaceProvider with common setup
const createTestProvider = (
	overrides: {
		query?: WorkspaceQuery;
		restClient?: Parameters<typeof createMockApi>[0];
		storage?: Parameters<typeof createMockStorage>[0];
		timerSeconds?: number;
	} = {},
) => {
	const query = overrides.query ?? WorkspaceQuery.Mine;
	const restClient = createMockApi(overrides.restClient);
	const storage = createMockStorage(overrides.storage);
	const timerSeconds = overrides.timerSeconds;

	const provider = new WorkspaceProvider(
		query,
		restClient,
		storage,
		timerSeconds,
	);

	return { provider, query, restClient, storage };
};

describe("workspacesProvider", () => {
	it.skip("should export WorkspaceQuery enum", () => {
		expect(WorkspaceQuery.Mine).toBe("owner:me");
		expect(WorkspaceQuery.All).toBe("");
	});

	it.skip("should create WorkspaceProvider instance", () => {
		const { provider } = createTestProvider();

		expect(provider).toBeInstanceOf(WorkspaceProvider);
	});

	describe("setVisibility", () => {
		it.each([
			[
				"should set visibility to false and cancel pending refresh",
				false,
				true,
				true,
			],
			[
				"should set visibility to true when workspaces exist",
				true,
				false,
				true,
			],
		])("%s", (_, newVisibility, initialVisibility) => {
			const { provider } = createTestProvider();

			// Set up initial state
			if (newVisibility === false) {
				const mockTimeout = setTimeout(() => {}, 1000);
				setPrivateProperty(provider, "timeout", mockTimeout);
				setPrivateProperty(provider, "visible", initialVisibility);

				// Spy on clearTimeout to verify it's called
				const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

				provider.setVisibility(newVisibility);

				expect(getPrivateProperty(provider, "visible")).toBe(newVisibility);
				expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimeout);
				expect(getPrivateProperty(provider, "timeout")).toBeUndefined();

				clearTimeoutSpy.mockRestore();
			} else {
				// Set up initial state - simulate having workspaces
				const MockTreeItem = createMockVSCode()
					.TreeItem as typeof vscode.TreeItem;
				setPrivateProperty(provider, "workspaces", [
					new MockTreeItem("test-workspace"),
				]);
				setPrivateProperty(provider, "visible", initialVisibility);

				// Mock the maybeScheduleRefresh method
				const maybeScheduleRefreshSpy = vi
					.spyOn(provider, "maybeScheduleRefresh" as never)
					.mockImplementation(() => {});

				provider.setVisibility(newVisibility);

				expect(getPrivateProperty(provider, "visible")).toBe(newVisibility);
				expect(maybeScheduleRefreshSpy).toHaveBeenCalled();

				maybeScheduleRefreshSpy.mockRestore();
			}
		});
	});

	describe.skip("getTreeItem", () => {
		it("should return the same element passed to it", () => {
			const { provider } = createTestProvider();

			const MockTreeItem = createMockVSCode()
				.TreeItem as typeof vscode.TreeItem;
			const mockTreeItem = new MockTreeItem("test-item");
			mockTreeItem.description = "Test description";

			const result = provider.getTreeItem(mockTreeItem);

			expect(result).toBe(mockTreeItem);
		});
	});

	describe("fetchAndRefresh", () => {
		it.each([
			["should not fetch when already fetching", true, true],
			["should not fetch when not visible", false, false],
		])("%s", async (_, fetching, visible) => {
			const { provider } = createTestProvider();

			// Set up state
			setPrivateProperty(provider, "fetching", fetching);
			setPrivateProperty(provider, "visible", visible);

			// Mock the fetch method to ensure it's not called
			const fetchSpy = vi
				.spyOn(provider, "fetch" as never)
				.mockResolvedValue([]);

			await provider.fetchAndRefresh();

			expect(fetchSpy).not.toHaveBeenCalled();

			fetchSpy.mockRestore();
		});

		it("should handle errors when fetching workspaces", async () => {
			const { provider } = createTestProvider();

			// Set up state
			setPrivateProperty(provider, "fetching", false);
			setPrivateProperty(provider, "visible", true);

			// Mock methods
			vi.spyOn(provider, "fetch" as never).mockRejectedValue(
				new Error("Fetch failed"),
			);
			vi.spyOn(provider, "refresh").mockImplementation(() => {});
			const maybeScheduleRefreshSpy = vi
				.spyOn(provider, "maybeScheduleRefresh" as never)
				.mockImplementation(() => {});

			await provider.fetchAndRefresh();

			expect(getPrivateProperty(provider, "workspaces")).toEqual([]);
			expect(provider.refresh).toHaveBeenCalled();
			expect(maybeScheduleRefreshSpy).not.toHaveBeenCalled();
		});
	});

	describe("refresh", () => {
		it.each([
			["should fire onDidChangeTreeData event", { label: "test" }],
			["should fire onDidChangeTreeData event with undefined", undefined],
		])("%s", (_, item) => {
			const { provider } = createTestProvider();

			const fireSpy = vi.spyOn(
				getPrivateProperty(
					provider,
					"_onDidChangeTreeData",
				) as vscode.EventEmitter<null>,
				"fire",
			);

			provider.refresh(item as vscode.TreeItem);

			expect(fireSpy).toHaveBeenCalledWith(item);
		});
	});

	describe("getChildren", () => {
		it.each([
			["should return workspaces when no element is provided", true],
			["should return empty array when workspaces is undefined", false],
		])("%s", async (_, hasWorkspaces) => {
			const { provider } = createTestProvider();

			if (hasWorkspaces) {
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
			} else {
				// Ensure workspaces is undefined
				setPrivateProperty(provider, "workspaces", undefined);

				const result = await provider.getChildren();
				expect(result).toEqual([]);
			}
		});

		it("should return agent items when WorkspaceTreeItem element is provided", async () => {
			const { provider } = createTestProvider();

			// Mock extractAgents
			const { extractAgents } = await import("./api-helper");
			vi.mocked(extractAgents).mockReturnValue([
				{ id: "agent1", name: "main", status: "connected" },
				{ id: "agent2", name: "gpu", status: "connected" },
			] as never);

			// Create a mock WorkspaceTreeItem
			const mockWorkspaceTreeItem = {
				workspace: { id: "workspace1", name: "my-workspace" },
				workspaceOwner: "testuser",
				workspaceName: "my-workspace",
				watchMetadata: false,
			};
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
			const { provider } = createTestProvider({ timerSeconds: 60 });

			// Set up state
			setPrivateProperty(provider, "fetching", false);
			setPrivateProperty(provider, "visible", true);

			// Mock successful fetch
			const MockTreeItem = createMockVSCode()
				.TreeItem as typeof vscode.TreeItem;
			const mockWorkspaces = [new MockTreeItem("workspace1")];
			vi.spyOn(provider, "fetch" as never).mockResolvedValue(mockWorkspaces);
			vi.spyOn(provider, "refresh").mockImplementation(() => {});
			const maybeScheduleRefreshSpy = vi
				.spyOn(provider, "maybeScheduleRefresh" as never)
				.mockImplementation(() => {});

			await provider.fetchAndRefresh();

			expect(getPrivateProperty(provider, "workspaces")).toBe(mockWorkspaces);
			expect(provider.refresh).toHaveBeenCalled();
			expect(maybeScheduleRefreshSpy).toHaveBeenCalled();
		});
	});

	describe("maybeScheduleRefresh", () => {
		it("should schedule refresh when timer is set and not fetching", () => {
			const { provider } = createTestProvider({ timerSeconds: 30 });

			setPrivateProperty(provider, "fetching", false);
			setPrivateProperty(provider, "timeout", undefined);

			const setTimeoutSpy = vi
				.spyOn(global, "setTimeout")
				.mockImplementation(() => 123 as never);

			const maybeScheduleRefresh = getPrivateProperty(
				provider,
				"maybeScheduleRefresh",
			) as () => void;
			maybeScheduleRefresh.call(provider);

			expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
			expect(getPrivateProperty(provider, "timeout")).toBe(123);
		});
	});

	describe("fetchAndRefresh - clears pending refresh", () => {
		it("should clear pending refresh before fetching", async () => {
			const { provider } = createTestProvider();

			// Set up state with existing timeout
			const mockTimeout = setTimeout(() => {}, 1000);
			setPrivateProperty(provider, "fetching", false);
			setPrivateProperty(provider, "visible", true);
			setPrivateProperty(provider, "timeout", mockTimeout);

			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
			vi.spyOn(provider, "fetch" as never).mockResolvedValue([]);
			vi.spyOn(provider, "refresh").mockImplementation(() => {});
			vi.spyOn(provider, "maybeScheduleRefresh" as never).mockImplementation(
				() => {},
			);

			await provider.fetchAndRefresh();

			expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimeout);
			expect(getPrivateProperty(provider, "timeout")).toBeUndefined();
		});
	});

	describe("cancelPendingRefresh", () => {
		it("should clear timeout when called", () => {
			const { provider } = createTestProvider();

			const mockTimeout = setTimeout(() => {}, 1000);
			setPrivateProperty(provider, "timeout", mockTimeout);

			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

			const cancelPendingRefresh = getPrivateProperty(
				provider,
				"cancelPendingRefresh",
			) as () => void;
			cancelPendingRefresh.call(provider);

			expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimeout);
			expect(getPrivateProperty(provider, "timeout")).toBeUndefined();
		});
	});

	describe("onDidChangeTreeData", () => {
		it("should expose event emitter", () => {
			const { provider } = createTestProvider();

			expect(provider.onDidChangeTreeData).toBeDefined();
			expect(typeof provider.onDidChangeTreeData).toBe("function");
		});
	});

	describe("fetch - with debug logging", () => {
		it("should log when debug logging is enabled", async () => {
			const { provider, storage } = createTestProvider({
				query: WorkspaceQuery.All,
				restClient: {
					getWorkspaces: vi
						.fn()
						.mockResolvedValue({ workspaces: [], count: 0 }),
				},
			});

			const { extractAllAgents } = await import("./api-helper");
			vi.mocked(extractAllAgents).mockReturnValue([]);

			vi.mocked(vscode.env).logLevel = vscode.LogLevel.Debug;

			const fetch = getPrivateProperty(
				provider,
				"fetch",
			) as () => Promise<void>;
			await fetch.call(provider);

			expect(storage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Fetching workspaces: no filter...",
			);
		});
	});

	describe("fetch - edge cases", () => {
		it.each([
			[
				"should throw error when not logged in (no URL)",
				{ baseURL: undefined },
				"not logged in",
			],
		])("%s", async (_, axiosDefaults, expectedError) => {
			const { provider } = createTestProvider({
				restClient: {
					getAxiosInstance: vi.fn().mockReturnValue({
						defaults: axiosDefaults,
					}),
				},
			});

			// Call private fetch method
			const fetch = getPrivateProperty(
				provider,
				"fetch",
			) as () => Promise<void>;
			await expect(fetch.call(provider)).rejects.toThrow(expectedError);
		});

		it("should re-fetch when URL changes during fetch", async () => {
			let callCount = 0;
			const { provider, restClient: mockRestClient } = createTestProvider({
				restClient: {
					getAxiosInstance: vi.fn().mockImplementation(() => ({
						defaults: {
							baseURL:
								callCount === 0
									? "https://old.coder.com"
									: "https://new.coder.com",
						},
					})),
					getWorkspaces: vi.fn().mockImplementation(() => {
						callCount++;
						return Promise.resolve({ workspaces: [], count: 0 });
					}),
				},
			});

			const { extractAllAgents } = await import("./api-helper");
			vi.mocked(extractAllAgents).mockReturnValue([]);

			const fetch = getPrivateProperty(
				provider,
				"fetch",
			) as () => Promise<unknown>;
			const result = await fetch.call(provider);

			expect(mockRestClient.getWorkspaces).toHaveBeenCalledTimes(2);
			expect(result).toEqual([]);
		});
	});

	describe("setVisibility - fetchAndRefresh when no workspaces", () => {
		it("should call fetchAndRefresh when visible and no workspaces exist", () => {
			const { provider } = createTestProvider();

			setPrivateProperty(provider, "workspaces", undefined);
			setPrivateProperty(provider, "visible", false);

			const fetchAndRefreshSpy = vi
				.spyOn(provider, "fetchAndRefresh")
				.mockResolvedValue();

			provider.setVisibility(true);

			expect(getPrivateProperty(provider, "visible")).toBe(true);
			expect(fetchAndRefreshSpy).toHaveBeenCalled();
		});
	});

	describe("getChildren - AgentTreeItem", () => {
		it.each([
			[
				"should return error item when watcher has error",
				{ agent1: { error: new Error("Watcher error") } },
				[{ id: "agent1", name: "main", status: "connected", apps: [] }],
				1,
				["Failed to query metadata"],
			],
			[
				"should return app status and metadata sections",
				{
					agent1: {
						metadata: [
							{
								description: { display_name: "CPU" },
								result: { value: "50%", collected_at: "2024-01-01T12:00:00Z" },
							},
						],
					},
				},
				[
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
					},
				],
				2,
				["App Statuses", "Agent Metadata"],
			],
		])(
			"%s",
			async (_, agentWatchers, agents, expectedLength, expectedLabels) => {
				const { provider } = createTestProvider();

				// Set up agent watcher
				setPrivateProperty(provider, "agentWatchers", agentWatchers);

				// Mock extractAgents
				const { extractAgents } = await import("./api-helper");
				vi.mocked(extractAgents).mockReturnValue(agents as never);

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
				const agentItems = await provider.getChildren(workspaceTreeItem);
				expect(agentItems).toHaveLength(1);

				// Now get children of the agent
				const result = await provider.getChildren(agentItems[0]);

				expect(result).toHaveLength(expectedLength);

				// Check expected labels
				expectedLabels.forEach((label, index) => {
					expect(result[index]).toBeDefined();
					if (label.includes("Failed")) {
						expect(result[index].label).toContain(label);
					} else {
						expect(result[index].label).toBe(label);
					}
				});
			},
		);
	});

	describe("getChildren - edge cases", () => {
		it.each([
			[
				"should return children for section-like tree items",
				{ label: "Test Section", children: [] },
			],
			[
				"should return empty array for unknown element type",
				{ label: "unknown" },
			],
		])("%s", async (_, treeItem) => {
			const { provider } = createTestProvider();

			// Create mock tree item
			const MockTreeItem = createMockVSCode()
				.TreeItem as typeof vscode.TreeItem;
			const mockItem =
				"children" in treeItem
					? (treeItem as never)
					: new MockTreeItem(treeItem.label);

			const result = await provider.getChildren(mockItem);

			// Both cases should return empty array
			expect(result).toEqual([]);
		});
	});

	describe.skip("Logger integration", () => {
		it.each([
			[
				"should log debug messages through Logger when Storage has Logger set",
				WorkspaceQuery.Mine,
				vscode.LogLevel.Debug,
				"debug",
				"Fetching workspaces: owner:me...",
				"DEBUG",
				true,
			],
			[
				"should work with Storage instance that has Logger set",
				WorkspaceQuery.All,
				vscode.LogLevel.Debug,
				"info",
				"Fetching workspaces: no filter...",
				"INFO",
				true,
			],
			[
				"should not log when log level is above Debug",
				WorkspaceQuery.Mine,
				vscode.LogLevel.Info,
				"debug",
				"Fetching workspaces: owner:me...",
				"DEBUG",
				false,
			],
		])(
			"%s",
			async (
				_,
				query,
				logLevel,
				logMethod,
				expectedMessage,
				expectedLevel,
				shouldLog,
			) => {
				const { logger } = createMockOutputChannelWithLogger();

				// Set log level
				const originalLogLevel = vscode.env.logLevel;
				// @ts-expect-error - mocking readonly property
				vscode.env.logLevel = logLevel;

				const { provider, storage } = createTestProvider({
					query,
					restClient: {
						getAxiosInstance: vi.fn(() => ({
							defaults: { baseURL: "https://example.com" },
						})),
						getWorkspaces: vi.fn(() =>
							Promise.resolve({
								workspaces: [],
								count: 0,
							}),
						),
					},
					storage: {
						writeToCoderOutputChannel: vi.fn((msg: string) => {
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							(logger as any)[logMethod](msg);
						}),
					},
				});

				// Mock extractAllAgents
				const { extractAllAgents } = await import("./api-helper");
				vi.mocked(extractAllAgents).mockReturnValue([]);

				// Call private fetch method
				const fetch = getPrivateProperty(
					provider,
					"fetch",
				) as () => Promise<void>;
				await fetch.call(provider);

				if (shouldLog) {
					// Verify message was logged
					expect(storage.writeToCoderOutputChannel).toHaveBeenCalledWith(
						expectedMessage,
					);

					if (logMethod === "debug") {
						const logs = logger.getLogs();
						expect(logs.length).toBe(1);
						expect(logs[0].message).toBe(expectedMessage);
						expect(logs[0].level).toBe(expectedLevel);
					} else {
						const logs = logger.getLogs();
						expect(logs.length).toBeGreaterThan(0);
						expect(logs[0].message).toBe(expectedMessage);
					}
				} else {
					// Verify writeToCoderOutputChannel was NOT called
					expect(storage.writeToCoderOutputChannel).not.toHaveBeenCalled();
				}

				// Restore log level
				// @ts-expect-error - mocking readonly property
				vscode.env.logLevel = originalLogLevel;
			},
		);
	});
});
