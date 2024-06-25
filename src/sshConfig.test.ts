/* eslint-disable @typescript-eslint/ban-ts-comment */
import { it, afterEach, vi, expect } from "vitest"
import { SSHConfig } from "./sshConfig"

const sshFilePath = "~/.config/ssh"

const mockFileSystem = {
  readFile: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}

afterEach(() => {
  vi.clearAllMocks()
})

it("creates a new file and adds config with empty label", async () => {
  mockFileSystem.readFile.mockRejectedValueOnce("No file found")

  const sshConfig = new SSHConfig(sshFilePath, mockFileSystem)
  await sshConfig.load()
  await sshConfig.update("", {
    Host: "coder-vscode--*",
    ProxyCommand: "some-command-here",
    ConnectTimeout: "0",
    StrictHostKeyChecking: "no",
    UserKnownHostsFile: "/dev/null",
    LogLevel: "ERROR",
  })

  const expectedOutput = `# --- START CODER VSCODE ---
Host coder-vscode--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE ---`

  expect(mockFileSystem.readFile).toBeCalledWith(sshFilePath, expect.anything())
  expect(mockFileSystem.writeFile).toBeCalledWith(sshFilePath, expectedOutput, expect.anything())
})

it("creates a new file and adds the config", async () => {
  mockFileSystem.readFile.mockRejectedValueOnce("No file found")

  const sshConfig = new SSHConfig(sshFilePath, mockFileSystem)
  await sshConfig.load()
  await sshConfig.update("dev.coder.com", {
    Host: "coder-vscode.dev.coder.com--*",
    ProxyCommand: "some-command-here",
    ConnectTimeout: "0",
    StrictHostKeyChecking: "no",
    UserKnownHostsFile: "/dev/null",
    LogLevel: "ERROR",
  })

  const expectedOutput = `# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---`

  expect(mockFileSystem.readFile).toBeCalledWith(sshFilePath, expect.anything())
  expect(mockFileSystem.writeFile).toBeCalledWith(sshFilePath, expectedOutput, expect.anything())
})

it("adds a new coder config in an existent SSH configuration", async () => {
  const existentSSHConfig = `Host coder.something
  ConnectTimeout=0
  LogLevel ERROR
  HostName coder.something
  ProxyCommand command
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null`
  mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig)

  const sshConfig = new SSHConfig(sshFilePath, mockFileSystem)
  await sshConfig.load()
  await sshConfig.update("dev.coder.com", {
    Host: "coder-vscode.dev.coder.com--*",
    ProxyCommand: "some-command-here",
    ConnectTimeout: "0",
    StrictHostKeyChecking: "no",
    UserKnownHostsFile: "/dev/null",
    LogLevel: "ERROR",
  })

  const expectedOutput = `${existentSSHConfig}

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---`

  expect(mockFileSystem.writeFile).toBeCalledWith(sshFilePath, expectedOutput, {
    encoding: "utf-8",
    mode: 384,
  })
})

it("updates an existent coder config", async () => {
  const keepSSHConfig = `Host coder.something
  HostName coder.something
  ConnectTimeout=0
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null
  LogLevel ERROR
  ProxyCommand command

# --- START CODER VSCODE dev2.coder.com ---
Host coder-vscode.dev2.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev2.coder.com ---`

  const existentSSHConfig = `${keepSSHConfig}

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---

Host *
  SetEnv TEST=1`
  mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig)

  const sshConfig = new SSHConfig(sshFilePath, mockFileSystem)
  await sshConfig.load()
  await sshConfig.update("dev.coder.com", {
    Host: "coder-vscode.dev-updated.coder.com--*",
    ProxyCommand: "some-updated-command-here",
    ConnectTimeout: "1",
    StrictHostKeyChecking: "yes",
    UserKnownHostsFile: "/dev/null",
    LogLevel: "ERROR",
  })

  const expectedOutput = `${keepSSHConfig}

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev-updated.coder.com--*
  ConnectTimeout 1
  LogLevel ERROR
  ProxyCommand some-updated-command-here
  StrictHostKeyChecking yes
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---

Host *
  SetEnv TEST=1`

  expect(mockFileSystem.writeFile).toBeCalledWith(sshFilePath, expectedOutput, {
    encoding: "utf-8",
    mode: 384,
  })
})

