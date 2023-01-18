import axios from "axios"
import {
  getBuildInfo,
  getWorkspace,
  getWorkspaceBuildLogs,
  getWorkspaceByOwnerAndName,
  startWorkspace,
} from "coder/site/src/api/api"
import { ProvisionerJobLog, Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated"
import EventSource from "eventsource"
import find from "find-process"
import { ensureDir } from "fs-extra"
import * as fs from "fs/promises"
import * as jsonc from "jsonc-parser"
import * as os from "os"
import * as path from "path"
import prettyBytes from "pretty-bytes"
import * as semver from "semver"
import SSHConfig from "ssh-config"
import * as vscode from "vscode"
import * as ws from "ws"
import { Storage } from "./storage"

export class Remote {
  // Prefix is a magic string that is prepended to SSH
  // hosts to indicate that they should be handled by
  // this extension.
  public static readonly Prefix = "coder-vscode--"

  public constructor(
    private readonly vscodeProposed: typeof vscode,
    private readonly storage: Storage,
    private readonly mode: vscode.ExtensionMode,
  ) {}

  public async setup(remoteAuthority: string): Promise<vscode.Disposable | undefined> {
    const authorityParts = remoteAuthority.split("+")
    // If the URI passed doesn't have the proper prefix
    // ignore it. We don't need to do anything special,
    // because this isn't trying to open a Coder workspace.
    if (!authorityParts[1].startsWith(Remote.Prefix)) {
      return
    }
    const sshAuthority = authorityParts[1].substring(Remote.Prefix.length)

    // Authorities are in the format: coder-vscode--<username>--<workspace>--<agent>
    // Agent can be omitted then will be prompted for instead.
    const parts = sshAuthority.split("--")
    if (parts.length < 2 || parts.length > 3) {
      throw new Error(`Invalid Coder SSH authority. Must be: <username>--<workspace>--<agent?>`)
    }

    const buildInfo = await getBuildInfo()
    const parsedVersion = semver.parse(buildInfo.version)
    // Server versions before v0.14.1 don't support the vscodessh command!
    if (
      parsedVersion?.major === 0 &&
      parsedVersion?.minor <= 14 &&
      parsedVersion?.patch < 1 &&
      parsedVersion?.prerelease.length === 0
    ) {
      await this.vscodeProposed.window.showErrorMessage(
        "Incompatible Server",
        {
          detail: "Your Coder server is too old to support the Coder extension! Please upgrade to v0.14.1 or newer.",
          modal: true,
          useCustom: true,
        },
        "Close Remote",
      )
      await this.closeRemote()
      return
    }

    // Find the workspace from the URI scheme provided!
    let workspace: Workspace
    try {
      workspace = await getWorkspaceByOwnerAndName(parts[0], parts[1])
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        throw error
      }
      switch (error.response?.status) {
        case 404: {
          const result = await this.vscodeProposed.window.showInformationMessage(
            `That workspace doesn't exist!`,
            {
              modal: true,
              detail: `${parts[0]}/${parts[1]} cannot be found. Maybe it was deleted...`,
              useCustom: true,
            },
            "Open Workspace",
          )
          if (!result) {
            await this.closeRemote()
          }
          await vscode.commands.executeCommand("coder.open")
          return
        }
        case 401: {
          const result = await this.vscodeProposed.window.showInformationMessage(
            "Your session expired...",
            {
              useCustom: true,
              modal: true,
              detail: "You must login again to access your workspace.",
            },
            "Login",
          )
          if (!result) {
            await this.closeRemote()
          }
          await vscode.commands.executeCommand("coder.login", this.storage.getURL())
          await this.setup(remoteAuthority)
          return
        }
        default:
          throw error
      }
    }

    const disposables: vscode.Disposable[] = []
    // Register before connection so the label still displays!
    disposables.push(this.registerLabelFormatter(`${workspace.owner_name}/${workspace.name}`))

    let buildComplete: undefined | (() => void)
    if (workspace.latest_build.status === "stopped") {
      this.vscodeProposed.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: false,
          title: "Starting workspace...",
        },
        () =>
          new Promise<void>((r) => {
            buildComplete = r
          }),
      )
      workspace = {
        ...workspace,
        latest_build: await startWorkspace(workspace.id),
      }
    }

    // If a build is running we should stream the logs to the user so
    // they can watch what's going on!
    if (workspace.latest_build.status === "pending" || workspace.latest_build.status === "starting") {
      const writeEmitter = new vscode.EventEmitter<string>()
      // We use a terminal instead of an output channel because it feels
      // more familiar to a user!
      const terminal = vscode.window.createTerminal({
        name: "Build Log",
        location: vscode.TerminalLocation.Panel,
        // Spin makes this gear icon spin!
        iconPath: new vscode.ThemeIcon("gear~spin"),
        pty: {
          onDidWrite: writeEmitter.event,
          close: () => undefined,
          open: () => undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as Partial<vscode.Pseudoterminal> as any,
      })
      // This fetches the initial bunch of logs.
      const logs = await getWorkspaceBuildLogs(workspace.latest_build.id, new Date())
      logs.forEach((log) => writeEmitter.fire(log.output + "\r\n"))
      terminal.show(true)
      // This follows the logs for new activity!
      let path = `/api/v2/workspacebuilds/${workspace.latest_build.id}/logs?follow=true`
      if (logs.length) {
        path += `&after=${logs[logs.length - 1].id}`
      }
      const rawURL = this.storage.getURL()
      if (!rawURL) {
        throw new Error("You aren't logged in!")
      }
      const url = new URL(rawURL)
      const sessionToken = await this.storage.getSessionToken()
      await new Promise<void>((resolve, reject) => {
        let scheme = "wss:"
        if (url.protocol === "http:") {
          scheme = "ws:"
        }
        const socket = new ws.WebSocket(new URL(`${scheme}//${url.host}${path}`), {
          headers: {
            "Coder-Session-Token": sessionToken,
          },
        })
        socket.binaryType = "nodebuffer"
        socket.on("message", (data) => {
          const buf = data as Buffer
          const log = JSON.parse(buf.toString()) as ProvisionerJobLog
          writeEmitter.fire(log.output + "\r\n")
        })
        socket.on("error", (err) => {
          reject(err)
        })
        socket.on("close", () => {
          resolve()
        })
      })
      writeEmitter.fire("Build complete")
      workspace = await getWorkspace(workspace.id)
      terminal.hide()

      if (buildComplete) {
        buildComplete()
      }
    }

    const agents = workspace.latest_build.resources.reduce((acc, resource) => {
      return acc.concat(resource.agents || [])
    }, [] as WorkspaceAgent[])

    let agent: WorkspaceAgent | undefined

    if (parts.length === 2) {
      if (agents.length === 1) {
        agent = agents[0]
      }

      // If there are multiple agents, we should select one here!
      // TODO: Support multiple agents!
    }

    if (!agent) {
      const matchingAgents = agents.filter((agent) => agent.name === parts[2])
      if (matchingAgents.length !== 1) {
        // TODO: Show the agent selector here instead!
        throw new Error(`Invalid Coder SSH authority. Agent not found!`)
      }
      agent = matchingAgents[0]
    }

    let remotePlatforms = this.vscodeProposed.workspace
      .getConfiguration()
      .get<Record<string, string>>("remote.SSH.remotePlatform")
    remotePlatforms = {
      ...remotePlatforms,
      [`${authorityParts[1]}`]: agent.operating_system,
    }

    let settingsContent = "{}"
    try {
      settingsContent = await fs.readFile(this.storage.getUserSettingsPath(), "utf8")
    } catch (ex) {
      // Ignore! It's probably because the file doesn't exist.
    }
    const parsed = jsonc.parse(settingsContent)
    parsed["remote.SSH.remotePlatform"] = remotePlatforms
    const edits = jsonc.modify(settingsContent, ["remote.SSH.remotePlatform"], remotePlatforms, {})
    await fs.writeFile(this.storage.getUserSettingsPath(), jsonc.applyEdits(settingsContent, edits))

    const workspaceUpdate = new vscode.EventEmitter<Workspace>()
    const watchURL = new URL(`${this.storage.getURL()}/api/v2/workspaces/${workspace.id}/watch`)
    const eventSource = new EventSource(watchURL.toString(), {
      headers: {
        "Coder-Session-Token": await this.storage.getSessionToken(),
      },
    })
    eventSource.addEventListener("open", () => {
      // TODO: Add debug output that we began watching here!
    })
    eventSource.addEventListener("error", () => {
      // TODO: Add debug output that we got an error here!
    })
    eventSource.addEventListener("data", (event: MessageEvent<string>) => {
      const workspace = JSON.parse(event.data) as Workspace
      if (!workspace) {
        return
      }
      workspaceUpdate.fire(workspace)
      if (workspace.latest_build.status === "stopping" || workspace.latest_build.status === "stopped") {
        const action = this.vscodeProposed.window.showInformationMessage(
          "Your workspace stopped!",
          {
            useCustom: true,
            modal: true,
            detail: "Reloading the window will start it again.",
          },
          "Reload Window",
        )
        if (!action) {
          return
        }
        this.reloadWindow()
      }
    })

    if (agent.status === "connecting") {
      await vscode.window.withProgress(
        {
          title: "Waiting for the agent to connect...",
          location: vscode.ProgressLocation.Notification,
        },
        async () => {
          await new Promise<void>((resolve) => {
            const updateEvent = workspaceUpdate.event((workspace) => {
              const agents = workspace.latest_build.resources.reduce((acc, resource) => {
                return acc.concat(resource.agents || [])
              }, [] as WorkspaceAgent[])
              if (!agent) {
                return
              }
              const found = agents.find((newAgent) => {
                if (!agent) {
                  // This shouldn't be possible... just makes the types happy!
                  return false
                }
                return newAgent.id === agent.id
              })
              if (!found) {
                return
              }
              agent = found
              if (agent.status === "connecting") {
                return
              }
              updateEvent.dispose()
              resolve()
            })
          })
        },
      )
    }

    if (agent.status === "timeout") {
      const result = await this.vscodeProposed.window.showErrorMessage("Connection timed out...", {
        useCustom: true,
        modal: true,
        detail: `The ${agent.name} agent didn't connect in time. Try restarting your workspace.`,
      })
      if (!result) {
        await this.closeRemote()
        return
      }
      await this.reloadWindow()
      return
    }

    // This ensures the Remote SSH extension resolves
    // the host to execute the Coder binary properly.
    //
    // If we didn't write to the SSH config file,
    // connecting would fail with "Host not found".
    await this.updateSSHConfig(authorityParts[1])

    this.findSSHProcessID().then((pid) => {
      if (!pid) {
        // TODO: Show an error here!
        return
      }
      disposables.push(this.showNetworkUpdates(pid))
    })

    // Register the label formatter again because SSH overrides it!
    let label = `${workspace.owner_name}/${workspace.name}`
    if (agents.length > 1) {
      label += `/${agent.name}`
    }

    disposables.push(
      vscode.extensions.onDidChange(() => {
        disposables.push(this.registerLabelFormatter(label))
      }),
    )

    return {
      dispose: () => {
        eventSource.close()
        disposables.forEach((d) => d.dispose())
      },
    }
  }

  // updateSSHConfig updates the SSH configuration with a wildcard
  // that handles all Coder entries.
  private async updateSSHConfig(sshHost: string) {
    let sshConfigFile = vscode.workspace.getConfiguration().get<string>("remote.SSH.configFile")
    if (!sshConfigFile) {
      sshConfigFile = path.join(os.homedir(), ".ssh", "config")
    }
    let sshConfigRaw: string
    try {
      sshConfigRaw = await fs.readFile(sshConfigFile, "utf8")
    } catch (ex) {
      // Probably just doesn't exist!
      sshConfigRaw = ""
    }
    const parsedConfig = SSHConfig.parse(sshConfigRaw)
    const computedHost = parsedConfig.compute(sshHost)

    let binaryPath: string | undefined
    if (this.mode === vscode.ExtensionMode.Production) {
      binaryPath = await this.storage.fetchBinary()
    } else {
      binaryPath = path.join(os.tmpdir(), "coder")
    }
    if (!binaryPath) {
      throw new Error("Failed to fetch the Coder binary!")
    }

    parsedConfig.remove({ Host: computedHost.Host })
    const escape = (str: string): string => `"${str.replace(/"/g, '\\"')}"`
    parsedConfig.append({
      Host: `${Remote.Prefix}*`,
      ProxyCommand: `${escape(binaryPath)} vscodessh --network-info-dir ${escape(
        this.storage.getNetworkInfoPath(),
      )} --session-token-file ${escape(this.storage.getSessionTokenPath())} --url-file ${escape(
        this.storage.getURLPath(),
      )} %h`,
      ConnectTimeout: "0",
      StrictHostKeyChecking: "no",
      UserKnownHostsFile: "/dev/null",
      LogLevel: "ERROR",
    })

    await ensureDir(path.dirname(sshConfigFile))
    await fs.writeFile(sshConfigFile, parsedConfig.toString())
  }

  // showNetworkUpdates finds the SSH process ID that is being used by
  // this workspace and reads the file being created by the Coder CLI.
  private showNetworkUpdates(sshPid: number): vscode.Disposable {
    const networkStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000)
    const networkInfoFile = path.join(this.storage.getNetworkInfoPath(), `${sshPid}.json`)

    const updateStatus = (network: {
      p2p: boolean
      latency: number
      preferred_derp: string
      derp_latency: { [key: string]: number }
      upload_bytes_sec: number
      download_bytes_sec: number
    }) => {
      let statusText = "$(globe) "
      if (network.p2p) {
        statusText += "Direct "
        networkStatus.tooltip = "You're connected peer-to-peer ✨."
      } else {
        statusText += network.preferred_derp + " "
        networkStatus.tooltip =
          "You're connected through a relay 🕵️.\nWe'll switch over to peer-to-peer when available."
      }
      networkStatus.tooltip +=
        "\n\nDownload ↓ " +
        prettyBytes(network.download_bytes_sec, {
          bits: true,
        }) +
        "/s • Upload ↑ " +
        prettyBytes(network.upload_bytes_sec, {
          bits: true,
        }) +
        "/s\n"

      if (!network.p2p) {
        const derpLatency = network.derp_latency[network.preferred_derp]

        networkStatus.tooltip += `You ↔ ${derpLatency.toFixed(2)}ms ↔ ${network.preferred_derp} ↔ ${(
          network.latency - derpLatency
        ).toFixed(2)}ms ↔ Workspace`

        let first = true
        Object.keys(network.derp_latency).forEach((region) => {
          if (region === network.preferred_derp) {
            return
          }
          if (first) {
            networkStatus.tooltip += `\n\nOther regions:`
            first = false
          }
          networkStatus.tooltip += `\n${region}: ${Math.round(network.derp_latency[region] * 100) / 100}ms`
        })
      }

      statusText += "(" + network.latency.toFixed(2) + "ms)"
      networkStatus.text = statusText
      networkStatus.show()
    }
    let disposed = false
    const periodicRefresh = () => {
      if (disposed) {
        return
      }
      fs.readFile(networkInfoFile, "utf8")
        .then((content) => {
          return JSON.parse(content)
        })
        .then((parsed) => {
          try {
            updateStatus(parsed)
          } catch (ex) {
            // Ignore
          }
        })
        .catch(() => {
          // TODO: Log a failure here!
        })
        .finally(() => {
          // This matches the write interval of `coder vscodessh`.
          setTimeout(periodicRefresh, 3000)
        })
    }
    periodicRefresh()

    return {
      dispose: () => {
        disposed = true
        networkStatus.dispose()
      },
    }
  }

  // findSSHProcessID returns the currently active SSH process ID
  // that is powering the remote SSH connection.
  private async findSSHProcessID(timeout = 15000): Promise<number | undefined> {
    const search = async (logPath: string): Promise<number | undefined> => {
      // This searches for the socksPort that Remote SSH is connecting to.
      // We do this to find the SSH process that is powering this connection.
      // That SSH process will be logging network information periodically to
      // a file.
      const text = await fs.readFile(logPath, "utf8")
      const matches = text.match(/-> socksPort (\d+) ->/)
      if (!matches) {
        return
      }
      if (matches.length < 2) {
        return
      }
      const port = Number.parseInt(matches[1])
      if (!port) {
        return
      }
      const processes = await find("port", port)
      if (processes.length < 1) {
        return
      }
      const process = processes[0]
      return process.pid
    }
    const start = Date.now()
    const loop = async (): Promise<number | undefined> => {
      if (Date.now() - start > timeout) {
        return undefined
      }
      // Loop until we find the remote SSH log for this window.
      const filePath = await this.storage.getRemoteSSHLogPath()
      if (!filePath) {
        return new Promise((resolve) => setTimeout(() => resolve(loop()), 500))
      }
      // Then we search the remote SSH log until we find the port.
      const result = await search(filePath)
      if (!result) {
        return new Promise((resolve) => setTimeout(() => resolve(loop()), 500))
      }
      return result
    }
    return loop()
  }

  // closeRemote ends the current remote session.
  private async closeRemote() {
    await vscode.commands.executeCommand("workbench.action.remote.close")
  }

  // reloadWindow reloads the current window.
  private async reloadWindow() {
    await vscode.commands.executeCommand("workbench.action.reloadWindow")
  }

  private registerLabelFormatter(suffix: string): vscode.Disposable {
    return this.vscodeProposed.workspace.registerResourceLabelFormatter({
      scheme: "vscode-remote",
      formatting: {
        authorityPrefix: "ssh-remote",
        label: "${path}",
        separator: "/",
        tildify: true,
        workspaceSuffix: `Coder: ${suffix}`,
      },
    })
  }
}
