import { expect, describe, it, vi } from "vitest"
import * as vscode from "vscode"
import { Remote } from "./remote"
import type { Storage } from "./storage"
import type { Commands } from "./commands"

// Mock vscode
const mockVscode = {
  ExtensionMode: {
    Production: 1,
  },
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(),
  },
} as unknown as typeof vscode

vi.mock("vscode", () => mockVscode)

// Mock dependencies
const storage = {
  writeToCoderOutputChannel: vi.fn(),
  getUserSettingsPath: vi.fn(),
  getSessionTokenPath: vi.fn(),
  getNetworkInfoPath: vi.fn(),
} as unknown as Storage

const commands = {
  workspace: undefined,
  workspaceLogPath: undefined,
} as unknown as Commands

describe("Windows path escaping", () => {
  it("should properly escape Windows paths for SSH config", () => {
    const remote = new Remote(mockVscode, storage, commands, mockVscode.ExtensionMode.Production)

    // Test basic Windows path
    const path1 = "C:\\Users\\micha\\logs"
    expect(remote.escapeWindowsPath(path1)).toBe('"C:/Users/micha/logs"')

    // Test path with spaces
    const path2 = "C:\\Program Files\\My App\\logs"
    expect(remote.escapeWindowsPath(path2)).toBe('"C:/Program Files/My App/logs"')

    // Test path with special characters
    const path3 = "C:\\Users\\micha\\My Folder (v2)\\logs"
    expect(remote.escapeWindowsPath(path3)).toBe('"C:/Users/micha/My Folder (v2)/logs"')

    // Test path with quotes
    const path4 = 'C:\\Users\\micha\\"quoted"\\logs'
    expect(remote.escapeWindowsPath(path4)).toBe('"C:/Users/micha/\\"quoted\\"/logs"')
  })

  it("should use correct escape function based on platform", () => {
    const remote = new Remote(mockVscode, storage, commands, mockVscode.ExtensionMode.Production)

    // Mock platform
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', {
      value: 'win32'
    })

    // Test Windows path
    const path1 = "C:\\Users\\micha\\logs"
    expect(remote.escape(path1)).toBe('"C:/Users/micha/logs"')

    // Restore platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform
    })

    // Test Unix path
    const path2 = "/home/user/logs"
    expect(remote.escape(path2)).toBe('"/home/user/logs"')
  })
})