import { promises as fs } from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { debug } from "./utils"

const getConfigDir = (): string => {
  // The CLI uses localConfig from https://github.com/kirsle/configdir.
  switch (process.platform) {
    case "win32":
      return process.env.APPDATA || path.join(os.homedir(), "AppData/Roaming")
    case "darwin":
      return path.join(os.homedir(), "Library/Application Support")
    case "linux":
      return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  }
  throw new Error(`Unsupported platform ${process.platform}`)
}

/**
 * Authenticate the Coder CLI.
 */
const doAuthenticate = async (accessUrl?: string, token?: string): Promise<void> => {
  if (!accessUrl) {
    debug(`  - No access URL, querying user`)
    accessUrl = await vscode.window.showInputBox({
      prompt: "Coder URL",
      placeHolder: "https://my.coder.domain",
    })
    if (!accessUrl) {
      throw new Error("Unable to authenticate; no access URL was provided")
    }
  }

  // TODO: This step can be automated if we make the internal-auth endpoint
  // automatically open another VS Code URI.
  if (!token) {
    debug(`  - No token, querying user`)
    const url = vscode.Uri.parse(`${accessUrl}/internal-auth?show_token=true`)
    const opened = await vscode.env.openExternal(url)
    debug(`  - Opened ${url}: ${opened}`)
    token = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      placeHolder: "Paste your token here",
      prompt: `Token from ${url.toString(true)}`,
    })
    if (!token) {
      throw new Error("Unable to authenticate; no token was provided")
    }
  }

  // TODO: Using the login command would be ideal but it unconditionally opens a
  // browser.  To work around this write to the config files directly.  We
  // cannot use the env-paths module because the library the CLI is using
  // implements both Windows and macOS paths differently.
  const dir = path.join(getConfigDir(), "coder")
  await fs.mkdir(dir, { recursive: true })
  await Promise.all([fs.writeFile(path.join(dir, "session"), token), fs.writeFile(path.join(dir, "url"), accessUrl)])
}

/** Only allow one at a time. */
let promise: Promise<void> | undefined

export const authenticate = async (accessUrl?: string, token?: string): Promise<void> => {
  if (!promise) {
    promise = (async (): Promise<void> => {
      try {
        return await doAuthenticate(accessUrl, token)
      } finally {
        promise = undefined
      }
    })()
  }

  return promise
}
