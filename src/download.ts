import * as cp from "child_process"
import { promises as fs } from "fs"
import * as path from "path"
import * as vscode from "vscode"
import * as nodeWhich from "which"
import { requestResponse } from "./request"
import { context, debug, exec, extractTar, extractZip, getAssetUrl, onLine, outputChannel, wrapExit } from "./utils"

/**
 * Return "true" if the binary is found in $PATH.
 */
export const binaryExists = async (bin: string): Promise<boolean> => {
  return new Promise((res) => {
    nodeWhich(bin, (err) => res(!err))
  })
}

/**
 * Run a command with the Coder CLI after making sure it is installed. Stderr is
 * ignored; only stdout is returned.
 */
export const execCoder = async (command: string): Promise<string> => {
  debug(`Run command: ${command}`)
  const coderBinary = await preflight()
  const output = await exec(coderBinary + " " + command)
  return output.stdout
}

/**
 * How to invoke the Coder CLI.
 *
 * The CODER_BINARY environment variable is meant for tests.
 */
const coderInvocation = (): { cmd: string; args: string[] } => {
  if (process.env.CODER_BINARY) {
    return JSON.parse(process.env.CODER_BINARY)
  }
  return { cmd: process.platform === "win32" ? "coder.exe" : "coder", args: [] }
}

/** Only one preflight request at a time. */
let _preflight: Promise<string> | undefined

/**
 * Download the Coder CLI to the provided location and return that location.
 */
export const download = async (version: string, downloadPath: string): Promise<string> => {
  const assetUrl = getAssetUrl(version)
  const response = await requestResponse(assetUrl)

  await (assetUrl.endsWith(".tar.gz")
    ? extractTar(response, path.dirname(downloadPath))
    : extractZip(response, path.dirname(downloadPath)))

  return downloadPath
}

/**
 * Download the Coder CLI if necessary to a temporary location and return that
 * location.  If it has already been downloaded it will be reused without regard
 * to its version (it can be updated to match later).
 */
export const maybeDownload = async (version = "latest"): Promise<string> => {
  const invocation = coderInvocation()
  if (await binaryExists(invocation.cmd)) {
    debug(`  - Found "${invocation.cmd}" on PATH`)
    return [invocation.cmd, ...invocation.args].join(" ")
  }

  // See if we already downloaded it.
  const downloadPath = path.join(await context().globalStoragePath, invocation.cmd)
  try {
    await fs.access(downloadPath)
    debug(`  - Using previously downloaded "${invocation.cmd}"`)
    return downloadPath
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      throw error
    }
  }

  debug(`  - Downloading "${invocation.cmd}" ${version}`)
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Installing Coder CLI ${version}`,
    },
    () => download(version, downloadPath),
  )
}

/**
 * Download then copy the Coder CLI to the specified location.
 */
export const downloadAndInstall = async (version: string, destination: string): Promise<void> => {
  const source = await maybeDownload(version)
  await fs.mkdir(destination, { recursive: true })
  await fs.rename(source, path.join(destination, "coder"))
}

/**
 * Install the Coder CLI using the provided command.
 */
export const install = async (cmd: string, args: string[]): Promise<void> => {
  outputChannel.show()
  outputChannel.appendLine(cmd + " " + args.join(" "))

  const proc = cp.spawn(cmd, args)
  onLine(proc.stdout, outputChannel.appendLine.bind(outputChannel))
  onLine(proc.stderr, outputChannel.appendLine.bind(outputChannel))

  try {
    await wrapExit(proc)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    outputChannel.appendLine(error.message)
    throw error
  }
}

/**
 * Ask the user whether to install the Coder CLI if not already installed.
 *
 * Return the invocation for the binary for use with `cp.exec()`.
 *
 * @TODO Currently unused.  Should call after connecting to the workspace
 * although it might be fine to just keep using the downloaded version?
 */
export const maybeInstall = async (version: string): Promise<string> => {
  const invocation = coderInvocation()
  if (await binaryExists(invocation.cmd)) {
    return [invocation.cmd, ...invocation.args].join(" ")
  }

  const actions: string[] = []

  // TODO: This will require sudo or we will need to install to a writable
  // location and ask the user to add it to their PATH if they have not already.
  const destination = "/usr/local/bin"
  // actions.push(`Install to ${destination}`)

  if (await binaryExists("brew")) {
    actions.push("Install with `brew`")
  }

  if (actions.length === 0) {
    throw new Error(`"${invocation.cmd}" not found in $PATH.`)
  }

  const action = await vscode.window.showInformationMessage(`"${invocation.cmd}" was not found in $PATH.`, ...actions)
  if (!action) {
    throw new Error(`"${invocation.cmd}" not found in $PATH.`)
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Installing Coder CLI`,
    },
    async () => {
      switch (action) {
        case `Install to ${destination}`:
          return downloadAndInstall(version, destination)
        case "Install with `brew`":
          return install("brew", ["install", "cdr/coder/coder-cli@${version}"])
      }
    },
  )

  // See if we can now find it via the path.
  if (await binaryExists(invocation.cmd)) {
    return [invocation.cmd, ...invocation.args].join(" ")
  } else {
    throw new Error(`"${invocation.cmd}" still not found in $PATH.`)
  }
}

/**
 * Check that Coder is installed and authenticated.  If not try installing and
 * authenticating.
 *
 * Return the appropriate invocation for the binary.
 *
 * @TODO Implement authentication portion.
 */
export const preflight = async (version = "latest"): Promise<string> => {
  if (!_preflight) {
    _preflight = (async (): Promise<string> => {
      try {
        return await maybeDownload(version)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        throw new Error(`${error.message}. Please [install manually](https://coder.com/docs/cli/installation).`)
      } finally {
        // Clear after completion so we can try again in the case of errors, if
        // the binary is removed, etc.
        _preflight = undefined
      }
    })()
  }

  return _preflight
}
