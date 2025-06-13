import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { Commands } from "./commands"
import { Storage } from "./storage"
import { Api } from "coder/site/src/api/api"
import { User, Workspace } from "coder/site/src/api/typesGenerated"
import * as apiModule from "./api"
import { CertificateError } from "./error"
import { getErrorMessage } from "coder/site/src/api/errors"

// Mock vscode module
vi.mock("vscode", () => ({
  commands: {
    executeCommand: vi.fn(),
  },
  window: {
    showInputBox: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    createQuickPick: vi.fn(),
    showQuickPick: vi.fn(),
    createTerminal: vi.fn(),
    withProgress: vi.fn(),
    showTextDocument: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(),
    openTextDocument: vi.fn(),
    workspaceFolders: [],
  },
  Uri: {
    parse: vi.fn().mockReturnValue({ toString: () => "parsed-uri" }),
    file: vi.fn().mockReturnValue({ toString: () => "file-uri" }),
    from: vi.fn().mockImplementation((options: any) => ({
      scheme: options.scheme,
      authority: options.authority,
      path: options.path,
      toString: () => `${options.scheme}://${options.authority}${options.path}`,
    })),
  },
  env: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
  ProgressLocation: {
    Notification: 15,
  },
  InputBoxValidationSeverity: {
    Error: 3,
  },
}))

// Mock dependencies
vi.mock("./api", () => ({
  makeCoderSdk: vi.fn(),
  needToken: vi.fn(),
}))

vi.mock("./error", () => ({
  CertificateError: vi.fn(),
}))

vi.mock("coder/site/src/api/errors", () => ({
  getErrorMessage: vi.fn(),
}))

vi.mock("./storage", () => ({
  Storage: vi.fn(),
}))

vi.mock("./util", () => ({
  toRemoteAuthority: vi.fn((baseUrl: string, owner: string, name: string, agent?: string) => {
    const host = baseUrl.replace("https://", "").replace("http://", "")
    return `coder-${host}-${owner}-${name}${agent ? `-${agent}` : ""}`
  }),
  toSafeHost: vi.fn((url: string) => url.replace("https://", "").replace("http://", "")),
}))