it("does not remove deployment-unaware SSH config and adds the new one", async () => {
  // Before the plugin supported multiple deployments, it would only write and
  // overwrite this one block.  We need to leave it alone so existing
  // connections keep working.  Only replace blocks specific to the deployment
  // that we are targeting.  Going forward, all new connections will use the new
  // deployment-specific block.
  const existentSSHConfig = `# --- START CODER VSCODE ---
Host coder-vscode--*
  ConnectTimeout=0
  HostName coder.something
  LogLevel ERROR
  ProxyCommand command
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null
# --- END CODER VSCODE ---`
  mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig)

  const sshConfig = new SSHConfig(sshFilePath, mockFileSystem)
  await sshConfig.load()
  await sshConfig.update("dev.coder.com", {
    Host: "coder-vscode.dev.coder.com--*",
    ProxyCommand: "some-command-here",
    ConnectTimeout: "0",
    StrictHostKeyChecking: "no",
    UserKnownHostsFile: "/dev/null",
    LogLevel: "ERROR",
  })

  const expectedOutput = `${existentSSHConfig}

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---`

  expect(mockFileSystem.writeFile).toBeCalledWith(sshFilePath, expectedOutput, {
    encoding: "utf-8",
    mode: 384,
  })
})

it("it does not remove a user-added block that only matches the host of an old coder SSH config", async () => {
  const existentSSHConfig = `Host coder-vscode--*
  ForwardAgent=yes`
  mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig)

  const sshConfig = new SSHConfig(sshFilePath, mockFileSystem)
  await sshConfig.load()
  await sshConfig.update("dev.coder.com", {
    Host: "coder-vscode.dev.coder.com--*",
    ProxyCommand: "some-command-here",
    ConnectTimeout: "0",
    StrictHostKeyChecking: "no",
    UserKnownHostsFile: "/dev/null",
    LogLevel: "ERROR",
  })

  const expectedOutput = `Host coder-vscode--*
  ForwardAgent=yes

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand some-command-here
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# --- END CODER VSCODE dev.coder.com ---`

  expect(mockFileSystem.writeFile).toBeCalledWith(sshFilePath, expectedOutput, {
    encoding: "utf-8",
    mode: 384,
  })
})

it("override values", async () => {
  mockFileSystem.readFile.mockRejectedValueOnce("No file found")
  const sshConfig = new SSHConfig(sshFilePath, mockFileSystem)
  await sshConfig.load()
  await sshConfig.update(
    "dev.coder.com",
    {
      Host: "coder-vscode.dev.coder.com--*",
      ProxyCommand: "some-command-here",
      ConnectTimeout: "0",
      StrictHostKeyChecking: "no",
      UserKnownHostsFile: "/dev/null",
      LogLevel: "ERROR",
    },
    {
      loglevel: "DEBUG", // This tests case insensitive
      ConnectTimeout: "500",
      ExtraKey: "ExtraValue",
      Foo: "bar",
      Buzz: "baz",
      // Remove this key
      StrictHostKeyChecking: "",
      ExtraRemove: "",
    },
  )

  const expectedOutput = `# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  Buzz baz
  ConnectTimeout 500
  ExtraKey ExtraValue
  Foo bar
  ProxyCommand some-command-here
  UserKnownHostsFile /dev/null
  loglevel DEBUG
# --- END CODER VSCODE dev.coder.com ---`

  expect(mockFileSystem.readFile).toBeCalledWith(sshFilePath, expect.anything())
  expect(mockFileSystem.writeFile).toBeCalledWith(sshFilePath, expectedOutput, expect.anything())
})
