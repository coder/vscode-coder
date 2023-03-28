/* eslint-disable @typescript-eslint/ban-ts-comment */
import { it, afterEach, vi, expect } from "vitest"
import { SSHConfig } from "./sshConfig"

const sshFilePath = "~/.config/ssh"

const mockFileSystem = {
  readFile: vi.fn(),
  ensureDir: vi.fn(),
  writeFile: vi.fn(),
}

afterEach(() => {
  vi.clearAllMocks()
})

it("creates a new file and adds the config", async () => {
  mockFileSystem.readFile.mockRejectedValueOnce("No file found")

  const sshConfig = new SSHConfig(sshFilePath, mockFileSystem)
  await sshConfig.load()
  await sshConfig.update({
    Host: "coder-vscode--*",
    ProxyCommand: "some-command-here",
    ConnectTimeout: "0",
    StrictHostKeyChecking: "no",
    UserKnownHostsFile: "/dev/null",
    LogLevel: "ERROR",
  })

  const expectedOutput = `# --- START CODER VSCODE ---
Host coder-vscode--*
  ProxyCommand some-command-here
  ConnectTimeout 0
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
# --- END CODER VSCODE ---`

  expect(mockFileSystem.readFile).toBeCalledWith(sshFilePath, expect.anything())
  expect(mockFileSystem.writeFile).toBeCalledWith(sshFilePath, expectedOutput, expect.anything())
})

it("adds a new coder config in an existent SSH configuration", async () => {
  const existentSSHConfig = `Host coder.something
  HostName coder.something
  ConnectTimeout=0
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null
  LogLevel ERROR
  ProxyCommand command`
  mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig)

  const sshConfig = new SSHConfig(sshFilePath, mockFileSystem)
  await sshConfig.load()
  await sshConfig.update({
    Host: "coder-vscode--*",
    ProxyCommand: "some-command-here",
    ConnectTimeout: "0",
    StrictHostKeyChecking: "no",
    UserKnownHostsFile: "/dev/null",
    LogLevel: "ERROR",
  })

  const expectedOutput = `${existentSSHConfig}

# --- START CODER VSCODE ---
Host coder-vscode--*
  ProxyCommand some-command-here
  ConnectTimeout 0
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
# --- END CODER VSCODE ---`

  expect(mockFileSystem.writeFile).toBeCalledWith(sshFilePath, expectedOutput, {
    encoding: "utf-8",
    mode: 384,
  })
})

it("updates an existent coder config", async () => {
  const existentSSHConfig = `Host coder.something
  HostName coder.something
  ConnectTimeout=0
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null
  LogLevel ERROR
  ProxyCommand command

# --- START CODER VSCODE ---
Host coder-vscode--*
  ProxyCommand some-command-here
  ConnectTimeout 0
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
# --- END CODER VSCODE ---`
  mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig)

  const sshConfig = new SSHConfig(sshFilePath, mockFileSystem)
  await sshConfig.load()
  await sshConfig.update({
    Host: "coder--updated--vscode--*",
    ProxyCommand: "some-command-here",
    ConnectTimeout: "0",
    StrictHostKeyChecking: "no",
    UserKnownHostsFile: "/dev/null",
    LogLevel: "ERROR",
  })

  const expectedOutput = `Host coder.something
  HostName coder.something
  ConnectTimeout=0
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null
  LogLevel ERROR
  ProxyCommand command

# --- START CODER VSCODE ---
Host coder--updated--vscode--*
  ProxyCommand some-command-here
  ConnectTimeout 0
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
# --- END CODER VSCODE ---`

  expect(mockFileSystem.writeFile).toBeCalledWith(sshFilePath, expectedOutput, {
    encoding: "utf-8",
    mode: 384,
  })
})

it("removes old coder SSH config and adds the new one", async () => {
  const existentSSHConfig = `Host coder-vscode--*
  HostName coder.something
  ConnectTimeout=0
  StrictHostKeyChecking=no
  UserKnownHostsFile=/dev/null
  LogLevel ERROR
  ProxyCommand command`
  mockFileSystem.readFile.mockResolvedValueOnce(existentSSHConfig)

  const sshConfig = new SSHConfig(sshFilePath, mockFileSystem)
  await sshConfig.load()
  await sshConfig.update({
    Host: "coder-vscode--*",
    ProxyCommand: "some-command-here",
    ConnectTimeout: "0",
    StrictHostKeyChecking: "no",
    UserKnownHostsFile: "/dev/null",
    LogLevel: "ERROR",
  })

  const expectedOutput = `# --- START CODER VSCODE ---
Host coder-vscode--*
  ProxyCommand some-command-here
  ConnectTimeout 0
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
# --- END CODER VSCODE ---`

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
    {
      Host: "coder-vscode--*",
      ProxyCommand: "some-command-here",
      ConnectTimeout: "0",
      StrictHostKeyChecking: "no",
      UserKnownHostsFile: "/dev/null",
      LogLevel: "ERROR",
    },
    {
      ssh_config_options: {
        loglevel: "DEBUG", // This tests case insensitive
        ConnectTimeout: "500",
        ExtraKey: "ExtraValue",
        Foo: "bar",
        Buzz: "baz",
        // Remove this key
        StrictHostKeyChecking: "",
        ExtraRemove: "",
      },
      hostname_prefix: "",
    },
  )

  const expectedOutput = `# --- START CODER VSCODE ---
Host coder-vscode--*
  ProxyCommand some-command-here
  ConnectTimeout 500
  UserKnownHostsFile /dev/null
  LogLevel DEBUG
  Buzz baz
  ExtraKey ExtraValue
  Foo bar
# --- END CODER VSCODE ---`

  expect(mockFileSystem.readFile).toBeCalledWith(sshFilePath, expect.anything())
  expect(mockFileSystem.writeFile).toBeCalledWith(sshFilePath, expectedOutput, expect.anything())
})
