import { isAxiosError } from "axios"
import { Api } from "coder/site/src/api/api"
import { Workspace } from "coder/site/src/api/typesGenerated"
import find from "find-process"
import * as fs from "fs/promises"
import * as jsonc from "jsonc-parser"
import * as os from "os"
import * as path from "path"
import prettyBytes from "pretty-bytes"
import * as semver from "semver"
import * as vscode from "vscode"
import { makeCoderSdk, needToken, startWorkspaceIfStoppedOrFailed, waitForBuild } from "./api"
import { extractAgents } from "./api-helper"
import * as cli from "./cliManager"
import { Commands } from "./commands"
import { featureSetForVersion, FeatureSet } from "./featureSet"
import { getHeaderCommand } from "./headers"
import { SSHConfig, SSHValues, mergeSSHConfigValues } from "./sshConfig"
import { computeSSHProperties, sshSupportsSetEnv } from "./sshSupport"
import { Storage } from "./storage"
import { AuthorityPrefix, expandPath, parseRemoteAuthority } from "./util"
import { WorkspaceMonitor } from "./workspaceMonitor"

export interface RemoteDetails extends vscode.Disposable {
  url: string
  token: string
}

export class Remote {
  public constructor(
    // We use the proposed API to get access to useCustom in dialogs.
    private readonly vscodeProposed: typeof vscode,
    private readonly storage: Storage,
    private readonly commands: Commands,
    private readonly mode: vscode.ExtensionMode,
  ) {}

  private async confirmStart(workspaceName: string): Promise<boolean> {
    const action = await this.vscodeProposed.window.showInformationMessage(
      `Unable to connect to the workspace ${workspaceName} because it is not running. Start the workspace?`,
      {
        useCustom: true,
        modal: true,
      },
      "Start",
    )
    return action === "Start"
  }

  /**
   * Try to get the workspace running.  Return undefined if the user canceled.
   */
  private async maybeWaitForRunning(
    restClient: Api,
    workspace: Workspace,
    label: string,
    binPath: string,
  ): Promise<Workspace | undefined> {
    // Maybe already running?
    if (workspace.latest_build.status === "running") {
      return workspace
    }

    const workspaceName = `${workspace.owner_name}/${workspace.name}`

    // A terminal will be used to stream the build, if one is necessary.
    let writeEmitter: undefined | vscode.EventEmitter<string>
    let terminal: undefined | vscode.Terminal
    let attempts = 0

    function initWriteEmitterAndTerminal(): vscode.EventEmitter<string> {
      if (!writeEmitter) {
        writeEmitter = new vscode.EventEmitter<string>()
      }
      if (!terminal) {
        terminal = vscode.window.createTerminal({
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
        terminal.show(true)
      }
      return writeEmitter
    }

    try {
      // Show a notification while we wait.
      return await this.vscodeProposed.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: false,
          title: "Waiting for workspace build...",
        },
        async () => {
          const globalConfigDir = path.dirname(this.storage.getSessionTokenPath(label))
          while (workspace.latest_build.status !== "running") {
            ++attempts
            switch (workspace.latest_build.status) {
              case "pending":
              case "starting":
              case "stopping":
                writeEmitter = initWriteEmitterAndTerminal()
                this.storage.writeToCoderOutputChannel(`Waiting for ${workspaceName}...`)
                workspace = await waitForBuild(restClient, writeEmitter, workspace)
                break
              case "stopped":
                if (!(await this.confirmStart(workspaceName))) {
                  return undefined
                }
                writeEmitter = initWriteEmitterAndTerminal()
                this.storage.writeToCoderOutputChannel(`Starting ${workspaceName}...`)
                workspace = await startWorkspaceIfStoppedOrFailed(
                  restClient,
                  globalConfigDir,
                  binPath,
                  workspace,
                  writeEmitter,
                )
                break
              case "failed":
                // On a first attempt, we will try starting a failed workspace
                // (for example canceling a start seems to cause this state).
                if (attempts === 1) {
                  if (!(await this.confirmStart(workspaceName))) {
                    return undefined
                  }
                  writeEmitter = initWriteEmitterAndTerminal()
                  this.storage.writeToCoderOutputChannel(`Starting ${workspaceName}...`)
                  workspace = await startWorkspaceIfStoppedOrFailed(
                    restClient,
                    globalConfigDir,
                    binPath,
                    workspace,
                    writeEmitter,
                  )
                  break
                }
              // Otherwise fall through and error.
              case "canceled":
              case "canceling":
              case "deleted":
              case "deleting":
              default: {
                const is = workspace.latest_build.status === "failed" ? "has" : "is"
                throw new Error(`${workspaceName} ${is} ${workspace.latest_build.status}`)
              }
            }
            this.storage.writeToCoderOutputChannel(`${workspaceName} status is now ${workspace.latest_build.status}`)
          }
          return workspace
        },
      )
    } finally {
      if (writeEmitter) {
        writeEmitter.dispose()
      }
      if (terminal) {
        terminal.dispose()
      }
    }
  }

