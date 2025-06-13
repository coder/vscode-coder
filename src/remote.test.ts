import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { Remote } from "./remote"
import { Storage } from "./storage"
import { Commands } from "./commands"
import { Api } from "coder/site/src/api/api"
import { Workspace } from "coder/site/src/api/typesGenerated"

// Mock external dependencies
vi.mock("vscode", () => ({
  ExtensionMode: {
    Development: 1,
    Production: 2,
    Test: 3,
  },
  commands: {
    executeCommand: vi.fn(),
  },
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
}))

vi.mock("fs/promises", () => ({
  stat: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  readdir: vi.fn(),
}))

vi.mock("os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
}))

vi.mock("path", () => ({
  join: vi.fn((...args) => args.join("/")),
}))

vi.mock("semver", () => ({
  parse: vi.fn(),
}))

vi.mock("./api", () => ({
  makeCoderSdk: vi.fn(),
  needToken: vi.fn(),
}))

vi.mock("./api-helper", () => ({
  extractAgents: vi.fn(),
}))

vi.mock("./cliManager", () => ({
  version: vi.fn(),
}))

vi.mock("./featureSet", () => ({
  featureSetForVersion: vi.fn(),
}))

vi.mock("./util", () => ({
  parseRemoteAuthority: vi.fn(),
}))

// Create a testable Remote class that exposes protected methods
class TestableRemote extends Remote {
  public validateCredentials(parts: any) {
    return super.validateCredentials(parts)
  }

  public createWorkspaceClient(baseUrlRaw: string, token: string) {
    return super.createWorkspaceClient(baseUrlRaw, token)
  }

  public setupBinary(workspaceRestClient: Api, label: string) {
    return super.setupBinary(workspaceRestClient, label)
  }

  public validateServerVersion(workspaceRestClient: Api, binaryPath: string) {
    return super.validateServerVersion(workspaceRestClient, binaryPath)
  }

  public fetchWorkspace(workspaceRestClient: Api, parts: any, baseUrlRaw: string, remoteAuthority: string) {
    return super.fetchWorkspace(workspaceRestClient, parts, baseUrlRaw, remoteAuthority)
  }
}

