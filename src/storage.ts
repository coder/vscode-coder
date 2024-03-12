import axios from "axios"
import { getBuildInfo } from "coder/site/src/api/api"
import { Workspace } from "coder/site/src/api/typesGenerated"
import { createWriteStream } from "fs"
import fs from "fs/promises"
import { ensureDir } from "fs-extra"
import { IncomingMessage } from "http"
import path from "path"
import prettyBytes from "pretty-bytes"
import * as vscode from "vscode"
import { errToStr } from "./api-helper"
import * as cli from "./cliManager"
import { getHeaderCommand, getHeaders } from "./headers"

// Maximium number of recent URLs to store.
const MAX_URLS = 10

export class Storage {
  public workspace?: Workspace
  public workspaceLogPath?: string

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly memento: vscode.Memento,
    private readonly secrets: vscode.SecretStorage,
    private readonly globalStorageUri: vscode.Uri,
    private readonly logUri: vscode.Uri,
  ) {}

  /**
   * Set the URL and session token on the Axios client and on disk for the cli
   * if they are set.
   */
  public async init(): Promise<void> {
    await this.updateURL(this.getURL())
    await this.updateSessionToken()
  }

  /**
   * Add the URL to the list of recently accessed URLs in global storage, then
   * set it as the current URL and update it on the Axios client and on disk for
   * the cli.
   *
   * If the URL is falsey, then remove it as the currently accessed URL and do
   * not touch the history.
   */
  public async setURL(url?: string): Promise<void> {
    await this.memento.update("url", url)
    this.updateURL(url)
    if (url) {
      const history = this.withUrlHistory(url)
      await this.memento.update("urlHistory", history)
    }
  }

  /**
   * Get the currently configured URL.
   */
  public getURL(): string | undefined {
    return this.memento.get("url")
  }

  /**
   * Get the most recently accessed URLs (oldest to newest) with the provided
   * values appended.  Duplicates will be removed.
   */
  public withUrlHistory(...append: (string | undefined)[]): string[] {
    const val = this.memento.get("urlHistory")
    const urls = Array.isArray(val) ? new Set(val) : new Set()
    for (const url of append) {
      if (url) {
        // It might exist; delete first so it gets appended.
        urls.delete(url)
        urls.add(url)
      }
    }
    // Slice off the head if the list is too large.
    return urls.size > MAX_URLS ? Array.from(urls).slice(urls.size - MAX_URLS, urls.size) : Array.from(urls)
  }

  public setSessionToken(sessionToken?: string): Thenable<void> {
    if (!sessionToken) {
      return this.secrets.delete("sessionToken").then(() => {
        return this.updateSessionToken()
      })
    }
    return this.secrets.store("sessionToken", sessionToken).then(() => {
      return this.updateSessionToken()
    })
  }

  public async getSessionToken(): Promise<string | undefined> {
    try {
      return await this.secrets.get("sessionToken")
    } catch (ex) {
      // The VS Code session store has become corrupt before, and
      // will fail to get the session token...
      return undefined
    }
  }

  // getRemoteSSHLogPath returns the log path for the "Remote - SSH" output panel.
  // There is no VS Code API to get the contents of an output panel. We use this
  // to get the active port so we can display network information.
  public async getRemoteSSHLogPath(): Promise<string | undefined> {
    const upperDir = path.dirname(this.logUri.fsPath)
    // Node returns these directories sorted already!
    const dirs = await fs.readdir(upperDir)
    const latestOutput = dirs.reverse().filter((dir) => dir.startsWith("output_logging_"))
    if (latestOutput.length === 0) {
      return undefined
    }
    const dir = await fs.readdir(path.join(upperDir, latestOutput[0]))
    const remoteSSH = dir.filter((file) => file.indexOf("Remote - SSH") !== -1)
    if (remoteSSH.length === 0) {
      return undefined
    }
    return path.join(upperDir, latestOutput[0], remoteSSH[0])
  }

  /**
   * Download and return the path to a working binary.  If there is already a
   * working binary and it matches the server version, return that, skipping the
   * download.  Throw if unable to download a working binary.
   */
  public async fetchBinary(): Promise<string> {
    const baseURL = this.getURL()
    if (!baseURL) {
      throw new Error("Must be logged in!")
    }
    this.output.appendLine(`Using deployment URL: ${baseURL}`)

    // Get the build info to compare with the existing binary version, if any,
    // and to log for debugging.
    const buildInfo = await getBuildInfo()
    this.output.appendLine(`Got server version: ${buildInfo.version}`)

    // Check if there is an existing binary and whether it looks valid.  If it
    // is valid and matches the server, we can return early.
    const binPath = this.binaryPath()
    this.output.appendLine(`Using binary path: ${binPath}`)
    const stat = await cli.stat(binPath)
    if (stat === undefined) {
      this.output.appendLine("No existing binary found, starting download")
    } else {
      this.output.appendLine(`Existing binary size is ${prettyBytes(stat.size)}`)
      try {
        const version = await cli.version(binPath)
        this.output.appendLine(`Existing binary version is ${version}`)
        // If we have the right version we can avoid the request entirely.
        if (version === buildInfo.version) {
          this.output.appendLine("Using existing binary since it matches the server version")
          return binPath
        }
        this.output.appendLine("Downloading since existing binary does not match the server version")
      } catch (error) {
        this.output.appendLine(`Unable to get version of existing binary: ${error}`)
        this.output.appendLine("Downloading new binary instead")
      }
    }

    // Remove any left-over old or temporary binaries.
    const removed = await cli.rmOld(binPath)
    removed.forEach(({ fileName, error }) => {
      if (error) {
        this.output.appendLine(`Failed to remove ${fileName}: ${error}`)
      } else {
        this.output.appendLine(`Removed ${fileName}`)
      }
    })

    // Figure out where to get the binary.
    const binName = cli.name()
    const configSource = vscode.workspace.getConfiguration().get("coder.binarySource")
    const binSource = configSource && String(configSource).trim().length > 0 ? String(configSource) : "/bin/" + binName
    this.output.appendLine(`Downloading binary from: ${binSource}`)

    // Ideally we already caught that this was the right version and returned
    // early, but just in case set the ETag.
    const etag = stat !== undefined ? await cli.eTag(binPath) : ""
    this.output.appendLine(`Using ETag: ${etag}`)

    // Make the download request.
    const controller = new AbortController()
    const resp = await axios.get(binSource, {
      signal: controller.signal,
      baseURL: baseURL,
      responseType: "stream",
      headers: {
        "Accept-Encoding": "gzip",
        "If-None-Match": `"${etag}"`,
      },
      decompress: true,
      // Ignore all errors so we can catch a 404!
      validateStatus: () => true,
    })
    this.output.appendLine(`Got status code ${resp.status}`)

    switch (resp.status) {
      case 200: {
        const rawContentLength = resp.headers["content-length"]
        const contentLength = Number.parseInt(rawContentLength)
        if (Number.isNaN(contentLength)) {
          this.output.appendLine(`Got invalid or missing content length: ${rawContentLength}`)
        } else {
          this.output.appendLine(`Got content length: ${prettyBytes(contentLength)}`)
        }

        // Download to a temporary file.
        await fs.mkdir(path.dirname(binPath), { recursive: true })
        const tempFile = binPath + ".temp-" + Math.random().toString(36).substring(8)

        // Track how many bytes were written.
        let written = 0

        const completed = await vscode.window.withProgress<boolean>(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Downloading ${buildInfo.version} from ${axios.getUri(resp.config)} to ${binPath}`,
            cancellable: true,
          },
          async (progress, token) => {
            const readStream = resp.data as IncomingMessage
            let cancelled = false
            token.onCancellationRequested(() => {
              controller.abort()
              readStream.destroy()
              cancelled = true
            })

            // Reverse proxies might not always send a content length.
            const contentLengthPretty = Number.isNaN(contentLength) ? "unknown" : prettyBytes(contentLength)

            // Pipe data received from the request to the temp file.
            const writeStream = createWriteStream(tempFile, {
              autoClose: true,
              mode: 0o755,
            })
            readStream.on("data", (buffer: Buffer) => {
              writeStream.write(buffer, () => {
                written += buffer.byteLength
                progress.report({
                  message: `${prettyBytes(written)} / ${contentLengthPretty}`,
                  increment: Number.isNaN(contentLength) ? undefined : (buffer.byteLength / contentLength) * 100,
                })
              })
            })

            // Wait for the stream to end or error.
            return new Promise<boolean>((resolve, reject) => {
              writeStream.on("error", (error) => {
                readStream.destroy()
                reject(new Error(`Unable to download binary: ${errToStr(error, "no reason given")}`))
              })
              readStream.on("error", (error) => {
                writeStream.close()
                reject(new Error(`Unable to download binary: ${errToStr(error, "no reason given")}`))
              })
              readStream.on("close", () => {
                writeStream.close()
                if (cancelled) {
                  resolve(false)
                } else {
                  resolve(true)
                }
              })
            })
          },
        )

        // False means the user canceled, although in practice it appears we
        // would not get this far because VS Code already throws on cancelation.
        if (!completed) {
          this.output.appendLine("User aborted download")
          throw new Error("User aborted download")
        }

        this.output.appendLine(`Downloaded ${prettyBytes(written)} to ${path.basename(tempFile)}`)

        // Move the old binary to a backup location first, just in case.  And,
        // on Linux at least, you cannot write onto a binary that is in use so
        // moving first works around that (delete would also work).
        if (stat !== undefined) {
          const oldBinPath = binPath + ".old-" + Math.random().toString(36).substring(8)
          this.output.appendLine(`Moving existing binary to ${path.basename(oldBinPath)}`)
          await fs.rename(binPath, oldBinPath)
        }

        // Then move the temporary binary into the right place.
        this.output.appendLine(`Moving downloaded file to ${path.basename(binPath)}`)
        await fs.mkdir(path.dirname(binPath), { recursive: true })
        await fs.rename(tempFile, binPath)

        // For debugging, to see if the binary only partially downloaded.
        const newStat = await cli.stat(binPath)
        this.output.appendLine(`Downloaded binary size is ${prettyBytes(newStat?.size || 0)}`)

        // Make sure we can execute this new binary.
        const version = await cli.version(binPath)
        this.output.appendLine(`Downloaded binary version is ${version}`)

        return binPath
      }
      case 304: {
        this.output.appendLine("Using existing binary since server returned a 304")
        return binPath
      }
      case 404: {
        vscode.window
          .showErrorMessage(
            "Coder isn't supported for your platform. Please open an issue, we'd love to support it!",
            "Open an Issue",
          )
          .then((value) => {
            if (!value) {
              return
            }
            const os = cli.goos()
            const arch = cli.goarch()
            const params = new URLSearchParams({
              title: `Support the \`${os}-${arch}\` platform`,
              body: `I'd like to use the \`${os}-${arch}\` architecture with the VS Code extension.`,
            })
            const uri = vscode.Uri.parse(`https://github.com/coder/vscode-coder/issues/new?` + params.toString())
            vscode.env.openExternal(uri)
          })
        throw new Error("Platform not supported")
      }
      default: {
        vscode.window
          .showErrorMessage("Failed to download binary. Please open an issue.", "Open an Issue")
          .then((value) => {
            if (!value) {
              return
            }
            const params = new URLSearchParams({
              title: `Failed to download binary on \`${cli.goos()}-${cli.goarch()}\``,
              body: `Received status code \`${resp.status}\` when downloading the binary.`,
            })
            const uri = vscode.Uri.parse(`https://github.com/coder/vscode-coder/issues/new?` + params.toString())
            vscode.env.openExternal(uri)
          })
        throw new Error("Failed to download binary")
      }
    }
  }

  // getBinaryCachePath returns the path where binaries are cached.
  // The caller must ensure it exists before use.
  public getBinaryCachePath(): string {
    const configPath = vscode.workspace.getConfiguration().get("coder.binaryDestination")
    return configPath && String(configPath).trim().length > 0
      ? path.resolve(String(configPath))
      : path.join(this.globalStorageUri.fsPath, "bin")
  }

  // getNetworkInfoPath returns the path where network information
  // for SSH hosts is stored.
  public getNetworkInfoPath(): string {
    return path.join(this.globalStorageUri.fsPath, "net")
  }

  // getLogPath returns the path where log data from the Coder
  // agent is stored.
  public getLogPath(): string {
    return path.join(this.globalStorageUri.fsPath, "log")
  }

  public getUserSettingsPath(): string {
    return path.join(this.globalStorageUri.fsPath, "..", "..", "..", "User", "settings.json")
  }

  public getSessionTokenPath(): string {
    return path.join(this.globalStorageUri.fsPath, "session_token")
  }

  public getURLPath(): string {
    return path.join(this.globalStorageUri.fsPath, "url")
  }

  public writeToCoderOutputChannel(message: string) {
    this.output.appendLine(message)
    // We don't want to focus on the output here, because the
    // Coder server is designed to restart gracefully for users
    // because of P2P connections, and we don't want to draw
    // attention to it.
  }

  /**
   * Set the URL on the global Axios client and write the URL to disk which will
   * be used by the CLI via --url-file.
   */
  private async updateURL(url: string | undefined): Promise<void> {
    axios.defaults.baseURL = url
    if (url) {
      await ensureDir(this.globalStorageUri.fsPath)
      await fs.writeFile(this.getURLPath(), url)
    } else {
      await fs.rm(this.getURLPath(), { force: true })
    }
  }

  private binaryPath(): string {
    return path.join(this.getBinaryCachePath(), cli.name())
  }

  private async updateSessionToken() {
    const token = await this.getSessionToken()
    if (token) {
      axios.defaults.headers.common["Coder-Session-Token"] = token
      await ensureDir(this.globalStorageUri.fsPath)
      await fs.writeFile(this.getSessionTokenPath(), token)
    } else {
      delete axios.defaults.headers.common["Coder-Session-Token"]
      await fs.rm(this.getSessionTokenPath(), { force: true })
    }
  }

  public async getHeaders(url = this.getURL()): Promise<Record<string, string>> {
    return getHeaders(url, getHeaderCommand(vscode.workspace.getConfiguration()), this)
  }
}
