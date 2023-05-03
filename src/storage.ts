import axios from "axios"
import { execFile } from "child_process"
import { getBuildInfo } from "coder/site/src/api/api"
import { Workspace } from "coder/site/src/api/typesGenerated"
import * as crypto from "crypto"
import { createReadStream, createWriteStream } from "fs"
import fs from "fs/promises"
import { ensureDir } from "fs-extra"
import { IncomingMessage } from "http"
import os from "os"
import path from "path"
import prettyBytes from "pretty-bytes"
import * as vscode from "vscode"

export class Storage {
  public workspace?: Workspace

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly memento: vscode.Memento,
    private readonly secrets: vscode.SecretStorage,
    private readonly globalStorageUri: vscode.Uri,
    private readonly logUri: vscode.Uri,
  ) {}

  // init ensures that the storage places values in the
  // appropriate default values.
  public async init(): Promise<void> {
    await this.updateURL()
    await this.updateSessionToken()
  }

  public setURL(url?: string): Thenable<void> {
    return this.memento.update("url", url).then(() => {
      return this.updateURL()
    })
  }

  public getURL(): string | undefined {
    return this.memento.get("url")
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

  // fetchBinary returns the path to a Coder binary.
  // The binary will be cached if a matching server version already exists.
  public async fetchBinary(): Promise<string | undefined> {
    await this.cleanUpOldBinaries()
    const baseURL = this.getURL()
    if (!baseURL) {
      throw new Error("Must be logged in!")
    }
    const baseURI = vscode.Uri.parse(baseURL)

    const buildInfo = await getBuildInfo()
    const binPath = this.binaryPath()
    const exists = await this.checkBinaryExists(binPath)
    const os = goos()
    const arch = goarch()
    let binName = `coder-${os}-${arch}`
    // Windows binaries have an exe suffix!
    if (goos() === "windows") {
      binName += ".exe"
    }
    const controller = new AbortController()

    if (exists) {
      this.output.appendLine(`Found existing binary: ${binPath}`)
      const valid = await this.checkBinaryValid(binPath)
      if (!valid) {
        const removed = await this.rmBinary(binPath)
        if (!removed) {
          vscode.window.showErrorMessage("Failed to remove existing binary!")
          return undefined
        }
      }
    }
    let etag = ""
    if (exists) {
      etag = await this.getBinaryETag()
    }
    this.output.appendLine(`Using binName: ${binName}`)
    this.output.appendLine(`Using binPath: ${binPath}`)
    this.output.appendLine(`Using ETag: ${etag}`)

    const resp = await axios.get("/bin/" + binName, {
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
    this.output.appendLine("Response status code: " + resp.status)

    switch (resp.status) {
      case 200: {
        const contentLength = Number.parseInt(resp.headers["content-length"])

        // Ensure the binary directory exists!
        await fs.mkdir(path.dirname(binPath), { recursive: true })
        const tempFile = binPath + ".temp-" + Math.random().toString(36).substring(8)

        const completed = await vscode.window.withProgress<boolean>(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Downloading the latest binary (${buildInfo.version} from ${baseURI.authority})`,
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

            let contentLengthPretty = ""
            // Reverse proxies might not always send a content length!
            if (!Number.isNaN(contentLength)) {
              contentLengthPretty = " / " + prettyBytes(contentLength)
            }

            const writeStream = createWriteStream(tempFile, {
              autoClose: true,
              mode: 0o755,
            })
            let written = 0
            readStream.on("data", (buffer: Buffer) => {
              writeStream.write(buffer, () => {
                written += buffer.byteLength
                progress.report({
                  message: `${prettyBytes(written)}${contentLengthPretty}`,
                  increment: (buffer.byteLength / contentLength) * 100,
                })
              })
            })
            try {
              await new Promise<void>((resolve, reject) => {
                readStream.on("error", (err) => {
                  reject(err)
                })
                readStream.on("close", () => {
                  if (cancelled) {
                    return reject()
                  }
                  writeStream.close()
                  resolve()
                })
              })
              return true
            } catch (ex) {
              return false
            }
          },
        )
        if (!completed) {
          return
        }
        this.output.appendLine(`Downloaded binary: ${binPath}`)
        if (exists) {
          const oldBinPath = binPath + ".old-" + Math.random().toString(36).substring(8)
          await fs.rename(binPath, oldBinPath).catch(() => {
            this.output.appendLine(`Warning: failed to rename ${binPath} to ${oldBinPath}`)
          })
          await fs.rm(oldBinPath, { force: true }).catch((error) => {
            this.output.appendLine(`Warning: failed to remove old binary: ${error}`)
          })
        }
        await fs.mkdir(path.dirname(binPath), { recursive: true })
        await fs.rename(tempFile, binPath)

        return binPath
      }
      case 304: {
        this.output.appendLine(`Using cached binary: ${binPath}`)
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
            const params = new URLSearchParams({
              title: `Support the \`${os}-${arch}\` platform`,
              body: `I'd like to use the \`${os}-${arch}\` architecture with the VS Code extension.`,
            })
            const uri = vscode.Uri.parse(`https://github.com/coder/vscode-coder/issues/new?` + params.toString())
            vscode.env.openExternal(uri)
          })
        return undefined
      }
      default: {
        vscode.window
          .showErrorMessage("Failed to download binary. Please open an issue.", "Open an Issue")
          .then((value) => {
            if (!value) {
              return
            }
            const params = new URLSearchParams({
              title: `Failed to download binary on \`${os}-${arch}\``,
              body: `Received status code \`${resp.status}\` when downloading the binary.`,
            })
            const uri = vscode.Uri.parse(`https://github.com/coder/vscode-coder/issues/new?` + params.toString())
            vscode.env.openExternal(uri)
          })
        return undefined
      }
    }
  }

  // getBinaryCachePath returns the path where binaries are cached.
  // The caller must ensure it exists before use.
  public getBinaryCachePath(): string {
    return path.join(this.globalStorageUri.fsPath, "bin")
  }

  // getNetworkInfoPath returns the path where network information
  // for SSH hosts is stored.
  public getNetworkInfoPath(): string {
    return path.join(this.globalStorageUri.fsPath, "net")
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

  public getBinaryETag(): Promise<string> {
    const hash = crypto.createHash("sha1")
    const stream = createReadStream(this.binaryPath())
    return new Promise((resolve, reject) => {
      stream.on("end", () => {
        hash.end()
        resolve(hash.digest("hex"))
      })
      stream.on("error", (err) => {
        reject(err)
      })
      stream.on("data", (chunk) => {
        hash.update(chunk)
      })
    })
  }

  private async updateURL(): Promise<void> {
    const url = this.getURL()
    axios.defaults.baseURL = url
    if (url) {
      await ensureDir(this.globalStorageUri.fsPath)
      await fs.writeFile(this.getURLPath(), url)
    } else {
      await fs.rm(this.getURLPath(), { force: true })
    }
  }

  private async cleanUpOldBinaries(): Promise<void> {
    const binPath = this.binaryPath()
    const binDir = path.dirname(binPath)
    await fs.mkdir(binDir, { recursive: true })
    const files = await fs.readdir(binDir)
    for (const file of files) {
      const fileName = path.basename(file)
      if (fileName.includes(".old-")) {
        try {
          await fs.rm(path.join(binDir, file), { force: true })
        } catch (error) {
          this.output.appendLine(`Warning: failed to remove ${fileName}. Error: ${error}`)
        }
      }
    }
  }

  private binaryPath(): string {
    const os = goos()
    const arch = goarch()
    let binPath = path.join(this.getBinaryCachePath(), `coder-${os}-${arch}`)
    if (os === "windows") {
      binPath += ".exe"
    }
    return binPath
  }

  private async checkBinaryExists(binPath: string): Promise<boolean> {
    return await fs
      .stat(binPath)
      .then(() => true)
      .catch(() => false)
  }

  private async rmBinary(binPath: string): Promise<boolean> {
    return await fs
      .rm(binPath, { force: true })
      .then(() => true)
      .catch(() => false)
  }

  private async checkBinaryValid(binPath: string): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      try {
        execFile(binPath, ["version"], (err) => {
          if (err) {
            this.output.appendLine("Check for binary corruption: " + err)
          }
          resolve(err === null)
        })
      } catch (ex) {
        this.output.appendLine("The cached binary cannot be executed: " + ex)
        resolve(false)
      }
    })
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
}

// goos returns the Go format for the current platform.
// Coder binaries are created in Go, so we conform to that name structure.
const goos = (): string => {
  const platform = os.platform()
  switch (platform) {
    case "win32":
      return "windows"
    default:
      return platform
  }
}

// goarch returns the Go format for the current architecture.
const goarch = (): string => {
  const arch = os.arch()
  switch (arch) {
    case "arm":
      return "armv7"
    case "x64":
      return "amd64"
    default:
      return arch
  }
}
