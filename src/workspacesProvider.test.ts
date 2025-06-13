import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { WorkspaceProvider, WorkspaceQuery, WorkspaceTreeItem } from "./workspacesProvider"
import { Storage } from "./storage"
import { Api } from "coder/site/src/api/api"
import { Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated"

// Mock vscode module
vi.mock("vscode", () => ({
  LogLevel: {
    Debug: 0,
    Info: 1,
    Warning: 2,
    Error: 3,
  },
  env: {
    logLevel: 1,
  },
  EventEmitter: vi.fn().mockImplementation(() => ({
    event: vi.fn(),
    fire: vi.fn(),
  })),
  TreeItem: vi.fn().mockImplementation(function(label, collapsibleState) {
    this.label = label
    this.collapsibleState = collapsibleState
    this.contextValue = undefined
    this.tooltip = undefined
    this.description = undefined
  }),
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
}))

// Mock EventSource
vi.mock("eventsource", () => ({
  EventSource: vi.fn().mockImplementation(() => ({
    addEventListener: vi.fn(),
    close: vi.fn(),
  })),
}))

// Mock path module
vi.mock("path", () => ({
  join: vi.fn((...args) => args.join("/")),
}))

// Mock API helper functions
vi.mock("./api-helper", () => ({
  extractAllAgents: vi.fn(),
  extractAgents: vi.fn(),
  errToStr: vi.fn(),
  AgentMetadataEventSchemaArray: {
    parse: vi.fn(),
  },
}))

// Mock API
vi.mock("./api", () => ({
  createStreamingFetchAdapter: vi.fn(),
}))

describe("WorkspaceProvider", () => {
  let provider: WorkspaceProvider
  let mockRestClient: any
  let mockStorage: any
  let mockEventEmitter: any

  const mockWorkspace: Workspace = {
    id: "workspace-1",
    name: "test-workspace",
    owner_name: "testuser",
    template_name: "ubuntu",
    template_display_name: "Ubuntu Template",
    latest_build: {
      status: "running",
    } as any,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    owner_id: "user-1",
    organization_id: "org-1",
    template_id: "template-1",
    template_version_id: "template-1",
    last_used_at: "2024-01-01T00:00:00Z",
    outdated: false,
    ttl_ms: 0,
    health: {
      healthy: true,
      failing_agents: [],
    },
    automatic_updates: "never",
    allow_renames: true,
    favorite: false,
  }

  const mockAgent: WorkspaceAgent = {
    id: "agent-1",
    name: "main",
    status: "connected",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    resource_id: "resource-1",
    instance_id: "instance-1",
    auth_token: "token",
    architecture: "amd64",
    environment_variables: {},
    operating_system: "linux",
    startup_script: "",
    directory: "/home/coder",
    expanded_directory: "/home/coder",
    version: "2.15.0",
    apps: [],
    health: {
      healthy: true,
      reason: "",
    },
    display_apps: [],
    log_sources: [],
    logs_length: 0,
    logs_overflowed: false,
    first_connected_at: "2024-01-01T00:00:00Z",
    last_connected_at: "2024-01-01T00:00:00Z",
    connection_timeout_seconds: 120,
    troubleshooting_url: "",
    lifecycle_state: "ready",
    login_before_ready: false,
    startup_script_behavior: "blocking",
    shutdown_script: "",
    shutdown_script_timeout_seconds: 300,
    subsystems: [],
    api_version: "2.0",
    motd_file: "",
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    mockEventEmitter = {
      event: vi.fn(),
      fire: vi.fn(),
    }
    vi.mocked(vscode.EventEmitter).mockReturnValue(mockEventEmitter)

    mockRestClient = {
      getWorkspaces: vi.fn(),
      getAxiosInstance: vi.fn(() => ({
        defaults: { baseURL: "https://coder.example.com" },
      })),
    }

    mockStorage = {
      writeToCoderOutputChannel: vi.fn(),
    }

    provider = new WorkspaceProvider(
      WorkspaceQuery.Mine,
      mockRestClient,
      mockStorage,
      5 // 5 second timer
    )

    // Setup default mocks for api-helper
    const { extractAllAgents, extractAgents } = await import("./api-helper")
    vi.mocked(extractAllAgents).mockReturnValue([])
    vi.mocked(extractAgents).mockReturnValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("constructor", () => {
    it("should create provider with correct initial state", () => {
      const provider = new WorkspaceProvider(
        WorkspaceQuery.All,
        mockRestClient,
        mockStorage,
        10
      )

      expect(provider).toBeDefined()
    })

    it("should create provider without timer", () => {
      const provider = new WorkspaceProvider(
        WorkspaceQuery.Mine,
        mockRestClient,
        mockStorage
      )

      expect(provider).toBeDefined()
    })
  })

  describe("fetchAndRefresh", () => {
    it("should not fetch when not visible", async () => {
      provider.setVisibility(false)

      await provider.fetchAndRefresh()

      expect(mockRestClient.getWorkspaces).not.toHaveBeenCalled()
    })

    it("should fetch workspaces successfully", async () => {
      mockRestClient.getWorkspaces.mockResolvedValue({
        workspaces: [mockWorkspace],
        count: 1,
      })

      provider.setVisibility(true)
      await provider.fetchAndRefresh()

      expect(mockRestClient.getWorkspaces).toHaveBeenCalledWith({
        q: WorkspaceQuery.Mine,
      })
      expect(mockEventEmitter.fire).toHaveBeenCalled()
    })

    it("should handle fetch errors gracefully", async () => {
      mockRestClient.getWorkspaces.mockRejectedValue(new Error("Network error"))

      provider.setVisibility(true)
      await provider.fetchAndRefresh()

      expect(mockEventEmitter.fire).toHaveBeenCalled()
      
      // Should get empty array when there's an error
      const children = await provider.getChildren()
      expect(children).toEqual([])
    })

    it("should log debug message when log level is debug", async () => {
      const originalLogLevel = vscode.env.logLevel
      vi.mocked(vscode.env).logLevel = vscode.LogLevel.Debug

      mockRestClient.getWorkspaces.mockResolvedValue({
        workspaces: [],
        count: 0,
      })

      provider.setVisibility(true)
      await provider.fetchAndRefresh()

      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
        "Fetching workspaces: owner:me..."
      )

      vi.mocked(vscode.env).logLevel = originalLogLevel
    })
  })

  describe("setVisibility", () => {
    it("should start fetching when becoming visible for first time", async () => {
      const fetchSpy = vi.spyOn(provider, "fetchAndRefresh").mockResolvedValue()

      provider.setVisibility(true)

      expect(fetchSpy).toHaveBeenCalled()
    })

    it("should cancel pending refresh when becoming invisible", () => {
      vi.useFakeTimers()

      provider.setVisibility(true)
      provider.setVisibility(false)

      // Fast-forward time - should not trigger refresh
      vi.advanceTimersByTime(10000)

      expect(mockRestClient.getWorkspaces).not.toHaveBeenCalled()
    })
  })

  describe("getTreeItem", () => {
    it("should return the same tree item", async () => {
      const mockTreeItem = new vscode.TreeItem("test")

      const result = await provider.getTreeItem(mockTreeItem)

      expect(result).toBe(mockTreeItem)
    })
  })

  describe("getChildren", () => {
    it("should return empty array when no workspaces", async () => {
      const children = await provider.getChildren()

      expect(children).toEqual([])
    })

    it("should return workspace tree items", async () => {
      const { extractAgents } = await import("./api-helper")
      vi.mocked(extractAgents).mockReturnValue([mockAgent])

      mockRestClient.getWorkspaces.mockResolvedValue({
        workspaces: [mockWorkspace],
        count: 1,
      })

      provider.setVisibility(true)
      await provider.fetchAndRefresh()

      const children = await provider.getChildren()

      expect(children).toHaveLength(1)
      expect(children[0]).toBeInstanceOf(WorkspaceTreeItem)
    })

    it("should return empty array for unknown element type", async () => {
      const unknownItem = new vscode.TreeItem("unknown")

      const children = await provider.getChildren(unknownItem)

      expect(children).toEqual([])
    })
  })

  describe("refresh", () => {
    it("should fire tree data change event", () => {
      provider.refresh(undefined)

      expect(mockEventEmitter.fire).toHaveBeenCalledWith(undefined)
    })

    it("should fire tree data change event with specific item", () => {
      const item = new vscode.TreeItem("test")

      provider.refresh(item)

      expect(mockEventEmitter.fire).toHaveBeenCalledWith(item)
    })
  })

  describe("fetch method edge cases", () => {
    it("should throw error when not logged in", async () => {
      mockRestClient.getAxiosInstance.mockReturnValue({
        defaults: { baseURL: undefined },
      })

      provider.setVisibility(true)
      await provider.fetchAndRefresh()

      // Should result in empty workspaces due to error handling
      const children = await provider.getChildren()
      expect(children).toEqual([])
    })

    it("should handle workspace query for All workspaces", async () => {
      const allProvider = new WorkspaceProvider(
        WorkspaceQuery.All,
        mockRestClient,
        mockStorage,
        5
      )

      mockRestClient.getWorkspaces.mockResolvedValue({
        workspaces: [mockWorkspace],
        count: 1,
      })

      allProvider.setVisibility(true)
      await allProvider.fetchAndRefresh()

      expect(mockRestClient.getWorkspaces).toHaveBeenCalledWith({
        q: WorkspaceQuery.All,
      })
    })
  })
})

describe("WorkspaceTreeItem", () => {
  const mockWorkspace: Workspace = {
    id: "workspace-1",
    name: "test-workspace",
    owner_name: "testuser",
    template_name: "ubuntu",
    template_display_name: "Ubuntu Template",
    latest_build: {
      status: "running",
    } as any,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    owner_id: "user-1",
    organization_id: "org-1",
    template_id: "template-1",
    template_version_id: "template-1",
    last_used_at: "2024-01-01T00:00:00Z",
    outdated: false,
    ttl_ms: 0,
    health: {
      healthy: true,
      failing_agents: [],
    },
    automatic_updates: "never",
    allow_renames: true,
    favorite: false,
  }

  beforeEach(async () => {
    const { extractAgents } = await import("./api-helper")
    vi.mocked(extractAgents).mockReturnValue([])
  })

  it("should create workspace item with basic properties", () => {
    const item = new WorkspaceTreeItem(mockWorkspace, false, false)

    expect(item.label).toBe("test-workspace")
    expect(item.workspaceOwner).toBe("testuser")
    expect(item.workspaceName).toBe("test-workspace")
    expect(item.workspace).toBe(mockWorkspace)
    expect(item.appStatus).toEqual([])
  })

  it("should show owner when showOwner is true", () => {
    const item = new WorkspaceTreeItem(mockWorkspace, true, false)

    expect(item.label).toBe("testuser / test-workspace")
    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed)
  })

  it("should not show owner when showOwner is false", () => {
    const item = new WorkspaceTreeItem(mockWorkspace, false, false)

    expect(item.label).toBe("test-workspace")
    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded)
  })

  it("should format status with capitalization", () => {
    const item = new WorkspaceTreeItem(mockWorkspace, false, false)

    expect(item.description).toBe("running")
    expect(item.tooltip).toContain("Template: Ubuntu Template")
    expect(item.tooltip).toContain("Status: Running")
  })

  it("should set context value based on agent count", async () => {
    const { extractAgents } = await import("./api-helper")
    
    // Test single agent
    vi.mocked(extractAgents).mockReturnValueOnce([{ id: "agent-1" }] as any)
    const singleAgentItem = new WorkspaceTreeItem(mockWorkspace, false, false)
    expect(singleAgentItem.contextValue).toBe("coderWorkspaceSingleAgent")

    // Test multiple agents
    vi.mocked(extractAgents).mockReturnValueOnce([
      { id: "agent-1" },
      { id: "agent-2" },
    ] as any)
    const multiAgentItem = new WorkspaceTreeItem(mockWorkspace, false, false)
    expect(multiAgentItem.contextValue).toBe("coderWorkspaceMultipleAgents")
  })
})

describe("WorkspaceQuery enum", () => {
  it("should have correct values", () => {
    expect(WorkspaceQuery.Mine).toBe("owner:me")
    expect(WorkspaceQuery.All).toBe("")
  })
})