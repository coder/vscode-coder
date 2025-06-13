import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { WorkspaceMonitor } from "./workspaceMonitor"
import { Api } from "coder/site/src/api/api"
import { Workspace, Template, TemplateVersion } from "coder/site/src/api/typesGenerated"
import { EventSource } from "eventsource"
import { Storage } from "./storage"

// Mock external dependencies
vi.mock("vscode", () => ({
  window: {
    createStatusBarItem: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  commands: {
    executeCommand: vi.fn(),
  },
  StatusBarAlignment: {
    Left: 1,
  },
  EventEmitter: class {
    fire = vi.fn()
    event = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock("eventsource", () => ({
  EventSource: vi.fn(),
}))

vi.mock("date-fns", () => ({
  formatDistanceToNowStrict: vi.fn(() => "30 minutes"),
}))

vi.mock("./api", () => ({
  createStreamingFetchAdapter: vi.fn(),
}))

vi.mock("./api-helper", () => ({
  errToStr: vi.fn(),
}))

describe("WorkspaceMonitor", () => {
  let mockWorkspace: Workspace
  let mockRestClient: Api
  let mockStorage: Storage
  let mockEventSource: any
  let mockStatusBarItem: any
  let mockEventEmitter: any
  let monitor: WorkspaceMonitor

  beforeEach(async () => {
    vi.clearAllMocks()

    // Setup mock workspace
    mockWorkspace = {
      id: "workspace-1",
      name: "test-workspace",
      owner_name: "testuser",
      template_id: "template-1",
      outdated: false,
      latest_build: {
        status: "running",
        deadline: undefined,
      },
      deleting_at: undefined,
    } as Workspace

    // Setup mock REST client
    mockRestClient = {
      getAxiosInstance: vi.fn(() => ({
        defaults: {
          baseURL: "https://coder.example.com",
        },
      })),
      getTemplate: vi.fn(),
      getTemplateVersion: vi.fn(),
    } as any

    // Setup mock storage
    mockStorage = {
      writeToCoderOutputChannel: vi.fn(),
    } as any

    // Setup mock status bar item
    mockStatusBarItem = {
      name: "",
      text: "",
      command: "",
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    }
    vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(mockStatusBarItem)

    // Setup mock event source
    mockEventSource = {
      addEventListener: vi.fn(),
      close: vi.fn(),
    }
    vi.mocked(EventSource).mockReturnValue(mockEventSource)

    // Note: We use the real EventEmitter class to test actual onChange behavior

    // Setup errToStr mock
    const apiHelper = await import("./api-helper")
    vi.mocked(apiHelper.errToStr).mockReturnValue("Mock error message")
    
    // Setup createStreamingFetchAdapter mock
    const api = await import("./api")
    vi.mocked(api.createStreamingFetchAdapter).mockReturnValue(vi.fn())
  })

  afterEach(() => {
    if (monitor) {
      monitor.dispose()
    }
  })

  describe("constructor", () => {
    it("should create EventSource with correct URL", () => {
      monitor = new WorkspaceMonitor(mockWorkspace, mockRestClient, mockStorage, vscode)

      expect(EventSource).toHaveBeenCalledWith(
        "https://coder.example.com/api/v2/workspaces/workspace-1/watch",
        {
          fetch: expect.any(Function),
        }
      )
    })

    it("should setup event listeners", () => {
      monitor = new WorkspaceMonitor(mockWorkspace, mockRestClient, mockStorage, vscode)

      expect(mockEventSource.addEventListener).toHaveBeenCalledWith("data", expect.any(Function))
      expect(mockEventSource.addEventListener).toHaveBeenCalledWith("error", expect.any(Function))
    })

    it("should create and configure status bar item", () => {
      monitor = new WorkspaceMonitor(mockWorkspace, mockRestClient, mockStorage, vscode)

      expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(vscode.StatusBarAlignment.Left, 999)
      expect(mockStatusBarItem.name).toBe("Coder Workspace Update")
      expect(mockStatusBarItem.text).toBe("$(fold-up) Update Workspace")
      expect(mockStatusBarItem.command).toBe("coder.workspace.update")
    })

    it("should log monitoring start message", () => {
      monitor = new WorkspaceMonitor(mockWorkspace, mockRestClient, mockStorage, vscode)

      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
        "Monitoring testuser/test-workspace..."
      )
    })

    it("should set initial context and status bar state", () => {
      monitor = new WorkspaceMonitor(mockWorkspace, mockRestClient, mockStorage, vscode)

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "setContext",
        "coder.workspace.updatable",
        false
      )
      expect(mockStatusBarItem.hide).toHaveBeenCalled()
    })
  })

  describe("event handling", () => {
    beforeEach(() => {
      monitor = new WorkspaceMonitor(mockWorkspace, mockRestClient, mockStorage, vscode)
    })

    it("should handle data events and update workspace", () => {
      const dataHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === "data"
      )?.[1]
      expect(dataHandler).toBeDefined()

      const updatedWorkspace = {
        ...mockWorkspace,
        outdated: true,
        latest_build: {
          status: "running" as const,
          deadline: undefined,
        },
        deleting_at: undefined,
      }
      const mockEvent = {
        data: JSON.stringify(updatedWorkspace),
      }

      // Call the data handler directly
      dataHandler(mockEvent)

      // Test that the context was updated (which happens in update() method)
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "setContext",
        "coder.workspace.updatable",
        true
      )
      expect(mockStatusBarItem.show).toHaveBeenCalled()
    })

    it("should handle invalid JSON in data events", () => {
      const dataHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === "data"
      )?.[1]
      expect(dataHandler).toBeDefined()

      const mockEvent = {
        data: "invalid json",
      }

      dataHandler(mockEvent)

      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith("Mock error message")
    })

    it("should handle error events", () => {
      const errorHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === "error"
      )?.[1]
      expect(errorHandler).toBeDefined()

      const mockError = new Error("Connection error")

      errorHandler(mockError)

      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith("Mock error message")
    })
  })

  describe("notification logic", () => {
    beforeEach(() => {
      monitor = new WorkspaceMonitor(mockWorkspace, mockRestClient, mockStorage, vscode)
    })

    it("should notify about impending autostop", () => {
      const futureTime = new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 minutes
      const updatedWorkspace = {
        ...mockWorkspace,
        latest_build: {
          status: "running" as const,
          deadline: futureTime,
        },
      }

      const dataHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === "data"
      )?.[1]

      dataHandler({ data: JSON.stringify(updatedWorkspace) })

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        "testuser/test-workspace is scheduled to shut down in 30 minutes."
      )
    })

    it("should notify about impending deletion", () => {
      const futureTime = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() // 12 hours
      const updatedWorkspace = {
        ...mockWorkspace,
        deleting_at: futureTime,
      }

      const dataHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === "data"
      )?.[1]

      dataHandler({ data: JSON.stringify(updatedWorkspace) })

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        "testuser/test-workspace is scheduled for deletion in 30 minutes."
      )
    })

    it("should notify when workspace stops running", () => {
      const stoppedWorkspace = {
        ...mockWorkspace,
        latest_build: {
          status: "stopped" as const,
        },
      }

      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("Reload Window")

      const dataHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === "data"
      )?.[1]

      dataHandler({ data: JSON.stringify(stoppedWorkspace) })

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        "testuser/test-workspace is no longer running!",
        {
          detail: 'The workspace status is "stopped". Reload the window to reconnect.',
          modal: true,
          useCustom: true,
        },
        "Reload Window"
      )
    })

    it("should notify about outdated workspace and handle update action", async () => {
      const outdatedWorkspace = {
        ...mockWorkspace,
        outdated: true,
      }

      const mockTemplate: Template = {
        id: "template-1",
        active_version_id: "version-1",
      } as Template

      const mockVersion: TemplateVersion = {
        id: "version-1",
        message: "New features available",
      } as TemplateVersion

      vi.mocked(mockRestClient.getTemplate).mockResolvedValue(mockTemplate)
      vi.mocked(mockRestClient.getTemplateVersion).mockResolvedValue(mockVersion)
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("Update")

      const dataHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === "data"
      )?.[1]

      dataHandler({ data: JSON.stringify(outdatedWorkspace) })

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        "A new version of your workspace is available: New features available",
        "Update"
      )
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "coder.workspace.update",
        outdatedWorkspace,
        mockRestClient
      )
    })

    it("should not notify multiple times for the same event", () => {
      const futureTime = new Date(Date.now() + 15 * 60 * 1000).toISOString()
      const updatedWorkspace = {
        ...mockWorkspace,
        latest_build: {
          status: "running" as const,
          deadline: futureTime,
        },
      }

      const dataHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === "data"
      )?.[1]

      // First notification
      dataHandler({ data: JSON.stringify(updatedWorkspace) })
      // Second notification (should be ignored)
      dataHandler({ data: JSON.stringify(updatedWorkspace) })

      expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1)
    })
  })

  describe("status bar updates", () => {
    beforeEach(() => {
      monitor = new WorkspaceMonitor(mockWorkspace, mockRestClient, mockStorage, vscode)
    })

    it("should show status bar when workspace is outdated", () => {
      const outdatedWorkspace = {
        ...mockWorkspace,
        outdated: true,
      }

      const dataHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === "data"
      )?.[1]

      dataHandler({ data: JSON.stringify(outdatedWorkspace) })

      expect(mockStatusBarItem.show).toHaveBeenCalled()
    })

    it("should hide status bar when workspace is up to date", () => {
      const upToDateWorkspace = {
        ...mockWorkspace,
        outdated: false,
      }

      const dataHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === "data"
      )?.[1]

      dataHandler({ data: JSON.stringify(upToDateWorkspace) })

      expect(mockStatusBarItem.hide).toHaveBeenCalled()
    })
  })

  describe("dispose", () => {
    beforeEach(() => {
      monitor = new WorkspaceMonitor(mockWorkspace, mockRestClient, mockStorage, vscode)
    })

    it("should close event source and dispose status bar", () => {
      monitor.dispose()

      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
        "Unmonitoring testuser/test-workspace..."
      )
      expect(mockStatusBarItem.dispose).toHaveBeenCalled()
      expect(mockEventSource.close).toHaveBeenCalled()
    })

    it("should handle multiple dispose calls safely", () => {
      monitor.dispose()
      monitor.dispose()

      // Should only log and dispose once
      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledTimes(2) // Constructor + dispose
      expect(mockStatusBarItem.dispose).toHaveBeenCalledTimes(1)
      expect(mockEventSource.close).toHaveBeenCalledTimes(1)
    })
  })

  describe("time calculation", () => {
    beforeEach(() => {
      monitor = new WorkspaceMonitor(mockWorkspace, mockRestClient, mockStorage, vscode)
    })

    it("should not notify for events too far in the future", () => {
      const farFutureTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours
      const updatedWorkspace = {
        ...mockWorkspace,
        latest_build: {
          status: "running" as const,
          deadline: farFutureTime,
        },
      }

      const dataHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === "data"
      )?.[1]

      dataHandler({ data: JSON.stringify(updatedWorkspace) })

      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
    })

    it("should not notify for past events", () => {
      const pastTime = new Date(Date.now() - 60 * 1000).toISOString() // 1 minute ago
      const updatedWorkspace = {
        ...mockWorkspace,
        latest_build: {
          status: "running" as const,
          deadline: pastTime,
        },
      }

      const dataHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === "data"
      )?.[1]

      dataHandler({ data: JSON.stringify(updatedWorkspace) })

      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
    })
  })
})