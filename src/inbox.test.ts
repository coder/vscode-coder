import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { Inbox } from "./inbox"
import { Api } from "coder/site/src/api/api"
import { Workspace } from "coder/site/src/api/typesGenerated"
import { ProxyAgent } from "proxy-agent"
import { WebSocket } from "ws"
import { Storage } from "./storage"

// Mock external dependencies
vi.mock("vscode", () => ({
  window: {
    showInformationMessage: vi.fn(),
  },
}))

vi.mock("ws", () => ({
  WebSocket: vi.fn(),
}))

vi.mock("proxy-agent", () => ({
  ProxyAgent: vi.fn(),
}))

vi.mock("./api", () => ({
  coderSessionTokenHeader: "Coder-Session-Token",
}))

vi.mock("./api-helper", () => ({
  errToStr: vi.fn(),
}))

describe("Inbox", () => {
  let mockWorkspace: Workspace
  let mockHttpAgent: ProxyAgent
  let mockRestClient: Api
  let mockStorage: Storage
  let mockSocket: any
  let inbox: Inbox

  beforeEach(async () => {
    vi.clearAllMocks()

    // Setup mock workspace
    mockWorkspace = {
      id: "workspace-1",
      name: "test-workspace",
      owner_name: "testuser",
    } as Workspace

    // Setup mock HTTP agent
    mockHttpAgent = {} as ProxyAgent

    // Setup mock socket
    mockSocket = {
      on: vi.fn(),
      close: vi.fn(),
    }
    vi.mocked(WebSocket).mockReturnValue(mockSocket)

    // Setup mock REST client
    mockRestClient = {
      getAxiosInstance: vi.fn(() => ({
        defaults: {
          baseURL: "https://coder.example.com",
          headers: {
            common: {
              "Coder-Session-Token": "test-token",
            },
          },
        },
      })),
    } as any

    // Setup mock storage
    mockStorage = {
      writeToCoderOutputChannel: vi.fn(),
    } as any

    // Setup errToStr mock
    const apiHelper = await import("./api-helper")
    vi.mocked(apiHelper.errToStr).mockReturnValue("Mock error message")
  })

  afterEach(() => {
    if (inbox) {
      inbox.dispose()
    }
  })

  describe("constructor", () => {
    it("should create WebSocket connection with correct URL and headers", () => {
      inbox = new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage)

      expect(WebSocket).toHaveBeenCalledWith(
        expect.any(URL),
        {
          agent: mockHttpAgent,
          followRedirects: true,
          headers: {
            "Coder-Session-Token": "test-token",
          },
        }
      )

      // Verify the WebSocket URL is constructed correctly
      const websocketCall = vi.mocked(WebSocket).mock.calls[0]
      const websocketUrl = websocketCall[0] as URL
      expect(websocketUrl.protocol).toBe("wss:")
      expect(websocketUrl.host).toBe("coder.example.com")
      expect(websocketUrl.pathname).toBe("/api/v2/notifications/inbox/watch")
      expect(websocketUrl.searchParams.get("format")).toBe("plaintext")
      expect(websocketUrl.searchParams.get("templates")).toContain("a9d027b4-ac49-4fb1-9f6d-45af15f64e7a")
      expect(websocketUrl.searchParams.get("templates")).toContain("f047f6a3-5713-40f7-85aa-0394cce9fa3a")
      expect(websocketUrl.searchParams.get("targets")).toBe("workspace-1")
    })

    it("should use ws protocol for http base URL", () => {
      mockRestClient.getAxiosInstance = vi.fn(() => ({
        defaults: {
          baseURL: "http://coder.example.com",
          headers: {
            common: {
              "Coder-Session-Token": "test-token",
            },
          },
        },
      }))

      inbox = new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage)

      const websocketCall = vi.mocked(WebSocket).mock.calls[0]
      const websocketUrl = websocketCall[0] as URL
      expect(websocketUrl.protocol).toBe("ws:")
    })

    it("should handle missing token in headers", () => {
      mockRestClient.getAxiosInstance = vi.fn(() => ({
        defaults: {
          baseURL: "https://coder.example.com",
          headers: {
            common: {},
          },
        },
      }))

      inbox = new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage)

      expect(WebSocket).toHaveBeenCalledWith(
        expect.any(URL),
        {
          agent: mockHttpAgent,
          followRedirects: true,
          headers: undefined,
        }
      )
    })

    it("should throw error when no base URL is set", () => {
      mockRestClient.getAxiosInstance = vi.fn(() => ({
        defaults: {
          baseURL: undefined,
          headers: {
            common: {},
          },
        },
      }))

      expect(() => {
        new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage)
      }).toThrow("No base URL set on REST client")
    })

    it("should register socket event handlers", () => {
      inbox = new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage)

      expect(mockSocket.on).toHaveBeenCalledWith("open", expect.any(Function))
      expect(mockSocket.on).toHaveBeenCalledWith("error", expect.any(Function))
      expect(mockSocket.on).toHaveBeenCalledWith("message", expect.any(Function))
    })
  })

  describe("socket event handlers", () => {
    beforeEach(() => {
      inbox = new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage)
    })

    it("should handle socket open event", () => {
      const openHandler = mockSocket.on.mock.calls.find(call => call[0] === "open")?.[1]
      expect(openHandler).toBeDefined()

      openHandler()

      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
        "Listening to Coder Inbox"
      )
    })

    it("should handle socket error event", () => {
      const errorHandler = mockSocket.on.mock.calls.find(call => call[0] === "error")?.[1]
      expect(errorHandler).toBeDefined()

      const mockError = new Error("Socket error")
      const disposeSpy = vi.spyOn(inbox, "dispose")

      errorHandler(mockError)

      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith("Mock error message")
      expect(disposeSpy).toHaveBeenCalled()
    })

    it("should handle valid socket message", () => {
      const messageHandler = mockSocket.on.mock.calls.find(call => call[0] === "message")?.[1]
      expect(messageHandler).toBeDefined()

      const mockMessage = {
        notification: {
          title: "Test notification",
        },
      }
      const messageData = Buffer.from(JSON.stringify(mockMessage))

      messageHandler(messageData)

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Test notification")
    })

    it("should handle invalid JSON in socket message", () => {
      const messageHandler = mockSocket.on.mock.calls.find(call => call[0] === "message")?.[1]
      expect(messageHandler).toBeDefined()

      const invalidData = Buffer.from("invalid json")

      messageHandler(invalidData)

      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith("Mock error message")
    })

    it("should handle message parsing errors", () => {
      const messageHandler = mockSocket.on.mock.calls.find(call => call[0] === "message")?.[1]
      expect(messageHandler).toBeDefined()

      const mockMessage = {
        // Missing required notification structure
      }
      const messageData = Buffer.from(JSON.stringify(mockMessage))

      messageHandler(messageData)

      // Should not throw, but may not show notification if structure is wrong
      // The test verifies that error handling doesn't crash the application
    })
  })

  describe("dispose", () => {
    beforeEach(() => {
      inbox = new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage)
    })

    it("should close socket and log when disposed", () => {
      inbox.dispose()

      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
        "No longer listening to Coder Inbox"
      )
      expect(mockSocket.close).toHaveBeenCalled()
    })

    it("should handle multiple dispose calls safely", () => {
      inbox.dispose()
      inbox.dispose()

      // Should only log and close once
      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledTimes(1)
      expect(mockSocket.close).toHaveBeenCalledTimes(1)
    })
  })

  describe("template constants", () => {
    it("should include workspace out of memory template", () => {
      inbox = new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage)

      const websocketCall = vi.mocked(WebSocket).mock.calls[0]
      const websocketUrl = websocketCall[0] as URL
      const templates = websocketUrl.searchParams.get("templates")
      
      expect(templates).toContain("a9d027b4-ac49-4fb1-9f6d-45af15f64e7a")
    })

    it("should include workspace out of disk template", () => {
      inbox = new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage)

      const websocketCall = vi.mocked(WebSocket).mock.calls[0]
      const websocketUrl = websocketCall[0] as URL
      const templates = websocketUrl.searchParams.get("templates")
      
      expect(templates).toContain("f047f6a3-5713-40f7-85aa-0394cce9fa3a")
    })
  })
})