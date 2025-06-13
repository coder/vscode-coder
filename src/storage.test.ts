import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { Storage } from "./storage"
import * as fs from "fs/promises"
import * as path from "path"
import { IncomingMessage } from "http"
import { createWriteStream } from "fs"
import { Readable } from "stream"
import { Api } from "coder/site/src/api/api"
import * as cli from "./cliManager"

// Mock fs promises module
vi.mock("fs/promises")

// Mock fs createWriteStream
vi.mock("fs", () => ({
  createWriteStream: vi.fn(),
}))

// Mock cliManager
vi.mock("./cliManager", () => ({
  name: vi.fn(),
  stat: vi.fn(),
  version: vi.fn(),
  rmOld: vi.fn(),
  eTag: vi.fn(),
  goos: vi.fn(),
  goarch: vi.fn(),
}))

// Mock vscode
vi.mock("vscode", () => ({
  window: {
    showErrorMessage: vi.fn(),
    withProgress: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(),
  },
  env: {
    openExternal: vi.fn(),
  },
  Uri: {
    parse: vi.fn(),
  },
  ProgressLocation: {
    Notification: 15,
  },
}))

// Mock headers module
vi.mock("./headers", () => ({
  getHeaderCommand: vi.fn(),
  getHeaders: vi.fn(),
}))

