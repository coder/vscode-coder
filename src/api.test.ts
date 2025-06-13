import { describe, it, expect, vi, beforeEach, MockedFunction } from "vitest"
import * as vscode from "vscode"
import fs from "fs/promises"
import { ProxyAgent } from "proxy-agent"
import { spawn } from "child_process"
import { needToken, createHttpAgent, startWorkspaceIfStoppedOrFailed } from "./api"
import * as proxyModule from "./proxy"
import * as headersModule from "./headers"
import { Api } from "coder/site/src/api/api"
import { Workspace } from "coder/site/src/api/typesGenerated"

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(),
  },
  EventEmitter: vi.fn().mockImplementation(() => ({
    fire: vi.fn(),
  })),
}))

vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
}))

vi.mock("proxy-agent", () => ({
  ProxyAgent: vi.fn(),
}))

vi.mock("./proxy", () => ({
  getProxyForUrl: vi.fn(),
}))

vi.mock("./headers", () => ({
  getHeaderArgs: vi.fn().mockReturnValue([]),
}))

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}))

describe("needToken", () => {
  let mockGet: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockGet = vi.fn()
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: mockGet,
    } as any)
  })

  it("should return true when no TLS files are configured", () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.tlsCertFile") return ""
      if (key === "coder.tlsKeyFile") return ""
      return undefined
    })

    expect(needToken()).toBe(true)
  })

  it("should return true when TLS config values are null", () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.tlsCertFile") return null
      if (key === "coder.tlsKeyFile") return null
      return undefined
    })

    expect(needToken()).toBe(true)
  })

  it("should return true when TLS config values are undefined", () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.tlsCertFile") return undefined
      if (key === "coder.tlsKeyFile") return undefined
      return undefined
    })

    expect(needToken()).toBe(true)
  })

  it("should return true when TLS config values are whitespace only", () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.tlsCertFile") return "   "
      if (key === "coder.tlsKeyFile") return "\t\n"
      return undefined
    })

    expect(needToken()).toBe(true)
  })

  it("should return false when only cert file is configured", () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.tlsCertFile") return "/path/to/cert.pem"
      if (key === "coder.tlsKeyFile") return ""
      return undefined
    })

    expect(needToken()).toBe(false)
  })

  it("should return false when only key file is configured", () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.tlsCertFile") return ""
      if (key === "coder.tlsKeyFile") return "/path/to/key.pem"
      return undefined
    })

    expect(needToken()).toBe(false)
  })

  it("should return false when both cert and key files are configured", () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.tlsCertFile") return "/path/to/cert.pem"
      if (key === "coder.tlsKeyFile") return "/path/to/key.pem"
      return undefined
    })

    expect(needToken()).toBe(false)
  })

  it("should handle paths with ${userHome} placeholder", () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.tlsCertFile") return "${userHome}/.coder/cert.pem"
      if (key === "coder.tlsKeyFile") return ""
      return undefined
    })

    expect(needToken()).toBe(false)
  })

  it("should handle mixed empty and configured values", () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.tlsCertFile") return "   "
      if (key === "coder.tlsKeyFile") return "/valid/path/key.pem"
      return undefined
    })

    expect(needToken()).toBe(false)
  })
})