describe("Remote", () => {
  let remote: TestableRemote
  let mockVscodeProposed: any
  let mockStorage: Storage
  let mockCommands: Commands
  let mockRestClient: Api
  let mockWorkspace: Workspace

  beforeEach(async () => {
    vi.clearAllMocks()

    // Setup mock VSCode proposed API
    mockVscodeProposed = {
      window: {
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
      },
      commands: vscode.commands,
    }

    // Setup mock storage
    mockStorage = {
      writeToCoderOutputChannel: vi.fn(),
      migrateSessionToken: vi.fn(),
      readCliConfig: vi.fn(),
      fetchBinary: vi.fn(),
    } as any

    // Setup mock commands
    mockCommands = {
      workspace: undefined,
      workspaceRestClient: undefined,
    } as any

    // Setup mock REST client
    mockRestClient = {
      getBuildInfo: vi.fn(),
      getWorkspaceByOwnerAndName: vi.fn(),
    } as any

    // Setup mock workspace
    mockWorkspace = {
      id: "workspace-1",
      name: "test-workspace",
      owner_name: "testuser",
      latest_build: {
        status: "running",
      },
    } as Workspace

    // Create Remote instance
    remote = new TestableRemote(
      mockVscodeProposed,
      mockStorage,
      mockCommands,
      vscode.ExtensionMode.Production
    )

    // Setup default mocks
    const { makeCoderSdk, needToken } = await import("./api")
    const { featureSetForVersion } = await import("./featureSet")
    const { version } = await import("./cliManager")
    const fs = await import("fs/promises")

    vi.mocked(needToken).mockReturnValue(true)
    vi.mocked(makeCoderSdk).mockResolvedValue(mockRestClient)
    vi.mocked(featureSetForVersion).mockReturnValue({
      vscodessh: true,
      proxyLogDirectory: true,
      wildcardSSH: true,
    })
    vi.mocked(version).mockResolvedValue("v2.15.0")
    vi.mocked(fs.stat).mockResolvedValue({} as any)
  })

  describe("constructor", () => {
    it("should create Remote instance with correct parameters", () => {
      const newRemote = new TestableRemote(
        mockVscodeProposed,
        mockStorage,
        mockCommands,
        vscode.ExtensionMode.Development
      )

      expect(newRemote).toBeDefined()
      expect(newRemote).toBeInstanceOf(Remote)
    })
  })

  describe("validateCredentials", () => {
    const mockParts = {
      username: "testuser",
      workspace: "test-workspace",
      label: "test-deployment",
    }

    it("should return credentials when valid URL and token exist", async () => {
      mockStorage.readCliConfig.mockResolvedValue({
        url: "https://coder.example.com",
        token: "test-token",
      })

      const result = await remote.validateCredentials(mockParts)

      expect(result).toEqual({
        baseUrlRaw: "https://coder.example.com",
        token: "test-token",
      })
      expect(mockStorage.migrateSessionToken).toHaveBeenCalledWith("test-deployment")
      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
        "Using deployment URL: https://coder.example.com"
      )
    })

    it("should prompt for login when no token exists", async () => {
      mockStorage.readCliConfig.mockResolvedValue({
        url: "https://coder.example.com",
        token: "",
      })
      mockVscodeProposed.window.showInformationMessage.mockResolvedValue("Log In")
      const closeRemoteSpy = vi.spyOn(remote, "closeRemote").mockResolvedValue()

      const result = await remote.validateCredentials(mockParts)

      expect(result).toEqual({})
      expect(mockVscodeProposed.window.showInformationMessage).toHaveBeenCalledWith(
        "You are not logged in...",
        {
          useCustom: true,
          modal: true,
          detail: "You must log in to access testuser/test-workspace.",
        },
        "Log In"
      )
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "coder.login",
        "https://coder.example.com",
        undefined,
        "test-deployment"
      )
    })

    it("should close remote when user declines to log in", async () => {
      mockStorage.readCliConfig.mockResolvedValue({
        url: "",
        token: "",
      })
      mockVscodeProposed.window.showInformationMessage.mockResolvedValue(undefined)
      const closeRemoteSpy = vi.spyOn(remote, "closeRemote").mockResolvedValue()

      const result = await remote.validateCredentials(mockParts)

      expect(result).toEqual({})
      expect(closeRemoteSpy).toHaveBeenCalled()
    })
  })

  describe("createWorkspaceClient", () => {
    it("should create workspace client using makeCoderSdk", async () => {
      const result = await remote.createWorkspaceClient("https://coder.example.com", "test-token")

      expect(result).toBe(mockRestClient)
      const { makeCoderSdk } = await import("./api")
      expect(makeCoderSdk).toHaveBeenCalledWith("https://coder.example.com", "test-token", mockStorage)
    })
  })

  describe("setupBinary", () => {
    it("should fetch binary in production mode", async () => {
      mockStorage.fetchBinary.mockResolvedValue("/path/to/coder")

      const result = await remote.setupBinary(mockRestClient, "test-label")

      expect(result).toBe("/path/to/coder")
      expect(mockStorage.fetchBinary).toHaveBeenCalledWith(mockRestClient, "test-label")
    })

    it("should use development binary when available in development mode", async () => {
      const devRemote = new TestableRemote(
        mockVscodeProposed,
        mockStorage,
        mockCommands,
        vscode.ExtensionMode.Development
      )

      const fs = await import("fs/promises")
      vi.mocked(fs.stat).mockResolvedValue({} as any) // Development binary exists

      const result = await devRemote.setupBinary(mockRestClient, "test-label")

      expect(result).toBe("/tmp/coder")
      expect(fs.stat).toHaveBeenCalledWith("/tmp/coder")
    })

    it("should fall back to fetched binary when development binary not found", async () => {
      const devRemote = new TestableRemote(
        mockVscodeProposed,
        mockStorage,
        mockCommands,
        vscode.ExtensionMode.Development
      )

      const fs = await import("fs/promises")
      vi.mocked(fs.stat).mockRejectedValue(new Error("ENOENT"))
      mockStorage.fetchBinary.mockResolvedValue("/path/to/fetched/coder")

      const result = await devRemote.setupBinary(mockRestClient, "test-label")

      expect(result).toBe("/path/to/fetched/coder")
      expect(mockStorage.fetchBinary).toHaveBeenCalled()
    })
  })

  describe("validateServerVersion", () => {
    it("should return feature set for compatible server version", async () => {
      mockRestClient.getBuildInfo.mockResolvedValue({ version: "v2.15.0" })
      
      const { featureSetForVersion } = await import("./featureSet")
      const { version } = await import("./cliManager")
      const semver = await import("semver")
      
      vi.mocked(version).mockResolvedValue("v2.15.0")
      vi.mocked(semver.parse).mockReturnValue({ major: 2, minor: 15, patch: 0 } as any)
      
      const mockFeatureSet = { vscodessh: true, proxyLogDirectory: true }
      vi.mocked(featureSetForVersion).mockReturnValue(mockFeatureSet)

      const result = await remote.validateServerVersion(mockRestClient, "/path/to/coder")

      expect(result).toBe(mockFeatureSet)
      expect(mockRestClient.getBuildInfo).toHaveBeenCalled()
    })

    it("should show error and close remote for incompatible server version", async () => {
      mockRestClient.getBuildInfo.mockResolvedValue({ version: "v0.13.0" })
      
      const { featureSetForVersion } = await import("./featureSet")
      const mockFeatureSet = { vscodessh: false }
      vi.mocked(featureSetForVersion).mockReturnValue(mockFeatureSet)
      
      const closeRemoteSpy = vi.spyOn(remote, "closeRemote").mockResolvedValue()

      const result = await remote.validateServerVersion(mockRestClient, "/path/to/coder")

      expect(result).toBeUndefined()
      expect(mockVscodeProposed.window.showErrorMessage).toHaveBeenCalledWith(
        "Incompatible Server",
        {
          detail: "Your Coder server is too old to support the Coder extension! Please upgrade to v0.14.1 or newer.",
          modal: true,
          useCustom: true,
        },
        "Close Remote"
      )
      expect(closeRemoteSpy).toHaveBeenCalled()
    })

    it("should fall back to server version when CLI version fails", async () => {
      mockRestClient.getBuildInfo.mockResolvedValue({ version: "v2.15.0" })
      
      const { version } = await import("./cliManager")
      const semver = await import("semver")
      
      vi.mocked(version).mockRejectedValue(new Error("CLI error"))
      vi.mocked(semver.parse).mockReturnValue({ major: 2, minor: 15, patch: 0 } as any)

      const result = await remote.validateServerVersion(mockRestClient, "/path/to/coder")

      expect(result).toBeDefined()
      expect(semver.parse).toHaveBeenCalledWith("v2.15.0")
    })
  })

  describe("fetchWorkspace", () => {
    const mockParts = {
      username: "testuser",
      workspace: "test-workspace",
      label: "test-deployment",
    }

    it("should return workspace when found successfully", async () => {
      mockRestClient.getWorkspaceByOwnerAndName.mockResolvedValue(mockWorkspace)

      const result = await remote.fetchWorkspace(
        mockRestClient,
        mockParts,
        "https://coder.example.com",
        "remote-authority"
      )

      expect(result).toBe(mockWorkspace)
      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
        "Looking for workspace testuser/test-workspace..."
      )
      expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
        "Found workspace testuser/test-workspace with status running"
      )
    })

    it("should handle workspace not found (404)", async () => {
      const axiosError = new Error("Not Found") as any
      axiosError.isAxiosError = true
      axiosError.response = { status: 404 }
      
      mockRestClient.getWorkspaceByOwnerAndName.mockRejectedValue(axiosError)
      mockVscodeProposed.window.showInformationMessage.mockResolvedValue("Open Workspace")
      const closeRemoteSpy = vi.spyOn(remote, "closeRemote").mockResolvedValue()

      const result = await remote.fetchWorkspace(
        mockRestClient,
        mockParts,
        "https://coder.example.com",
        "remote-authority"
      )

      expect(result).toBeUndefined()
      expect(mockVscodeProposed.window.showInformationMessage).toHaveBeenCalledWith(
        "That workspace doesn't exist!",
        {
          modal: true,
          detail: "testuser/test-workspace cannot be found on https://coder.example.com. Maybe it was deleted...",
          useCustom: true,
        },
        "Open Workspace"
      )
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith("coder.open")
    })

    it("should handle session expired (401)", async () => {
      const axiosError = new Error("Unauthorized") as any
      axiosError.isAxiosError = true
      axiosError.response = { status: 401 }
      
      mockRestClient.getWorkspaceByOwnerAndName.mockRejectedValue(axiosError)
      mockVscodeProposed.window.showInformationMessage.mockResolvedValue("Log In")
      const setupSpy = vi.spyOn(remote, "setup").mockResolvedValue(undefined)

      const result = await remote.fetchWorkspace(
        mockRestClient,
        mockParts,
        "https://coder.example.com",
        "remote-authority"
      )

      expect(result).toBeUndefined()
      expect(mockVscodeProposed.window.showInformationMessage).toHaveBeenCalledWith(
        "Your session expired...",
        {
          useCustom: true,
          modal: true,
          detail: "You must log in to access testuser/test-workspace.",
        },
        "Log In"
      )
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "coder.login",
        "https://coder.example.com",
        undefined,
        "test-deployment"
      )
    })

    it("should rethrow non-axios errors", async () => {
      const regularError = new Error("Some other error")
      mockRestClient.getWorkspaceByOwnerAndName.mockRejectedValue(regularError)

      await expect(
        remote.fetchWorkspace(mockRestClient, mockParts, "https://coder.example.com", "remote-authority")
      ).rejects.toThrow("Some other error")
    })
  })

  describe("closeRemote", () => {
    it("should execute workbench close remote command", async () => {
      await remote.closeRemote()

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "workbench.action.remote.close"
      )
    })
  })

  describe("reloadWindow", () => {
    it("should execute workbench reload window command", async () => {
      await remote.reloadWindow()

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "workbench.action.reloadWindow"
      )
    })
  })
})