describe("Storage", () => {
  let storage: Storage
  let mockOutputChannel: any
  let mockMemento: any
  let mockSecrets: any
  let mockGlobalStorageUri: any
  let mockLogUri: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup fs promises mocks
    vi.mocked(fs.readdir).mockImplementation(() => Promise.resolve([] as any))
    vi.mocked(fs.readFile).mockImplementation(() => Promise.resolve("" as any))
    vi.mocked(fs.writeFile).mockImplementation(() => Promise.resolve())
    vi.mocked(fs.mkdir).mockImplementation(() => Promise.resolve("" as any))
    vi.mocked(fs.rename).mockImplementation(() => Promise.resolve())

    mockOutputChannel = {
      appendLine: vi.fn(),
      show: vi.fn(),
    }

    mockMemento = {
      get: vi.fn(),
      update: vi.fn(),
    }

    mockSecrets = {
      get: vi.fn(),
      store: vi.fn(),
      delete: vi.fn(),
    }

    mockGlobalStorageUri = {
      fsPath: "/global/storage",
    }

    mockLogUri = {
      fsPath: "/logs/extension.log",
    }

    storage = new Storage(
      mockOutputChannel,
      mockMemento,
      mockSecrets,
      mockGlobalStorageUri,
      mockLogUri
    )
  })

  describe("URL management", () => {
    describe("setUrl", () => {
      it("should set URL and update history when URL is provided", async () => {
        mockMemento.get.mockReturnValue(["old-url1", "old-url2"])

        await storage.setUrl("https://new.coder.example.com")

        expect(mockMemento.update).toHaveBeenCalledWith("url", "https://new.coder.example.com")
        expect(mockMemento.update).toHaveBeenCalledWith("urlHistory", [
          "old-url1",
          "old-url2", 
          "https://new.coder.example.com"
        ])
      })

      it("should only set URL to undefined when no URL provided", async () => {
        await storage.setUrl(undefined)

        expect(mockMemento.update).toHaveBeenCalledWith("url", undefined)
        expect(mockMemento.update).toHaveBeenCalledTimes(1)
      })

      it("should only set URL to undefined when empty string provided", async () => {
        await storage.setUrl("")

        expect(mockMemento.update).toHaveBeenCalledWith("url", "")
        expect(mockMemento.update).toHaveBeenCalledTimes(1)
      })
    })

    describe("getUrl", () => {
      it("should return stored URL", () => {
        mockMemento.get.mockReturnValue("https://stored.coder.example.com")

        const result = storage.getUrl()

        expect(result).toBe("https://stored.coder.example.com")
        expect(mockMemento.get).toHaveBeenCalledWith("url")
      })

      it("should return undefined when no URL stored", () => {
        mockMemento.get.mockReturnValue(undefined)

        const result = storage.getUrl()

        expect(result).toBeUndefined()
      })
    })

    describe("withUrlHistory", () => {
      it("should return current history with new URLs appended", () => {
        mockMemento.get.mockReturnValue(["url1", "url2"])

        const result = storage.withUrlHistory("url3", "url4")

        expect(result).toEqual(["url1", "url2", "url3", "url4"])
      })

      it("should remove duplicates and move existing URLs to end", () => {
        mockMemento.get.mockReturnValue(["url1", "url2", "url3"])

        const result = storage.withUrlHistory("url2", "url4")

        expect(result).toEqual(["url1", "url3", "url2", "url4"])
      })

      it("should filter out undefined URLs", () => {
        mockMemento.get.mockReturnValue(["url1"])

        const result = storage.withUrlHistory("url2", undefined, "url3")

        expect(result).toEqual(["url1", "url2", "url3"])
      })

      it("should limit history to MAX_URLS (10)", () => {
        const longHistory = Array.from({ length: 12 }, (_, i) => `url${i}`)
        mockMemento.get.mockReturnValue(longHistory)

        const result = storage.withUrlHistory("newUrl")

        expect(result).toHaveLength(10)
        expect(result[result.length - 1]).toBe("newUrl")
        expect(result[0]).toBe("url3") // First 3 should be removed
      })

      it("should handle empty history", () => {
        mockMemento.get.mockReturnValue(undefined)

        const result = storage.withUrlHistory("url1", "url2")

        expect(result).toEqual(["url1", "url2"])
      })

      it("should handle non-array history", () => {
        mockMemento.get.mockReturnValue("invalid-data")

        const result = storage.withUrlHistory("url1")

        expect(result).toEqual(["url1"])
      })
    })
  })

  describe("Session token management", () => {
    describe("setSessionToken", () => {
      it("should store session token when provided", async () => {
        await storage.setSessionToken("test-token")

        expect(mockSecrets.store).toHaveBeenCalledWith("sessionToken", "test-token")
        expect(mockSecrets.delete).not.toHaveBeenCalled()
      })

      it("should delete session token when undefined provided", async () => {
        await storage.setSessionToken(undefined)

        expect(mockSecrets.delete).toHaveBeenCalledWith("sessionToken")
        expect(mockSecrets.store).not.toHaveBeenCalled()
      })

      it("should delete session token when empty string provided", async () => {
        await storage.setSessionToken("")

        expect(mockSecrets.delete).toHaveBeenCalledWith("sessionToken")
        expect(mockSecrets.store).not.toHaveBeenCalled()
      })
    })

    describe("getSessionToken", () => {
      it("should return stored session token", async () => {
        mockSecrets.get.mockResolvedValue("stored-token")

        const result = await storage.getSessionToken()

        expect(result).toBe("stored-token")
        expect(mockSecrets.get).toHaveBeenCalledWith("sessionToken")
      })

      it("should return undefined when secrets.get throws", async () => {
        mockSecrets.get.mockRejectedValue(new Error("Secrets store corrupted"))

        const result = await storage.getSessionToken()

        expect(result).toBeUndefined()
      })

      it("should return undefined when no token stored", async () => {
        mockSecrets.get.mockResolvedValue(undefined)

        const result = await storage.getSessionToken()

        expect(result).toBeUndefined()
      })
    })
  })

  describe("Remote SSH log path", () => {
    describe("getRemoteSSHLogPath", () => {
      it("should return path to Remote SSH log file", async () => {
        vi.mocked(fs.readdir)
          .mockResolvedValueOnce(["output_logging_20240101", "output_logging_20240102"] as any)
          .mockResolvedValueOnce(["extension1.log", "Remote - SSH.log", "extension2.log"] as any)

        const result = await storage.getRemoteSSHLogPath()

        expect(result).toBe("/logs/output_logging_20240102/Remote - SSH.log")
        expect(fs.readdir).toHaveBeenCalledWith("/logs")
        expect(fs.readdir).toHaveBeenCalledWith("/logs/output_logging_20240102")
      })

      it("should return undefined when no output logging directories found", async () => {
        vi.mocked(fs.readdir).mockResolvedValueOnce(["other-dir"] as any)

        const result = await storage.getRemoteSSHLogPath()

        expect(result).toBeUndefined()
      })

      it("should return undefined when no Remote SSH log file found", async () => {
        vi.mocked(fs.readdir)
          .mockResolvedValueOnce(["output_logging_20240101"] as any)
          .mockResolvedValueOnce(["extension1.log", "extension2.log"] as any)

        const result = await storage.getRemoteSSHLogPath()

        expect(result).toBeUndefined()
      })

      it("should use latest output logging directory", async () => {
        vi.mocked(fs.readdir)
          .mockResolvedValueOnce(["output_logging_20240101", "output_logging_20240102", "output_logging_20240103"] as any)
          .mockResolvedValueOnce(["Remote - SSH.log"] as any)

        const result = await storage.getRemoteSSHLogPath()

        expect(result).toBe("/logs/output_logging_20240103/Remote - SSH.log")
      })
    })
  })

  describe("Path methods", () => {
    describe("getBinaryCachePath", () => {
      it("should return custom path when binaryDestination is configured", () => {
        const mockConfig = {
          get: vi.fn().mockReturnValue("/custom/binary/path"),
        }
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

        const result = storage.getBinaryCachePath("test-label")

        expect(result).toBe("/custom/binary/path")
      })

      it("should return labeled path when label provided and no custom destination", () => {
        const mockConfig = {
          get: vi.fn().mockReturnValue(""),
        }
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

        const result = storage.getBinaryCachePath("test-label")

        expect(result).toBe("/global/storage/test-label/bin")
      })

      it("should return unlabeled path when no label and no custom destination", () => {
        const mockConfig = {
          get: vi.fn().mockReturnValue(""),
        }
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

        const result = storage.getBinaryCachePath("")

        expect(result).toBe("/global/storage/bin")
      })

      it("should resolve custom path from relative to absolute", () => {
        const mockConfig = {
          get: vi.fn().mockReturnValue("./relative/path"),
        }
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

        const result = storage.getBinaryCachePath("test")

        expect(path.isAbsolute(result)).toBe(true)
      })
    })

    describe("getNetworkInfoPath", () => {
      it("should return network info path", () => {
        const result = storage.getNetworkInfoPath()

        expect(result).toBe("/global/storage/net")
      })
    })

    describe("getLogPath", () => {
      it("should return log path", () => {
        const result = storage.getLogPath()

        expect(result).toBe("/global/storage/log")
      })
    })

    describe("getUserSettingsPath", () => {
      it("should return user settings path", () => {
        const result = storage.getUserSettingsPath()

        // The path.join will resolve the relative path
        expect(result).toBe(path.join("/global/storage", "..", "..", "..", "User", "settings.json"))
      })
    })

    describe("getSessionTokenPath", () => {
      it("should return labeled session token path", () => {
        const result = storage.getSessionTokenPath("test-label")

        expect(result).toBe("/global/storage/test-label/session")
      })

      it("should return unlabeled session token path", () => {
        const result = storage.getSessionTokenPath("")

        expect(result).toBe("/global/storage/session")
      })
    })

    describe("getLegacySessionTokenPath", () => {
      it("should return labeled legacy session token path", () => {
        const result = storage.getLegacySessionTokenPath("test-label")

        expect(result).toBe("/global/storage/test-label/session_token")
      })

      it("should return unlabeled legacy session token path", () => {
        const result = storage.getLegacySessionTokenPath("")

        expect(result).toBe("/global/storage/session_token")
      })
    })

    describe("getUrlPath", () => {
      it("should return labeled URL path", () => {
        const result = storage.getUrlPath("test-label")

        expect(result).toBe("/global/storage/test-label/url")
      })

      it("should return unlabeled URL path", () => {
        const result = storage.getUrlPath("")

        expect(result).toBe("/global/storage/url")
      })
    })
  })

  describe("Output logging", () => {
    describe("writeToCoderOutputChannel", () => {
      it("should write timestamped message to output channel", () => {
        const mockDate = new Date("2024-01-01T12:00:00Z")
        vi.setSystemTime(mockDate)

        storage.writeToCoderOutputChannel("Test message")

        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
          "[2024-01-01T12:00:00.000Z] Test message"
        )

        vi.useRealTimers()
      })
    })
  })

  describe("CLI configuration", () => {
    describe("configureCli", () => {
      it("should update both URL and token", async () => {
        const updateUrlSpy = vi.spyOn(storage as any, "updateUrlForCli").mockResolvedValue(undefined)
        const updateTokenSpy = vi.spyOn(storage as any, "updateTokenForCli").mockResolvedValue(undefined)

        await storage.configureCli("test-label", "https://test.com", "test-token")

        expect(updateUrlSpy).toHaveBeenCalledWith("test-label", "https://test.com")
        expect(updateTokenSpy).toHaveBeenCalledWith("test-label", "test-token")
      })
    })

    describe("updateUrlForCli", () => {
      it("should write URL to file when URL provided", async () => {
        const updateUrlForCli = (storage as any).updateUrlForCli.bind(storage)

        await updateUrlForCli("test-label", "https://test.com")

        expect(fs.mkdir).toHaveBeenCalledWith("/global/storage/test-label", { recursive: true })
        expect(fs.writeFile).toHaveBeenCalledWith("/global/storage/test-label/url", "https://test.com")
      })

      it("should not write file when URL is falsy", async () => {
        const updateUrlForCli = (storage as any).updateUrlForCli.bind(storage)

        await updateUrlForCli("test-label", undefined)

        expect(fs.mkdir).not.toHaveBeenCalled()
        expect(fs.writeFile).not.toHaveBeenCalled()
      })
    })

    describe("updateTokenForCli", () => {
      it("should write token to file when token provided", async () => {
        const updateTokenForCli = (storage as any).updateTokenForCli.bind(storage)

        await updateTokenForCli("test-label", "test-token")

        expect(fs.mkdir).toHaveBeenCalledWith("/global/storage/test-label", { recursive: true })
        expect(fs.writeFile).toHaveBeenCalledWith("/global/storage/test-label/session", "test-token")
      })

      it("should write empty string when token is empty", async () => {
        const updateTokenForCli = (storage as any).updateTokenForCli.bind(storage)

        await updateTokenForCli("test-label", "")

        expect(fs.writeFile).toHaveBeenCalledWith("/global/storage/test-label/session", "")
      })

      it("should not write file when token is null", async () => {
        const updateTokenForCli = (storage as any).updateTokenForCli.bind(storage)

        await updateTokenForCli("test-label", null)

        expect(fs.mkdir).not.toHaveBeenCalled()
        expect(fs.writeFile).not.toHaveBeenCalled()
      })
    })

    describe("readCliConfig", () => {
      it("should read both URL and token files", async () => {
        vi.mocked(fs.readFile)
          .mockResolvedValueOnce("https://test.com\n" as any)
          .mockResolvedValueOnce("test-token\n" as any)

        const result = await storage.readCliConfig("test-label")

        expect(result).toEqual({
          url: "https://test.com",
          token: "test-token",
        })
        expect(fs.readFile).toHaveBeenCalledWith("/global/storage/test-label/url", "utf8")
        expect(fs.readFile).toHaveBeenCalledWith("/global/storage/test-label/session", "utf8")
      })

      it("should return empty strings when files do not exist", async () => {
        vi.mocked(fs.readFile)
          .mockRejectedValueOnce(new Error("ENOENT"))
          .mockRejectedValueOnce(new Error("ENOENT"))

        const result = await storage.readCliConfig("test-label")

        expect(result).toEqual({
          url: "",
          token: "",
        })
      })

      it("should trim whitespace from file contents", async () => {
        vi.mocked(fs.readFile)
          .mockResolvedValueOnce("  https://test.com  \n" as any)
          .mockResolvedValueOnce("  test-token  \n" as any)

        const result = await storage.readCliConfig("test-label")

        expect(result).toEqual({
          url: "https://test.com",
          token: "test-token",
        })
      })
    })

    describe("migrateSessionToken", () => {
      it("should rename legacy token file to new location", async () => {
        vi.mocked(fs.rename).mockResolvedValue()

        await storage.migrateSessionToken("test-label")

        expect(fs.rename).toHaveBeenCalledWith(
          "/global/storage/test-label/session_token",
          "/global/storage/test-label/session"
        )
      })

      it("should ignore ENOENT errors", async () => {
        const error = new Error("File not found") as NodeJS.ErrnoException
        error.code = "ENOENT"
        vi.mocked(fs.rename).mockRejectedValue(error)

        await expect(storage.migrateSessionToken("test-label")).resolves.toBeUndefined()
      })

      it("should throw non-ENOENT errors", async () => {
        const error = new Error("Permission denied") as NodeJS.ErrnoException
        error.code = "EACCES"
        vi.mocked(fs.rename).mockRejectedValue(error)

        await expect(storage.migrateSessionToken("test-label")).rejects.toThrow("Permission denied")
      })
    })
  })

  describe("fetchBinary", () => {
    let mockRestClient: any
    let mockWriteStream: any
    let mockReadStream: any

    beforeEach(() => {
      mockRestClient = {
        getBuildInfo: vi.fn(),
        getAxiosInstance: vi.fn(),
      }

      mockWriteStream = {
        write: vi.fn(),
        close: vi.fn(),
        on: vi.fn(),
      }

      mockReadStream = {
        on: vi.fn(),
        destroy: vi.fn(),
      }

      vi.mocked(createWriteStream).mockReturnValue(mockWriteStream as any)
      vi.mocked(cli.name).mockReturnValue("coder")
      vi.mocked(cli.stat).mockResolvedValue(undefined)
      vi.mocked(cli.rmOld).mockResolvedValue([])
      vi.mocked(cli.eTag).mockResolvedValue("")
      vi.mocked(cli.goos).mockReturnValue("linux")
      vi.mocked(cli.goarch).mockReturnValue("amd64")

      const mockConfig = {
        get: vi.fn((key: string) => {
          if (key === "coder.enableDownloads") return true
          if (key === "coder.binarySource") return ""
          return ""
        }),
      }
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)
    })

    it("should return existing binary when version matches server", async () => {
      const mockStat = { size: 12345 }
      vi.mocked(cli.stat).mockResolvedValue(mockStat)
      vi.mocked(cli.version).mockResolvedValue("v2.15.0")
      
      mockRestClient.getBuildInfo.mockResolvedValue({ version: "v2.15.0" })
      mockRestClient.getAxiosInstance.mockReturnValue({
        defaults: { baseURL: "https://coder.example.com" },
      })

      const result = await storage.fetchBinary(mockRestClient, "test-label")

      expect(result).toBe("/global/storage/test-label/bin/coder")
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        "Using existing binary since it matches the server version"
      )
    })

    it("should download new binary when version does not match", async () => {
      const mockStat = { size: 12345 }
      vi.mocked(cli.stat).mockResolvedValue(mockStat)
      vi.mocked(cli.version)
        .mockResolvedValueOnce("v2.14.0") // existing version
        .mockResolvedValueOnce("v2.15.0") // downloaded version

      mockRestClient.getBuildInfo.mockResolvedValue({ version: "v2.15.0" })
      mockRestClient.getAxiosInstance.mockReturnValue({
        defaults: { baseURL: "https://coder.example.com" },
        get: vi.fn().mockResolvedValue({
          status: 200,
          headers: { "content-length": "1000" },
          data: mockReadStream,
        }),
      })

      // Mock progress dialog
      vi.mocked(vscode.window.withProgress).mockImplementation(async (options, callback) => {
        const progress = { report: vi.fn() }
        const token = { onCancellationRequested: vi.fn() }
        
        // Simulate successful download
        setTimeout(() => {
          const closeHandler = mockReadStream.on.mock.calls.find(call => call[0] === "close")?.[1]
          if (closeHandler) closeHandler()
        }, 0)

        return await callback(progress, token)
      })

      const result = await storage.fetchBinary(mockRestClient, "test-label")

      expect(result).toBe("/global/storage/test-label/bin/coder")
      expect(fs.mkdir).toHaveBeenCalledWith("/global/storage/test-label/bin", { recursive: true })
    })

    it("should throw error when downloads are disabled", async () => {
      const mockConfig = {
        get: vi.fn((key: string) => {
          if (key === "coder.enableDownloads") return false
          return ""
        }),
      }
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

      mockRestClient.getBuildInfo.mockResolvedValue({ version: "v2.15.0" })
      mockRestClient.getAxiosInstance.mockReturnValue({
        defaults: { baseURL: "https://coder.example.com" },
      })

      await expect(storage.fetchBinary(mockRestClient, "test-label")).rejects.toThrow(
        "Unable to download CLI because downloads are disabled"
      )
    })

    it("should handle 404 response and show platform support message", async () => {
      mockRestClient.getBuildInfo.mockResolvedValue({ version: "v2.15.0" })
      mockRestClient.getAxiosInstance.mockReturnValue({
        defaults: { baseURL: "https://coder.example.com" },
        get: vi.fn().mockResolvedValue({
          status: 404,
        }),
      })

      vi.mocked(vscode.window.showErrorMessage).mockResolvedValue("Open an Issue")
      vi.mocked(vscode.Uri.parse).mockReturnValue({ toString: () => "test-uri" } as any)

      await expect(storage.fetchBinary(mockRestClient, "test-label")).rejects.toThrow(
        "Platform not supported"
      )

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "Coder isn't supported for your platform. Please open an issue, we'd love to support it!",
        "Open an Issue"
      )
    })

    it("should handle 304 response and use existing binary", async () => {
      const mockStat = { size: 12345 }
      vi.mocked(cli.stat).mockResolvedValue(mockStat)
      vi.mocked(cli.version).mockResolvedValue("v2.14.0") // Different version to trigger download
      vi.mocked(cli.eTag).mockResolvedValue("existing-etag")

      mockRestClient.getBuildInfo.mockResolvedValue({ version: "v2.15.0" })
      mockRestClient.getAxiosInstance.mockReturnValue({
        defaults: { baseURL: "https://coder.example.com" },
        get: vi.fn().mockResolvedValue({
          status: 304,
        }),
      })

      const result = await storage.fetchBinary(mockRestClient, "test-label")

      expect(result).toBe("/global/storage/test-label/bin/coder")
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        "Using existing binary since server returned a 304"
      )
    })

    it("should handle download cancellation", async () => {
      mockRestClient.getBuildInfo.mockResolvedValue({ version: "v2.15.0" })
      mockRestClient.getAxiosInstance.mockReturnValue({
        defaults: { baseURL: "https://coder.example.com" },
        get: vi.fn().mockResolvedValue({
          status: 200,
          headers: { "content-length": "1000" },
          data: mockReadStream,
        }),
      })

      // Mock progress dialog that gets cancelled
      vi.mocked(vscode.window.withProgress).mockImplementation(async (options, callback) => {
        const progress = { report: vi.fn() }
        const token = { onCancellationRequested: vi.fn() }
        
        // Return false to simulate cancellation
        return false
      })

      await expect(storage.fetchBinary(mockRestClient, "test-label")).rejects.toThrow(
        "User aborted download"
      )
    })

    it("should use custom binary source when configured", async () => {
      const mockConfig = {
        get: vi.fn((key: string) => {
          if (key === "coder.enableDownloads") return true
          if (key === "coder.binarySource") return "/custom/path/coder"
          return ""
        }),
      }
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

      mockRestClient.getBuildInfo.mockResolvedValue({ version: "v2.15.0" })
      mockRestClient.getAxiosInstance.mockReturnValue({
        defaults: { baseURL: "https://coder.example.com" },
        get: vi.fn().mockResolvedValue({
          status: 200,
          headers: { "content-length": "1000" },
          data: mockReadStream,
        }),
      })

      // Mock progress dialog
      vi.mocked(vscode.window.withProgress).mockImplementation(async (options, callback) => {
        const progress = { report: vi.fn() }
        const token = { onCancellationRequested: vi.fn() }
        
        setTimeout(() => {
          const closeHandler = mockReadStream.on.mock.calls.find(call => call[0] === "close")?.[1]
          if (closeHandler) closeHandler()
        }, 0)

        return await callback(progress, token)
      })

      await storage.fetchBinary(mockRestClient, "test-label")

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        "Downloading binary from: /custom/path/coder"
      )
    })
  })

  describe("getHeaders", () => {
    it("should call getHeaders from headers module", async () => {
      const { getHeaderCommand, getHeaders } = await import("./headers")
      const mockConfig = { get: vi.fn() }
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)
      vi.mocked(getHeaderCommand).mockReturnValue("test-command")
      vi.mocked(getHeaders).mockResolvedValue({ "X-Test": "value" })

      const result = await storage.getHeaders("https://test.com")

      expect(getHeaders).toHaveBeenCalledWith("https://test.com", "test-command", storage)
      expect(result).toEqual({ "X-Test": "value" })
    })
  })
})