describe("Commands", () => {
  let commands: Commands
  let mockVscodeProposed: typeof vscode
  let mockRestClient: Api
  let mockStorage: Storage
  let mockQuickPick: any
  let mockTerminal: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockVscodeProposed = vscode as any

    mockRestClient = {
      setHost: vi.fn(),
      setSessionToken: vi.fn(),
      getAuthenticatedUser: vi.fn(),
      getWorkspaces: vi.fn(),
      updateWorkspaceVersion: vi.fn(),
      getAxiosInstance: vi.fn(() => ({
        defaults: {
          baseURL: "https://coder.example.com",
        },
      })),
    } as any

    mockStorage = {
      getUrl: vi.fn(() => "https://coder.example.com"),
      setUrl: vi.fn(),
      getSessionToken: vi.fn(),
      setSessionToken: vi.fn(),
      configureCli: vi.fn(),
      withUrlHistory: vi.fn(() => ["https://coder.example.com"]),
      fetchBinary: vi.fn(),
      getSessionTokenPath: vi.fn(),
      writeToCoderOutputChannel: vi.fn(),
    } as any

    mockQuickPick = {
      value: "",
      placeholder: "",
      title: "",
      items: [],
      busy: false,
      show: vi.fn(),
      dispose: vi.fn(),
      onDidHide: vi.fn(),
      onDidChangeValue: vi.fn(),
      onDidChangeSelection: vi.fn(),
    }

    mockTerminal = {
      sendText: vi.fn(),
      show: vi.fn(),
    }

    vi.mocked(vscode.window.createQuickPick).mockReturnValue(mockQuickPick)
    vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal)
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => ""),
    } as any)

    // Default mock for vscode.commands.executeCommand
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command: string) => {
      if (command === "_workbench.getRecentlyOpened") {
        return { workspaces: [] }
      }
      return undefined
    })

    commands = new Commands(mockVscodeProposed, mockRestClient, mockStorage)
  })

  describe("basic Commands functionality", () => {
    const mockUser: User = {
      id: "user-1",
      username: "testuser",
      roles: [{ name: "owner" }],
    } as User

    beforeEach(() => {
      vi.mocked(apiModule.makeCoderSdk).mockResolvedValue(mockRestClient)
      vi.mocked(apiModule.needToken).mockReturnValue(true)
      vi.mocked(mockRestClient.getAuthenticatedUser).mockResolvedValue(mockUser)
      vi.mocked(getErrorMessage).mockReturnValue("Test error")
    })

    it("should login with provided URL and token", async () => {
      vi.mocked(vscode.window.showInputBox).mockImplementation(async (options: any) => {
        if (options.validateInput) {
          await options.validateInput("test-token")
        }
        return "test-token"
      })
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined)
      vi.mocked(vscode.env.openExternal).mockResolvedValue(true)

      await commands.login("https://coder.example.com", "test-token")

      expect(mockRestClient.setHost).toHaveBeenCalledWith("https://coder.example.com")
      expect(mockRestClient.setSessionToken).toHaveBeenCalledWith("test-token")
    })

    it("should logout successfully", async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined)
      
      await commands.logout()

      expect(mockRestClient.setHost).toHaveBeenCalledWith("")
      expect(mockRestClient.setSessionToken).toHaveBeenCalledWith("")
    })

    it("should view logs when path is set", async () => {
      const logPath = "/tmp/workspace.log"
      const mockUri = { toString: () => `file://${logPath}` }
      const mockDoc = { fileName: logPath }

      commands.workspaceLogPath = logPath
      vi.mocked(vscode.Uri.file).mockReturnValue(mockUri as any)
      vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(mockDoc as any)

      await commands.viewLogs()

      expect(vscode.Uri.file).toHaveBeenCalledWith(logPath)
      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(mockUri)
    })
  })

  describe("workspace operations", () => {
    const mockTreeItem = {
      workspaceOwner: "testuser",
      workspaceName: "testworkspace",
      workspaceAgent: "main",
      workspaceFolderPath: "/workspace",
    }

    it("should open workspace from sidebar", async () => {
      await commands.openFromSidebar(mockTreeItem as any)

      // Should call _workbench.getRecentlyOpened first, then vscode.openFolder
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith("_workbench.getRecentlyOpened")
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.openFolder",
        expect.objectContaining({
          scheme: "vscode-remote",
          path: "/workspace",
        }),
        false // newWindow is false when no workspace folders exist
      )
    })

    it("should open workspace with direct arguments", async () => {
      await commands.open("testuser", "testworkspace", undefined, "/custom/path", false)

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.openFolder",
        expect.objectContaining({
          scheme: "vscode-remote",
          path: "/custom/path",
        }),
        false
      )
    })

    it("should open dev container", async () => {
      await commands.openDevContainer("testuser", "testworkspace", undefined, "mycontainer", "/container/path")

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.openFolder",
        expect.objectContaining({
          scheme: "vscode-remote",
          authority: expect.stringContaining("attached-container+"),
          path: "/container/path",
        }),
        false
      )
    })

    it("should use first recent workspace when openRecent=true with multiple workspaces", async () => {
      const recentWorkspaces = {
        workspaces: [
          {
            folderUri: {
              authority: "coder-coder.example.com-testuser-testworkspace-main",
              path: "/recent/path1",
            },
          },
          {
            folderUri: {
              authority: "coder-coder.example.com-testuser-testworkspace-main", 
              path: "/recent/path2",
            },
          },
        ],
      }

      vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command: string) => {
        if (command === "_workbench.getRecentlyOpened") {
          return recentWorkspaces
        }
        return undefined
      })

      const treeItemWithoutPath = {
        ...mockTreeItem,
        workspaceFolderPath: undefined,
      }

      await commands.openFromSidebar(treeItemWithoutPath as any)

      // openFromSidebar passes openRecent=true, so with multiple recent workspaces it should use the first one
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled()
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.openFolder",
        expect.objectContaining({
          scheme: "vscode-remote",
          path: "/recent/path1",
        }),
        false
      )
    })

    it("should use single recent workspace automatically", async () => {
      const recentWorkspaces = {
        workspaces: [
          {
            folderUri: {
              authority: "coder-coder.example.com-testuser-testworkspace-main",
              path: "/recent/single",
            },
          },
        ],
      }

      vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command: string) => {
        if (command === "_workbench.getRecentlyOpened") {
          return recentWorkspaces
        }
        return undefined
      })

      const treeItemWithoutPath = {
        ...mockTreeItem,
        workspaceFolderPath: undefined,
      }

      await commands.openFromSidebar(treeItemWithoutPath as any)

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled()
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.openFolder",
        expect.objectContaining({
          path: "/recent/single",
        }),
        false
      )
    })

    it("should open new window when no folder path available", async () => {
      const recentWorkspaces = { workspaces: [] }

      vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command: string) => {
        if (command === "_workbench.getRecentlyOpened") {
          return recentWorkspaces
        }
        return undefined
      })

      const treeItemWithoutPath = {
        ...mockTreeItem,
        workspaceFolderPath: undefined,
      }

      await commands.openFromSidebar(treeItemWithoutPath as any)

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.newWindow", {
        remoteAuthority: "coder-coder.example.com-testuser-testworkspace-main",
        reuseWindow: true,
      })
    })

    it("should use new window when workspace folders exist", async () => {
      vi.mocked(vscode.workspace).workspaceFolders = [{ uri: { path: "/existing" } }] as any

      await commands.openDevContainer("testuser", "testworkspace", undefined, "mycontainer", "/container/path")

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.openFolder",
        expect.anything(),
        true
      )
    })

  })

  describe("error handling", () => {
    it("should throw error if not logged in for openFromSidebar", async () => {
      vi.mocked(mockRestClient.getAxiosInstance).mockReturnValue({
        defaults: { baseURL: undefined },
      } as any)

      const mockTreeItem = {
        workspaceOwner: "testuser",
        workspaceName: "testworkspace",
      }

      await expect(commands.openFromSidebar(mockTreeItem as any)).rejects.toThrow(
        "You are not logged in"
      )
    })

    it("should call open() method when no tree item provided to openFromSidebar", async () => {
      const openSpy = vi.spyOn(commands, "open").mockResolvedValue()

      await commands.openFromSidebar(null as any)

      expect(openSpy).toHaveBeenCalled()
      openSpy.mockRestore()
    })
  })
})