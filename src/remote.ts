import { isAxiosError } from "axios"
import { Api } from "coder/site/src/api/api"
import { ProvisionerJobLog, Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated"
import EventSource from "eventsource"
import find from "find-process"
import * as fs from "fs/promises"
import * as jsonc from "jsonc-parser"
import * as os from "os"
import * as path from "path"
import prettyBytes from "pretty-bytes"
import * as semver from "semver"
import * as vscode from "vscode"
import * as ws from "ws"
import { makeCoderSdk } from "./api"
import { Commands } from "./commands"
import { getHeaderCommand } from "./headers"
import { SSHConfig, SSHValues, defaultSSHConfigResponse, mergeSSHConfigValues } from "./sshConfig"
import { computeSSHProperties, sshSupportsSetEnv } from "./sshSupport"
import { Storage } from "./storage"
import { supportsCoderAgentLogDirFlag } from "./version"
import { WorkspaceAction } from "./workspaceAction"

export class Remote {
  // Prefix is a magic string that is prepended to SSH hosts to indicate that
  // they should be handled by this extension.
  public static readonly Prefix = "coder-vscode--"

  public constructor(
    private readonly vscodeProposed: typeof vscode,
    private readonly storage: Storage,
    private readonly commands: Commands,
    private readonly mode: vscode.ExtensionMode,
  ) {}

  public async setup(remoteAuthority: string): Promise<vscode.Disposable | undefined> {
    const authorityParts = remoteAuthority.split("+")
    // If the URI passed doesn't have the proper prefix ignore it. We don't need
    // to do anything special, because this isn't trying to open a Coder
    // workspace.
    if (!authorityParts[1].startsWith(Remote.Prefix)) {
      return
    }
    const sshAuthority = authorityParts[1].substring(Remote.Prefix.length)

    // Authorities are in the format:
    // coder-vscode--<username>--<workspace>--<agent> Agent can be omitted then
    // will be prompted for instead.
    const parts = sshAuthority.split("--")
    if (parts.length < 2 || parts.length > 3) {
      throw new Error(`Invalid Coder SSH authority. Must be: <username>--<workspace>--<agent?>`)
    }
    const workspaceName = `${parts[0]}/${parts[1]}`

    // It is possible to connect to any previously connected workspace, which
    // might not belong to the deployment the plugin is currently logged into.
    // For that reason, create a separate REST client instead of using the
    // global one generally used by the plugin.  For now this is not actually
    // useful because we are using the the current URL and token anyway, but in
    // a future PR we will store these per deployment and grab the right one
    // based on the host name of the workspace to which we are connecting.
    const baseUrlRaw = this.storage.getUrl()
    if (!baseUrlRaw) {
      const result = await this.vscodeProposed.window.showInformationMessage(
        "You are not logged in...",
        {
          useCustom: true,
          modal: true,
          detail: `You must log in to access ${workspaceName}.`,
        },
        "Log In",
      )
      if (!result) {
        // User declined to log in.
        await this.closeRemote()
      } else {
        // Log in then try again.
        await vscode.commands.executeCommand("coder.login")
        await this.setup(remoteAuthority)
      }
      return
    }

    const baseUrl = new URL(baseUrlRaw)
    const token = await this.storage.getSessionToken()
    const restClient = await makeCoderSdk(baseUrlRaw, token, this.storage)
    // Store for use in commands.
    this.commands.workspaceRestClient = restClient

    // First thing is to check the version.
    const buildInfo = await restClient.getBuildInfo()
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
    const hasCoderLogs = supportsCoderAgentLogDirFlag(parsedVersion)

    // Next is to find the workspace from the URI scheme provided.
    let workspace: Workspace
    try {
      workspace = await restClient.getWorkspaceByOwnerAndName(parts[0], parts[1])
      this.commands.workspace = workspace
    } catch (error) {
      if (!isAxiosError(error)) {
        throw error
      }
      switch (error.response?.status) {
        case 404: {
          const result = await this.vscodeProposed.window.showInformationMessage(
            `That workspace doesn't exist!`,
            {
              modal: true,
              detail: `${workspaceName} cannot be found on ${baseUrlRaw}. Maybe it was deleted...`,
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
              detail: `You must log in to access ${workspaceName}.`,
            },
            "Log In",
          )
          if (!result) {
            await this.closeRemote()
          } else {
            await vscode.commands.executeCommand("coder.login", baseUrlRaw)
            await this.setup(remoteAuthority)
          }
          return
        }
        default:
          throw error
      }
    }

    const disposables: vscode.Disposable[] = []
    // Register before connection so the label still displays!
    disposables.push(this.registerLabelFormatter(remoteAuthority, workspace.owner_name, workspace.name))

    // Initialize any WorkspaceAction notifications (auto-off, upcoming deletion)
    const action = await WorkspaceAction.init(this.vscodeProposed, restClient, this.storage)

    // Make sure the workspace has started.
    let buildComplete: undefined | (() => void)
    if (workspace.latest_build.status === "stopped") {
      // If the workspace requires the latest active template version, we should attempt
      // to update that here.
      // TODO: If param set changes, what do we do??
      const versionID = workspace.template_require_active_version
        ? // Use the latest template version
          workspace.template_active_version_id
        : // Default to not updating the workspace if not required.
          workspace.latest_build.template_version_id

      this.vscodeProposed.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: false,
          title: workspace.template_require_active_version ? "Updating workspace..." : "Starting workspace...",
        },
        () =>
          new Promise<void>((r) => {
            buildComplete = r
          }),
      )

      const latestBuild = await restClient.startWorkspace(workspace.id, versionID)
      workspace = {
        ...workspace,
        latest_build: latestBuild,
      }
      this.commands.workspace = workspace
    }

    // If a build is running we should stream the logs to the user so they can
    // watch what's going on!
    if (
      workspace.latest_build.status === "pending" ||
      workspace.latest_build.status === "starting" ||
      workspace.latest_build.status === "stopping"
    ) {
      const writeEmitter = new vscode.EventEmitter<string>()
      // We use a terminal instead of an output channel because it feels more
      // familiar to a user!
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
      const logs = await restClient.getWorkspaceBuildLogs(workspace.latest_build.id, new Date())
      logs.forEach((log) => writeEmitter.fire(log.output + "\r\n"))
      terminal.show(true)
      // This follows the logs for new activity!
      // TODO: watchBuildLogsByBuildId exists, but it uses `location`.
      //       Would be nice if we could use it here.
      let path = `/api/v2/workspacebuilds/${workspace.latest_build.id}/logs?follow=true`
      if (logs.length) {
        path += `&after=${logs[logs.length - 1].id}`
      }
      await new Promise<void>((resolve, reject) => {
        const proto = baseUrl.protocol === "https:" ? "wss:" : "ws:"
        const socket = new ws.WebSocket(new URL(`${proto}//${baseUrl.host}${path}`), {
          headers: {
            "Coder-Session-Token": token,
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
      workspace = await restClient.getWorkspace(workspace.id)
      this.commands.workspace = workspace
      terminal.dispose()

      if (buildComplete) {
        buildComplete()
      }

      if (workspace.latest_build.status === "stopped") {
        const result = await this.vscodeProposed.window.showInformationMessage(
          `This workspace is stopped!`,
          {
            modal: true,
            detail: `Click below to start and open ${parts[0]}/${parts[1]}.`,
            useCustom: true,
          },
          "Start Workspace",
        )
        if (!result) {
          await this.closeRemote()
        }
        await this.reloadWindow()
        return
      }
    }

    // Pick an agent.
    const agents = workspace.latest_build.resources.reduce((acc, resource) => {
      return acc.concat(resource.agents || [])
    }, [] as WorkspaceAgent[])

    let agent: WorkspaceAgent | undefined

    if (parts.length === 2) {
      if (agents.length === 1) {
        agent = agents[0]
      }

      // If there are multiple agents, we should select one here! TODO: Support
      // multiple agents!
    }

    if (!agent) {
      const matchingAgents = agents.filter((agent) => agent.name === parts[2])
      if (matchingAgents.length !== 1) {
        // TODO: Show the agent selector here instead!
        throw new Error(`Invalid Coder SSH authority. Agent not found!`)
      }
      agent = matchingAgents[0]
    }

    // Do some janky setting manipulation.
    const hostname = authorityParts[1]
    const remotePlatforms = this.vscodeProposed.workspace
      .getConfiguration()
      .get<Record<string, string>>("remote.SSH.remotePlatform", {})
    const connTimeout = this.vscodeProposed.workspace
      .getConfiguration()
      .get<number | undefined>("remote.SSH.connectTimeout")

    // We have to directly munge the settings file with jsonc because trying to
    // update properly through the extension API hangs indefinitely.  Possibly
    // VS Code is trying to update configuration on the remote, which cannot
    // connect until we finish here leading to a deadlock.  We need to update it
    // locally, anyway, and it does not seem possible to force that via API.
    let settingsContent = "{}"
    try {
      settingsContent = await fs.readFile(this.storage.getUserSettingsPath(), "utf8")
    } catch (ex) {
      // Ignore! It's probably because the file doesn't exist.
    }

    // Add the remote platform for this host to bypass a step where VS Code asks
    // the user for the platform.
    let mungedPlatforms = false
    if (!remotePlatforms[hostname] || remotePlatforms[hostname] !== agent.operating_system) {
      remotePlatforms[hostname] = agent.operating_system
      settingsContent = jsonc.applyEdits(
        settingsContent,
        jsonc.modify(settingsContent, ["remote.SSH.remotePlatform"], remotePlatforms, {}),
      )
      mungedPlatforms = true
    }

    // VS Code ignores the connect timeout in the SSH config and uses a default
    // of 15 seconds, which can be too short in the case where we wait for
    // startup scripts.  For now we hardcode a longer value.  Because this is
    // potentially overwriting user configuration, it feels a bit sketchy.  If
    // microsoft/vscode-remote-release#8519 is resolved we can remove this.
    const minConnTimeout = 1800
    let mungedConnTimeout = false
    if (!connTimeout || connTimeout < minConnTimeout) {
      settingsContent = jsonc.applyEdits(
        settingsContent,
        jsonc.modify(settingsContent, ["remote.SSH.connectTimeout"], minConnTimeout, {}),
      )
      mungedConnTimeout = true
    }

    if (mungedPlatforms || mungedConnTimeout) {
      try {
        await fs.writeFile(this.storage.getUserSettingsPath(), settingsContent)
      } catch (ex) {
        // This could be because the user's settings.json is read-only.  This is
        // the case when using home-manager on NixOS, for example.  Failure to
        // write here is not necessarily catastrophic since the user will be
        // asked for the platform and the default timeout might be sufficient.
        mungedPlatforms = mungedConnTimeout = false
        this.storage.writeToCoderOutputChannel(`Failed to configure settings: ${ex}`)
      }
    }

    // Watch for workspace updates.
    const workspaceUpdate = new vscode.EventEmitter<Workspace>()
    const watchURL = new URL(`${baseUrlRaw}/api/v2/workspaces/${workspace.id}/watch`)
    const eventSource = new EventSource(watchURL.toString(), {
      headers: {
        "Coder-Session-Token": token,
      },
    })

    const workspaceUpdatedStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 999)
    disposables.push(workspaceUpdatedStatus)

    let hasShownOutdatedNotification = false
    const refreshWorkspaceUpdatedStatus = (newWorkspace: Workspace) => {
      // If the newly gotten workspace was updated, then we show a notification
      // to the user that they should update.
      if (newWorkspace.outdated) {
        if (!workspace.outdated || !hasShownOutdatedNotification) {
          hasShownOutdatedNotification = true
          restClient
            .getTemplate(newWorkspace.template_id)
            .then((template) => {
              return restClient.getTemplateVersion(template.active_version_id)
            })
            .then((version) => {
              let infoMessage = `A new version of your workspace is available.`
              if (version.message) {
                infoMessage = `A new version of your workspace is available: ${version.message}`
              }
              vscode.window.showInformationMessage(infoMessage, "Update").then((action) => {
                if (action === "Update") {
                  vscode.commands.executeCommand("coder.workspace.update", newWorkspace, restClient)
                }
              })
            })
        }
      }
      if (!newWorkspace.outdated) {
        vscode.commands.executeCommand("setContext", "coder.workspace.updatable", false)
        workspaceUpdatedStatus.hide()
        return
      }
      workspaceUpdatedStatus.name = "Coder Workspace Update"
      workspaceUpdatedStatus.text = "$(fold-up) Update Workspace"
      workspaceUpdatedStatus.command = "coder.workspace.update"
      // Important for hiding the "Update Workspace" command.
      vscode.commands.executeCommand("setContext", "coder.workspace.updatable", true)
      workspaceUpdatedStatus.show()
    }
    // Show an initial status!
    refreshWorkspaceUpdatedStatus(workspace)

    eventSource.addEventListener("data", (event: MessageEvent<string>) => {
      const workspace = JSON.parse(event.data) as Workspace
      if (!workspace) {
        return
      }
      refreshWorkspaceUpdatedStatus(workspace)
      this.commands.workspace = workspace
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
      // If a new build is initialized for a workspace, we automatically
      // reload the window. Then the build log will appear, and startup
      // will continue as expected.
      if (workspace.latest_build.status === "starting") {
        this.reloadWindow()
        return
      }
    })

    // Wait for the agent to connect.
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

    // Make sure agent did not time out.
    // TODO: Seems like maybe we should check for all the good states rather
    //       than one bad state?  Agents can error in many ways.
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

    // This ensures the Remote SSH extension resolves the host to execute the
    // Coder binary properly.
    //
    // If we didn't write to the SSH config file, connecting would fail with
    // "Host not found".
    try {
      await this.updateSSHConfig(restClient, authorityParts[1], hasCoderLogs)
    } catch (error) {
      this.storage.writeToCoderOutputChannel(`Failed to configure SSH: ${error}`)
      throw error
    }

    // TODO: This needs to be reworked; it fails to pick up reconnects.
    this.findSSHProcessID().then((pid) => {
      if (!pid) {
        // TODO: Show an error here!
        return
      }
      disposables.push(this.showNetworkUpdates(pid))
      this.commands.workspaceLogPath = path.join(this.storage.getLogPath(), `${pid}.log`)
    })

    // Register the label formatter again because SSH overrides it!
    const agentName = agents.length > 1 ? agent.name : undefined
    disposables.push(
      vscode.extensions.onDidChange(() => {
        disposables.push(this.registerLabelFormatter(remoteAuthority, workspace.owner_name, workspace.name, agentName))
      }),
    )

    return {
      dispose: () => {
        eventSource.close()
        action.cleanupWorkspaceActions()
        disposables.forEach((d) => d.dispose())
      },
    }
  }

  // updateSSHConfig updates the SSH configuration with a wildcard that handles
  // all Coder entries.
  private async updateSSHConfig(restClient: Api, hostName: string, hasCoderLogs = false) {
    let deploymentSSHConfig = defaultSSHConfigResponse
    try {
      const deploymentConfig = await restClient.getDeploymentSSHConfig()
      deploymentSSHConfig = deploymentConfig.ssh_config_options
    } catch (error) {
      if (!isAxiosError(error)) {
        throw error
      }
      switch (error.response?.status) {
        case 404: {
          // Deployment does not support overriding ssh config yet. Likely an
          // older version, just use the default.
          break
        }
        case 401: {
          await this.vscodeProposed.window.showErrorMessage("Your session expired...")
          throw error
        }
        default:
          throw error
      }
    }

    // deploymentConfig is now set from the remote coderd deployment.
    // Now override with the user's config.
    const userConfigSSH = vscode.workspace.getConfiguration("coder").get<string[]>("sshConfig") || []
    // Parse the user's config into a Record<string, string>.
    const userConfig = userConfigSSH.reduce(
      (acc, line) => {
        let i = line.indexOf("=")
        if (i === -1) {
          i = line.indexOf(" ")
          if (i === -1) {
            // This line is malformed. The setting is incorrect, and does not match
            // the pattern regex in the settings schema.
            return acc
          }
        }
        const key = line.slice(0, i)
        const value = line.slice(i + 1)
        acc[key] = value
        return acc
      },
      {} as Record<string, string>,
    )
    const sshConfigOverrides = mergeSSHConfigValues(deploymentSSHConfig, userConfig)

    let sshConfigFile = vscode.workspace.getConfiguration().get<string>("remote.SSH.configFile")
    if (!sshConfigFile) {
      sshConfigFile = path.join(os.homedir(), ".ssh", "config")
    }
    // VS Code Remote resolves ~ to the home directory.
    // This is required for the tilde to work on Windows.
    if (sshConfigFile.startsWith("~")) {
      sshConfigFile = path.join(os.homedir(), sshConfigFile.slice(1))
    }

    const sshConfig = new SSHConfig(sshConfigFile)
    await sshConfig.load()

    let binaryPath: string | undefined
    if (this.mode === vscode.ExtensionMode.Production) {
      binaryPath = await this.storage.fetchBinary(restClient)
    } else {
      try {
        // In development, try to use `/tmp/coder` as the binary path.
        // This is useful for debugging with a custom bin!
        binaryPath = path.join(os.tmpdir(), "coder")
        await fs.stat(binaryPath)
      } catch (ex) {
        binaryPath = await this.storage.fetchBinary(restClient)
      }
    }

    const escape = (str: string): string => `"${str.replace(/"/g, '\\"')}"`
    // Escape a command line to be executed by the Coder binary, so ssh doesn't substitute variables.
    const escapeSubcommand: (str: string) => string =
      os.platform() === "win32"
        ? // On Windows variables are %VAR%, and we need to use double quotes.
          (str) => escape(str).replace(/%/g, "%%")
        : // On *nix we can use single quotes to escape $VARS.
          // Note single quotes cannot be escaped inside single quotes.
          (str) => `'${str.replace(/'/g, "'\\''")}'`

    // Add headers from the header command.
    let headerArg = ""
    const headerCommand = getHeaderCommand(vscode.workspace.getConfiguration())
    if (typeof headerCommand === "string" && headerCommand.trim().length > 0) {
      headerArg = ` --header-command ${escapeSubcommand(headerCommand)}`
    }
    let logArg = ""
    if (hasCoderLogs) {
      await fs.mkdir(this.storage.getLogPath(), { recursive: true })
      logArg = ` --log-dir ${escape(this.storage.getLogPath())}`
    }
    const sshValues: SSHValues = {
      Host: `${Remote.Prefix}*`,
      ProxyCommand: `${escape(binaryPath)}${headerArg} vscodessh --network-info-dir ${escape(
        this.storage.getNetworkInfoPath(),
      )}${logArg} --session-token-file ${escape(this.storage.getSessionTokenPath())} --url-file ${escape(
        this.storage.getURLPath(),
      )} %h`,
      ConnectTimeout: "0",
      StrictHostKeyChecking: "no",
      UserKnownHostsFile: "/dev/null",
      LogLevel: "ERROR",
    }
    if (sshSupportsSetEnv()) {
      // This allows for tracking the number of extension
      // users connected to workspaces!
      sshValues.SetEnv = " CODER_SSH_SESSION_TYPE=vscode"
    }

    await sshConfig.update(sshValues, sshConfigOverrides)

    // A user can provide a "Host *" entry in their SSH config to add options
    // to all hosts. We need to ensure that the options we set are not
    // overridden by the user's config.
    const computedProperties = computeSSHProperties(hostName, sshConfig.getRaw())
    const keysToMatch: Array<keyof SSHValues> = ["ProxyCommand", "UserKnownHostsFile", "StrictHostKeyChecking"]
    for (let i = 0; i < keysToMatch.length; i++) {
      const key = keysToMatch[i]
      if (computedProperties[key] === sshValues[key]) {
        continue
      }

      const result = await this.vscodeProposed.window.showErrorMessage(
        "Unexpected SSH Config Option",
        {
          useCustom: true,
          modal: true,
          detail: `Your SSH config is overriding the "${key}" property to "${computedProperties[key]}" when it expected "${sshValues[key]}" for the "${hostName}" host. Please fix this and try again!`,
        },
        "Reload Window",
      )
      if (result === "Reload Window") {
        await this.reloadWindow()
      }
      await this.closeRemote()
    }

    return sshConfig.getRaw()
  }

  // showNetworkUpdates finds the SSH process ID that is being used by this
  // workspace and reads the file being created by the Coder CLI.
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

  // findSSHProcessID returns the currently active SSH process ID that is
  // powering the remote SSH connection.
  private async findSSHProcessID(timeout = 15000): Promise<number | undefined> {
    const search = async (logPath: string): Promise<number | undefined> => {
      // This searches for the socksPort that Remote SSH is connecting to. We do
      // this to find the SSH process that is powering this connection. That SSH
      // process will be logging network information periodically to a file.
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
  public async closeRemote() {
    await vscode.commands.executeCommand("workbench.action.remote.close")
  }

  // reloadWindow reloads the current window.
  public async reloadWindow() {
    await vscode.commands.executeCommand("workbench.action.reloadWindow")
  }

  private registerLabelFormatter(
    remoteAuthority: string,
    owner: string,
    workspace: string,
    agent?: string,
  ): vscode.Disposable {
    // VS Code splits based on the separator when displaying the label
    // in a recently opened dialog. If the workspace suffix contains /,
    // then it'll visually display weird:
    // "/home/kyle [Coder: kyle/workspace]" displays as "workspace] /home/kyle [Coder: kyle"
    // For this reason, we use a different / that visually appears the
    // same on non-monospace fonts "∕".
    let suffix = `Coder: ${owner}∕${workspace}`
    if (agent) {
      suffix += `∕${agent}`
    }
    // VS Code caches resource label formatters in it's global storage SQLite database
    // under the key "memento/cachedResourceLabelFormatters2".
    return this.vscodeProposed.workspace.registerResourceLabelFormatter({
      scheme: "vscode-remote",
      // authority is optional but VS Code prefers formatters that most
      // accurately match the requested authority, so we include it.
      authority: remoteAuthority,
      formatting: {
        label: "${path}",
        separator: "/",
        tildify: true,
        workspaceSuffix: suffix,
      },
    })
  }
}