describe("createHttpAgent", () => {
  let mockGet: ReturnType<typeof vi.fn>
  let mockProxyAgentConstructor: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockGet = vi.fn()
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: mockGet,
    } as any)
    
    mockProxyAgentConstructor = vi.mocked(ProxyAgent)
    mockProxyAgentConstructor.mockImplementation((options) => {
      return { options } as any
    })
  })

  it("should create agent with no TLS configuration", async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.insecure") return false
      if (key === "coder.tlsCertFile") return ""
      if (key === "coder.tlsKeyFile") return ""
      if (key === "coder.tlsCaFile") return ""
      if (key === "coder.tlsAltHost") return ""
      return undefined
    })

    const agent = await createHttpAgent()

    expect(mockProxyAgentConstructor).toHaveBeenCalledWith({
      getProxyForUrl: expect.any(Function),
      cert: undefined,
      key: undefined,
      ca: undefined,
      servername: undefined,
      rejectUnauthorized: true,
    })
    expect(vi.mocked(fs.readFile)).not.toHaveBeenCalled()
  })

  it("should create agent with insecure mode enabled", async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.insecure") return true
      if (key === "coder.tlsCertFile") return ""
      if (key === "coder.tlsKeyFile") return ""
      if (key === "coder.tlsCaFile") return ""
      if (key === "coder.tlsAltHost") return ""
      return undefined
    })

    const agent = await createHttpAgent()

    expect(mockProxyAgentConstructor).toHaveBeenCalledWith({
      getProxyForUrl: expect.any(Function),
      cert: undefined,
      key: undefined,
      ca: undefined,
      servername: undefined,
      rejectUnauthorized: false,
    })
  })

  it("should load certificate files when configured", async () => {
    const certContent = Buffer.from("cert-content")
    const keyContent = Buffer.from("key-content")
    const caContent = Buffer.from("ca-content")

    mockGet.mockImplementation((key: string) => {
      if (key === "coder.insecure") return false
      if (key === "coder.tlsCertFile") return "/path/to/cert.pem"
      if (key === "coder.tlsKeyFile") return "/path/to/key.pem"
      if (key === "coder.tlsCaFile") return "/path/to/ca.pem"
      if (key === "coder.tlsAltHost") return ""
      return undefined
    })

    vi.mocked(fs.readFile).mockImplementation((path: string) => {
      if (path === "/path/to/cert.pem") return Promise.resolve(certContent)
      if (path === "/path/to/key.pem") return Promise.resolve(keyContent)
      if (path === "/path/to/ca.pem") return Promise.resolve(caContent)
      return Promise.reject(new Error("Unknown file"))
    })

    const agent = await createHttpAgent()

    expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith("/path/to/cert.pem")
    expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith("/path/to/key.pem")
    expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith("/path/to/ca.pem")
    
    expect(mockProxyAgentConstructor).toHaveBeenCalledWith({
      getProxyForUrl: expect.any(Function),
      cert: certContent,
      key: keyContent,
      ca: caContent,
      servername: undefined,
      rejectUnauthorized: true,
    })
  })

  it("should handle alternate hostname configuration", async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.insecure") return false
      if (key === "coder.tlsCertFile") return ""
      if (key === "coder.tlsKeyFile") return ""
      if (key === "coder.tlsCaFile") return ""
      if (key === "coder.tlsAltHost") return "alternative.hostname.com"
      return undefined
    })

    const agent = await createHttpAgent()

    expect(mockProxyAgentConstructor).toHaveBeenCalledWith({
      getProxyForUrl: expect.any(Function),
      cert: undefined,
      key: undefined,
      ca: undefined,
      servername: "alternative.hostname.com",
      rejectUnauthorized: true,
    })
  })

  it("should handle partial TLS configuration", async () => {
    const certContent = Buffer.from("cert-content")

    mockGet.mockImplementation((key: string) => {
      if (key === "coder.insecure") return false
      if (key === "coder.tlsCertFile") return "/path/to/cert.pem"
      if (key === "coder.tlsKeyFile") return ""
      if (key === "coder.tlsCaFile") return ""
      if (key === "coder.tlsAltHost") return ""
      return undefined
    })

    vi.mocked(fs.readFile).mockResolvedValue(certContent)

    const agent = await createHttpAgent()

    expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith("/path/to/cert.pem")
    
    expect(mockProxyAgentConstructor).toHaveBeenCalledWith({
      getProxyForUrl: expect.any(Function),
      cert: certContent,
      key: undefined,
      ca: undefined,
      servername: undefined,
      rejectUnauthorized: true,
    })
  })

  it("should pass proxy configuration to getProxyForUrl", async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "coder.insecure") return false
      if (key === "coder.tlsCertFile") return ""
      if (key === "coder.tlsKeyFile") return ""
      if (key === "coder.tlsCaFile") return ""
      if (key === "coder.tlsAltHost") return ""
      if (key === "http.proxy") return "http://proxy.example.com:8080"
      if (key === "coder.proxyBypass") return "localhost,127.0.0.1"
      return undefined
    })

    vi.mocked(proxyModule.getProxyForUrl).mockReturnValue("http://proxy.example.com:8080")

    const agent = await createHttpAgent()
    const options = (agent as any).options
    
    // Test the getProxyForUrl function
    const proxyUrl = options.getProxyForUrl("https://example.com")
    
    expect(vi.mocked(proxyModule.getProxyForUrl)).toHaveBeenCalledWith(
      "https://example.com",
      "http://proxy.example.com:8080",
      "localhost,127.0.0.1"
    )
    expect(proxyUrl).toBe("http://proxy.example.com:8080")
  })

  it("should handle paths with ${userHome} in TLS files", async () => {
    const certContent = Buffer.from("cert-content")

    mockGet.mockImplementation((key: string) => {
      if (key === "coder.insecure") return false
      if (key === "coder.tlsCertFile") return "${userHome}/.coder/cert.pem"
      if (key === "coder.tlsKeyFile") return ""
      if (key === "coder.tlsCaFile") return ""
      if (key === "coder.tlsAltHost") return ""
      return undefined
    })

    vi.mocked(fs.readFile).mockResolvedValue(certContent)

    const agent = await createHttpAgent()

    // The actual path will be expanded by expandPath
    expect(vi.mocked(fs.readFile)).toHaveBeenCalled()
    const calledPath = vi.mocked(fs.readFile).mock.calls[0][0]
    expect(calledPath).toMatch(/\/.*\/.coder\/cert.pem/)
    expect(calledPath).not.toContain("${userHome}")
  })
})