  /**
   * Ensure the workspace specified by the remote authority is ready to receive
   * SSH connections.  Return undefined if the authority is not for a Coder
   * workspace or when explicitly closing the remote.
   */
  public async setup(remoteAuthority: string): Promise<RemoteDetails | undefined> {
    const parts = parseRemoteAuthority(remoteAuthority)
    if (!parts) {
      // Not a Coder host.
      return
    }

    const workspaceName = `${parts.username}/${parts.workspace}`

    // Migrate "session_token" file to "session", if needed.
    await this.storage.migrateSessionToken(parts.label)

    // Get the URL and token belonging to this host.
    const { url: baseUrlRaw, token } = await this.storage.readCliConfig(parts.label)

    // It could be that the cli config was deleted.  If so, ask for the url.
    if (!baseUrlRaw || (!token && needToken())) {
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
        await vscode.commands.executeCommand("coder.login", baseUrlRaw, undefined, parts.label)
        await this.setup(remoteAuthority)
      }
      return
    }

    this.storage.writeToCoderOutputChannel(`Using deployment URL: ${baseUrlRaw}`)
    this.storage.writeToCoderOutputChannel(`Using deployment label: ${parts.label || "n/a"}`)

    // We could use the plugin client, but it is possible for the user to log
    // out or log into a different deployment while still connected, which would
    // break this connection.  We could force close the remote session or
    // disallow logging out/in altogether, but for now just use a separate
    // client to remain unaffected by whatever the plugin is doing.
    const workspaceRestClient = await makeCoderSdk(baseUrlRaw, token, this.storage)
    // Store for use in commands.
    this.commands.workspaceRestClient = workspaceRestClient

    let binaryPath: string | undefined
    if (this.mode === vscode.ExtensionMode.Production) {
      binaryPath = await this.storage.fetchBinary(workspaceRestClient, parts.label)
    } else {
      try {
        // In development, try to use `/tmp/coder` as the binary path.
        // This is useful for debugging with a custom bin!
        binaryPath = path.join(os.tmpdir(), "coder")
        await fs.stat(binaryPath)
      } catch (ex) {
        binaryPath = await this.storage.fetchBinary(workspaceRestClient, parts.label)
      }
    }

    // First thing is to check the version.
    const buildInfo = await workspaceRestClient.getBuildInfo()

    let version: semver.SemVer | null = null
    try {
      version = semver.parse(await cli.version(binaryPath))
    } catch (e) {
      version = semver.parse(buildInfo.version)
    }

    const featureSet = featureSetForVersion(version)

