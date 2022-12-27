import { getWorkspace, getWorkspaceBuildLogs, getWorkspaceByOwnerAndName, startWorkspace } from "coder/site/src/api/api"
import { ProvisionerJobLog, Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated"
import EventSource from "eventsource"
import prettyBytes from "pretty-bytes"
import * as vscode from "vscode"
import * as ws from "ws"
import windowsInstallScript from "./install.ps1"
import installScript from "./install.sh"
import { IPC } from "./ipc"
import { Storage } from "./storage"

// Remote is the remote authority provider for the "coder" URI scheme.
// This creates an IPC connection to `coder vscodeipc` and communicates
// with it to start a remote extension host.
export class Remote {
  private ipc?: IPC
  private readonly networkStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0)

  public constructor(
    private readonly output: vscode.OutputChannel,
    private readonly vscodeProposed: typeof vscode,
    private readonly storage: Storage,
    private readonly vscodeCommit: string,
  ) {}

  public dispose(): void {
    this.ipc?.kill()
    this.networkStatus.dispose()
    this.output.dispose()
  }

  public async resolve(authority: string, ctx: vscode.RemoteAuthorityResolverContext): Promise<vscode.ResolverResult> {
    if (!authority.startsWith("coder+")) {
      throw new Error("invalid authority: " + authority)
    }
    const parts = authority.split("coder+")[1].split(".")
    if (parts.length < 2) {
      throw new Error("invalid workspace syntax (must be owner.name or owner.name.agent): " + parts.join(", "))
    }
    const owner = parts[0]
    const name = parts[1]

    const sessionInvalid = () => {
      vscode.window.showErrorMessage("Your session expired. Sign into Coder again!", "Login").then((action) => {
        if (!action) {
          return
        }
        vscode.commands.executeCommand("coder.login").then(() => {
          vscode.commands.executeCommand("workbench.action.reloadWindow")
        })
      })
    }
    if (!this.storage.getURL()) {
      sessionInvalid()
      throw vscode.RemoteAuthorityResolverError.NotAvailable("You must login", true)
    }

    let workspace: Workspace
    try {
      workspace = await getWorkspaceByOwnerAndName(owner, name)
    } catch (ex) {
      sessionInvalid()
      throw vscode.RemoteAuthorityResolverError.NotAvailable("You must login", true)
    }

    this.vscodeProposed.workspace.registerResourceLabelFormatter({
      scheme: "vscode-remote",
      formatting: {
        authorityPrefix: authority,
        label: "${path}",
        separator: "/",
        tildify: true,
        workspaceSuffix: `Coder: ${owner}/${name}`,
      },
    })

    let latestBuild = workspace.latest_build
    if (latestBuild.status === "stopping" || latestBuild.status === "starting") {
      const output = vscode.window.createOutputChannel(`@${owner}/${name} Build Log`)
      const logs = await getWorkspaceBuildLogs(latestBuild.id, new Date())
      logs.forEach((log) => output.appendLine(log.output))
      output.show()
      let path = `/api/v2/workspacebuilds/${latestBuild.id}/logs?follow=true`
      if (logs.length) {
        path += `&after=${logs[logs.length - 1].id}`
      }
      const rawURL = this.storage.getURL()
      if (!rawURL) {
        throw new Error("You aren't logged in!")
      }
      const url = new URL(rawURL)
      await new Promise<void>((resolve, reject) => {
        let scheme = "wss:"
        if (url.protocol === "http:") {
          scheme = "ws:"
        }
        const socket = new ws.WebSocket(new URL(`${scheme}//${url.host}${path}`), {
          headers: {
            "Coder-Session-Token": this.storage.getSessionToken(),
          },
        })
        socket.binaryType = "nodebuffer"
        socket.on("message", (data) => {
          const buf = data as Buffer
          const log = JSON.parse(buf.toString()) as ProvisionerJobLog
          output.appendLine(log.output)
        })
        socket.on("error", (err) => {
          reject(err)
        })
        socket.on("close", () => {
          resolve()
        })
      })
      output.appendLine("Build complete")

      workspace = await getWorkspace(workspace.id)
      latestBuild = workspace.latest_build
    }
    // Only prompt to start on the first resolve attempt!
    if (workspace.latest_build.status === "stopped") {
      if (ctx.resolveAttempt !== 1) {
        throw new Error(`${owner}/${name} is stopped`)
      }
      const result = await this.vscodeProposed.window.showInformationMessage(
        `Do you want to start @${owner}/${name}?`,
        {
          modal: true,
          detail:
            "The build log will appear so you can watch it's progress! We'll automatically connect you when it's done.",
          useCustom: true,
        },
        "Start Workspace",
      )
      if (result !== "Start Workspace") {
        throw vscode.RemoteAuthorityResolverError.NotAvailable("The workspace isn't started!")
      }
      latestBuild = await startWorkspace(workspace.id)
    }

    const agents: WorkspaceAgent[] = []
    workspace.latest_build.resources.forEach((resource) => {
      resource.agents?.forEach((agent) => {
        agents.push(agent)
      })
    })
    if (agents.length === 0) {
      throw new Error("This workspace has no agents!")
    }

    const agent = agents[0]
    if (agents.length > 1) {
      // TODO: Show a picker!
    }

    if (this.ipc) {
      this.ipc.kill()
    }

    const watchURL = new URL(`${this.storage.getURL()}/api/v2/workspaces/${workspace.id}/watch`)
    const eventSource = new EventSource(watchURL.toString(), {
      headers: {
        "Coder-Session-Token": this.storage.getSessionToken(),
      },
    })
    eventSource.addEventListener("open", () => {
      this.output.appendLine("Started watching workspace")
    })
    eventSource.addEventListener("data", (event: MessageEvent<string>) => {
      const workspace = JSON.parse(event.data) as Workspace
      if (!workspace) {
        return
      }
      if (workspace.latest_build.status === "stopping" || workspace.latest_build.status === "stopped") {
        // this.vscodeProposed.window.showInformationMessage("Something", {
        //   useCustom: true,
        //   modal: true,
        //   detail: "The workspace stopped!",
        // })
        this.ipc?.kill()
      }
    })
    eventSource.addEventListener("error", (event) => {
      this.output.appendLine("Received error watching workspace: " + event.data)
    })

    const binaryPath = await this.storage.fetchBinary()
    if (!binaryPath) {
      throw new Error("Failed to download binary!")
    }
    this.ipc = await IPC.start(binaryPath, this.storage, agent.id)
    const updateNetworkStatus = () => {
      if (!this.ipc) {
        return
      }
      this.ipc
        .network()
        .then((network) => {
          let statusText = "$(globe) "
          if (network.p2p) {
            statusText += "Direct "
            this.networkStatus.tooltip = "You're connected peer-to-peer ✨."
          } else {
            statusText += network.preferred_derp + " "
            this.networkStatus.tooltip =
              "You're connected through a relay 🕵️.\nWe'll switch over to peer-to-peer when available."
          }
          this.networkStatus.tooltip +=
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

            this.networkStatus.tooltip += `You ↔ ${derpLatency.toFixed(2)}ms ↔ ${network.preferred_derp} ↔ ${(
              network.latency - derpLatency
            ).toFixed(2)}ms ↔ Workspace`

            let first = true
            Object.keys(network.derp_latency).forEach((region) => {
              if (region === network.preferred_derp) {
                return
              }
              if (first) {
                this.networkStatus.tooltip += `\n\nOther regions:`
                first = false
              }
              this.networkStatus.tooltip += `\n${region}: ${Math.round(network.derp_latency[region] * 100) / 100}ms`
            })
          }

          statusText += "(" + network.latency.toFixed(2) + "ms)"
          this.networkStatus.text = statusText
          this.networkStatus.show()
          setTimeout(updateNetworkStatus, 2500)
        })
        .catch((ex) => {
          if (this.ipc?.killed) {
            return
          }
          this.output.appendLine("Failed to get network status: " + ex)
          setTimeout(updateNetworkStatus, 2500)
        })
    }
    updateNetworkStatus()

    const shell = agent.operating_system === "windows" ? "powershell -noprofile -noninteractive -" : "sh"
    const installCodeServer = agent.operating_system === "windows" ? windowsInstallScript : installScript
    const exitCode = await this.ipc.execute(shell, installCodeServer, (data) => {
      this.output.appendLine(data.toString())
    })

    if (exitCode !== 0) {
      this.output.show()
      throw new Error("Failed to run the startup script. Check the output log for details!")
    }
    const binPath = agent.operating_system === "windows" ? "code-server" : "$HOME/.vscode-remote/bin/code-server"

    const remotePort = await new Promise<number>((resolve, reject) => {
      const script =
        binPath +
        " serve-local --start-server --port 0 --without-connection-token --commit-id " +
        this.vscodeCommit +
        " --accept-server-license-terms"
      this.ipc
        ?.execute(shell, script, (data) => {
          const lines = data.split("\n")
          lines.forEach((line) => {
            this.output.appendLine(line)

            if (!line.startsWith("Server bound to")) {
              return
            }
            const parts = line.split(" ").filter((part) => part.startsWith("127.0.0.1:"))
            if (parts.length === 0) {
              return reject("No port found in output: " + line)
            }
            const port = parts[0].split(":").pop()
            if (!port) {
              return reject("No port found in parts: " + parts.join(","))
            }
            resolve(Number.parseInt(port))
          })
        })
        .then((exitCode) => {
          reject("Exited with: " + exitCode)
        })
    })

    const forwarded = await this.ipc.portForward(remotePort)
    vscode.commands.executeCommand("setContext", "forwardedPortsViewEnabled", true)

    return {
      connectionToken: "",
      host: "127.0.0.1",
      port: forwarded.localPort,
      isTrusted: true,
    }
  }
}