describe("startWorkspaceIfStoppedOrFailed", () => {
  let mockRestClient: Partial<Api>
  let mockWorkspace: Workspace
  let mockWriteEmitter: vscode.EventEmitter<string>
  let mockSpawn: MockedFunction<typeof spawn>
  let mockProcess: any

  beforeEach(() => {
    vi.clearAllMocks()
    
    mockWorkspace = {
      id: "workspace-123",
      owner_name: "testuser",
      name: "testworkspace",
      latest_build: {
        status: "stopped",
      },
    } as Workspace

    mockRestClient = {
      getWorkspace: vi.fn(),
    }

    mockWriteEmitter = new (vi.mocked(vscode.EventEmitter))()
    
    mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    }
    
    mockSpawn = vi.mocked(spawn)
    mockSpawn.mockReturnValue(mockProcess as any)
  })

  it("should return workspace immediately if already running", async () => {
    const runningWorkspace = {
      ...mockWorkspace,
      latest_build: { status: "running" },
    } as Workspace

    vi.mocked(mockRestClient.getWorkspace).mockResolvedValue(runningWorkspace)

    const result = await startWorkspaceIfStoppedOrFailed(
      mockRestClient as Api,
      "/config/dir",
      "/bin/coder",
      mockWorkspace,
      mockWriteEmitter,
    )

    expect(result).toBe(runningWorkspace)
    expect(mockRestClient.getWorkspace).toHaveBeenCalledWith("workspace-123")
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it("should start workspace when stopped", async () => {
    const stoppedWorkspace = {
      ...mockWorkspace,
      latest_build: { status: "stopped" },
    } as Workspace
    
    const startedWorkspace = {
      ...mockWorkspace,
      latest_build: { status: "running" },
    } as Workspace

    vi.mocked(mockRestClient.getWorkspace)
      .mockResolvedValueOnce(stoppedWorkspace)
      .mockResolvedValueOnce(startedWorkspace)

    vi.mocked(headersModule.getHeaderArgs).mockReturnValue(["--header", "Custom: Value"])

    // Simulate successful process execution
    mockProcess.on.mockImplementation((event: string, callback: Function) => {
      if (event === "close") {
        setTimeout(() => callback(0), 10)
      }
    })

    const result = await startWorkspaceIfStoppedOrFailed(
      mockRestClient as Api,
      "/config/dir",
      "/bin/coder",
      mockWorkspace,
      mockWriteEmitter,
    )

    expect(mockSpawn).toHaveBeenCalledWith("/bin/coder", [
      "--global-config",
      "/config/dir",
      "--header",
      "Custom: Value",
      "start",
      "--yes",
      "testuser/testworkspace",
    ])
    
    expect(result).toBe(startedWorkspace)
    expect(mockRestClient.getWorkspace).toHaveBeenCalledTimes(2)
  })

  it("should start workspace when failed", async () => {
    const failedWorkspace = {
      ...mockWorkspace,
      latest_build: { status: "failed" },
    } as Workspace
    
    const startedWorkspace = {
      ...mockWorkspace,
      latest_build: { status: "running" },
    } as Workspace

    vi.mocked(mockRestClient.getWorkspace)
      .mockResolvedValueOnce(failedWorkspace)
      .mockResolvedValueOnce(startedWorkspace)

    mockProcess.on.mockImplementation((event: string, callback: Function) => {
      if (event === "close") {
        setTimeout(() => callback(0), 10)
      }
    })

    const result = await startWorkspaceIfStoppedOrFailed(
      mockRestClient as Api,
      "/config/dir",
      "/bin/coder",
      mockWorkspace,
      mockWriteEmitter,
    )

    expect(mockSpawn).toHaveBeenCalled()
    expect(result).toBe(startedWorkspace)
  })

  it("should handle stdout data and fire events", async () => {
    const stoppedWorkspace = {
      ...mockWorkspace,
      latest_build: { status: "stopped" },
    } as Workspace

    vi.mocked(mockRestClient.getWorkspace).mockResolvedValueOnce(stoppedWorkspace)

    let stdoutCallback: Function
    mockProcess.stdout.on.mockImplementation((event: string, callback: Function) => {
      if (event === "data") {
        stdoutCallback = callback
      }
    })

    mockProcess.on.mockImplementation((event: string, callback: Function) => {
      if (event === "close") {
        setTimeout(() => {
          // Simulate stdout data before close
          stdoutCallback(Buffer.from("Starting workspace...\nWorkspace started!\n"))
          callback(0)
        }, 10)
      }
    })

    await startWorkspaceIfStoppedOrFailed(
      mockRestClient as Api,
      "/config/dir",
      "/bin/coder",
      mockWorkspace,
      mockWriteEmitter,
    )

    expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Starting workspace...\r\n")
    expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Workspace started!\r\n")
  })

  it("should handle stderr data and capture for error message", async () => {
    const stoppedWorkspace = {
      ...mockWorkspace,
      latest_build: { status: "stopped" },
    } as Workspace

    vi.mocked(mockRestClient.getWorkspace).mockResolvedValueOnce(stoppedWorkspace)

    let stderrCallback: Function
    mockProcess.stderr.on.mockImplementation((event: string, callback: Function) => {
      if (event === "data") {
        stderrCallback = callback
      }
    })

    mockProcess.on.mockImplementation((event: string, callback: Function) => {
      if (event === "close") {
        setTimeout(() => {
          // Simulate stderr data before close
          stderrCallback(Buffer.from("Error: Failed to start\nPermission denied\n"))
          callback(1) // Exit with error
        }, 10)
      }
    })

    await expect(
      startWorkspaceIfStoppedOrFailed(
        mockRestClient as Api,
        "/config/dir",
        "/bin/coder",
        mockWorkspace,
        mockWriteEmitter,
      )
    ).rejects.toThrow('exited with code 1: Error: Failed to start\nPermission denied')

    expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Error: Failed to start\r\n")
    expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Permission denied\r\n")
  })

  it("should handle process failure without stderr", async () => {
    const stoppedWorkspace = {
      ...mockWorkspace,
      latest_build: { status: "stopped" },
    } as Workspace

    vi.mocked(mockRestClient.getWorkspace).mockResolvedValueOnce(stoppedWorkspace)

    mockProcess.on.mockImplementation((event: string, callback: Function) => {
      if (event === "close") {
        setTimeout(() => callback(127), 10) // Command not found
      }
    })

    await expect(
      startWorkspaceIfStoppedOrFailed(
        mockRestClient as Api,
        "/config/dir",
        "/bin/coder",
        mockWorkspace,
        mockWriteEmitter,
      )
    ).rejects.toThrow('exited with code 127')
  })

  it("should handle empty lines in stdout/stderr", async () => {
    const stoppedWorkspace = {
      ...mockWorkspace,
      latest_build: { status: "stopped" },
    } as Workspace

    vi.mocked(mockRestClient.getWorkspace).mockResolvedValueOnce(stoppedWorkspace)

    let stdoutCallback: Function
    mockProcess.stdout.on.mockImplementation((event: string, callback: Function) => {
      if (event === "data") {
        stdoutCallback = callback
      }
    })

    mockProcess.on.mockImplementation((event: string, callback: Function) => {
      if (event === "close") {
        setTimeout(() => {
          // Simulate data with empty lines
          stdoutCallback(Buffer.from("Line 1\n\nLine 2\n\n\n"))
          callback(0)
        }, 10)
      }
    })

    await startWorkspaceIfStoppedOrFailed(
      mockRestClient as Api,
      "/config/dir",
      "/bin/coder",
      mockWorkspace,
      mockWriteEmitter,
    )

    // Empty lines should not fire events
    expect(mockWriteEmitter.fire).toHaveBeenCalledTimes(2)
    expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Line 1\r\n")
    expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Line 2\r\n")
  })
})