    // Server versions before v0.14.1 don't support the vscodessh command!
    if (!featureSet.vscodessh) {
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

    // Next is to find the workspace from the URI scheme provided.
    let workspace: Workspace
    try {
      this.storage.writeToCoderOutputChannel(`Looking for workspace ${workspaceName}...`)
      workspace = await workspaceRestClient.getWorkspaceByOwnerAndName(parts.username, parts.workspace)
      this.storage.writeToCoderOutputChannel(
        `Found workspace ${workspaceName} with status ${workspace.latest_build.status}`,
      )
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
            await vscode.commands.executeCommand("coder.login", baseUrlRaw, undefined, parts.label)
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

    // If the workspace is not in a running state, try to get it running.
    const updatedWorkspace = await this.maybeWaitForRunning(workspaceRestClient, workspace, parts.label, binaryPath)
    if (!updatedWorkspace) {
      // User declined to start the workspace.
      await this.closeRemote()
      return
    }
    this.commands.workspace = workspace = updatedWorkspace

    // Pick an agent.
    this.storage.writeToCoderOutputChannel(`Finding agent for ${workspaceName}...`)
    const gotAgent = await this.commands.maybeAskAgent(workspace, parts.agent)
    if (!gotAgent) {
      // User declined to pick an agent.
      await this.closeRemote()
      return
    }
    let agent = gotAgent // Reassign so it cannot be undefined in callbacks.
    this.storage.writeToCoderOutputChannel(`Found agent ${agent.name} with status ${agent.status}`)

    // Do some janky setting manipulation.
    this.storage.writeToCoderOutputChannel("Modifying settings...")
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
    if (!remotePlatforms[parts.host] || remotePlatforms[parts.host] !== agent.operating_system) {
      remotePlatforms[parts.host] = agent.operating_system
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

    // Watch the workspace for changes.
    const monitor = new WorkspaceMonitor(workspace, workspaceRestClient, this.storage, this.vscodeProposed)
    disposables.push(monitor)
    disposables.push(monitor.onChange.event((w) => (this.commands.workspace = w)))

    // Wait for the agent to connect.
    if (agent.status === "connecting") {
      this.storage.writeToCoderOutputChannel(`Waiting for ${workspaceName}/${agent.name}...`)
      await vscode.window.withProgress(
        {
          title: "Waiting for the agent to connect...",
          location: vscode.ProgressLocation.Notification,
        },
        async () => {
          await new Promise<void>((resolve) => {
            const updateEvent = monitor.onChange.event((workspace) => {
              if (!agent) {
                return
              }
              const agents = extractAgents(workspace)
              const found = agents.find((newAgent) => {
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
      this.storage.writeToCoderOutputChannel(`Agent ${agent.name} status is now ${agent.status}`)
    }

    // Make sure the agent is connected.
    // TODO: Should account for the lifecycle state as well?
    if (agent.status !== "connected") {
      const result = await this.vscodeProposed.window.showErrorMessage(
        `${workspaceName}/${agent.name} ${agent.status}`,
        {
          useCustom: true,
          modal: true,
          detail: `The ${agent.name} agent failed to connect. Try restarting your workspace.`,
        },
      )
      if (!result) {
        await this.closeRemote()
        return
      }
      await this.reloadWindow()
      return
    }

    const logDir = this.getLogDir(featureSet)

    // This ensures the Remote SSH extension resolves the host to execute the
    // Coder binary properly.
    //
    // If we didn't write to the SSH config file, connecting would fail with
    // "Host not found".
    try {
      this.storage.writeToCoderOutputChannel("Updating SSH config...")
      await this.updateSSHConfig(workspaceRestClient, parts.label, parts.host, binaryPath, logDir, featureSet)
    } catch (error) {
      this.storage.writeToCoderOutputChannel(`Failed to configure SSH: ${error}`)
      throw error
    }

    // TODO: This needs to be reworked; it fails to pick up reconnects.
    this.findSSHProcessID().then(async (pid) => {
      if (!pid) {
        // TODO: Show an error here!
        return
      }
      disposables.push(this.showNetworkUpdates(pid))
      if (logDir) {
        const logFiles = await fs.readdir(logDir)
        this.commands.workspaceLogPath = logFiles
          .reverse()
          .find((file) => file === `${pid}.log` || file.endsWith(`-${pid}.log`))
      } else {
        this.commands.workspaceLogPath = undefined
      }
    })

    // Register the label formatter again because SSH overrides it!
    disposables.push(
      vscode.extensions.onDidChange(() => {
        disposables.push(this.registerLabelFormatter(remoteAuthority, workspace.owner_name, workspace.name, agent.name))
      }),
    )

    this.storage.writeToCoderOutputChannel("Remote setup complete")

    // Returning the URL and token allows the plugin to authenticate its own
    // client, for example to display the list of workspaces belonging to this
    // deployment in the sidebar.  We use our own client in here for reasons
    // explained above.
    return {
      url: baseUrlRaw,
      token,
      dispose: () => {
        disposables.forEach((d) => d.dispose())
      },
    }
  }

  /**
   * Return the --log-dir argument value for the ProxyCommand.  It may be an
   * empty string if the setting is not set or the cli does not support it.
   */
  private getLogDir(featureSet: FeatureSet): string {
    if (!featureSet.proxyLogDirectory) {
      return ""
    }
    // If the proxyLogDirectory is not set in the extension settings we don't send one.
    return expandPath(String(vscode.workspace.getConfiguration().get("coder.proxyLogDirectory") ?? "").trim())
  }

  /**
   * Formats the --log-dir argument for the ProxyCommand after making sure it
   * has been created.
   */
  private async formatLogArg(logDir: string): Promise<string> {
    if (!logDir) {
      return ""
    }
    await fs.mkdir(logDir, { recursive: true })
    this.storage.writeToCoderOutputChannel(`SSH proxy diagnostics are being written to ${logDir}`)
    return ` --log-dir ${escape(logDir)}`
  }

  // updateSSHConfig updates the SSH configuration with a wildcard that handles
  // all Coder entries.
  private async updateSSHConfig(
    restClient: Api,
    label: string,
    hostName: string,
    binaryPath: string,
    logDir: string,
    featureSet: FeatureSet,
  ) {
    let deploymentSSHConfig = {}
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

    const hostPrefix = label ? `${AuthorityPrefix}.${label}--` : `${AuthorityPrefix}--`

    const proxyCommand = featureSet.wildcardSSH
      ? `${escape(binaryPath)}${headerArg} --global-config ${escape(
          path.dirname(this.storage.getSessionTokenPath(label)),
        )} ssh --stdio --network-info-dir ${escape(this.storage.getNetworkInfoPath())}${await this.formatLogArg(logDir)} --ssh-host-prefix ${hostPrefix} %h`
      : `${escape(binaryPath)}${headerArg} vscodessh --network-info-dir ${escape(
          this.storage.getNetworkInfoPath(),
        )}${await this.formatLogArg(logDir)} --session-token-file ${escape(this.storage.getSessionTokenPath(label))} --url-file ${escape(
          this.storage.getUrlPath(label),
        )} %h`

    const sshValues: SSHValues = {
      Host: hostPrefix + `*`,
      ProxyCommand: proxyCommand,
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

    await sshConfig.update(label, sshValues, sshConfigOverrides)

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
          "You're connected through a relay 🕵.\nWe'll switch over to peer-to-peer when available."
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

        networkStatus.tooltip += `You ↔ ${derpLatency.toFixed(2)}ms ↔ ${network.preferred_derp} ↔ ${(network.latency - derpLatency).toFixed(2)}ms ↔ Workspace`

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
