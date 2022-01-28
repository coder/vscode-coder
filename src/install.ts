import * as cp from "child_process"
import * as path from "path"
import * as vscode from "vscode"
import { download } from "./download"
import { binaryExists, onLine, wrapExit } from "./exec"
import { outputChannel } from "./logs"

/**
 * Install the Coder CLI using the provided command.
 */
const installWithPkgManager = async (cmd: string, args: string[]): Promise<void> => {
  outputChannel.show()
  outputChannel.appendLine(cmd + " " + args.join(" "))

  const proc = cp.spawn(cmd, args)
  onLine(proc.stdout, outputChannel.appendLine.bind(outputChannel))
  onLine(proc.stderr, outputChannel.appendLine.bind(outputChannel))

  await wrapExit(proc)
}

/**
 * Inner function for `install` so it can wrap with a singleton promise.
 */
const doInstall = async (version: string, cmd: string): Promise<string> => {
  const actions: string[] = []

  // TODO: This will require sudo or we will need to install to a writable
  // location and ask the user to add it to their PATH if they have not already.
  const destination = "/usr/local/bin"
  // actions.push(`Install to ${destination}`)

  if (await binaryExists("brew")) {
    actions.push("Install with `brew`")
  }

  if (actions.length === 0) {
    throw new Error("No install options")
  }

  const action = await vscode.window.showInformationMessage(`"${cmd}" was not found in PATH.`, ...actions)
  if (!action) {
    throw new Error("Installation canceled")
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Installing Coder CLI`,
    },
    async () => {
      switch (action) {
        case `Install to ${destination}`:
          await download(version, path.join(destination, cmd))
          break
        case "Install with `brew`":
          await installWithPkgManager("brew", ["install", "cdr/coder/coder-cli@${version}"])
          break
      }
      return cmd
    },
  )
}

/** Only one request at a time. */
let promise: Promise<string> | undefined

/**
 * Ask the user whether to install the Coder CLI if not already installed then
 * return the invocation or path to the installed binary.  This function is safe
 * to call multiple times concurrently.
 *
 * @TODO Currently unused.  Should call after connecting to the workspace
 * although it might be fine to just keep using the downloaded version?
 */
export const install = async (version: string, cmd: string): Promise<string> => {
  if (!promise) {
    promise = (async (): Promise<string> => {
      try {
        return await doInstall(version, cmd)
      } finally {
        promise = undefined
      }
    })()
  }

  return promise
}
