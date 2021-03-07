import * as path from "path"
import * as cp from "child_process"
import * as vscode from "vscode"

export const mediaDir = path.join(__filename, "..", "..", "media")

export const exec = async (command: string): Promise<string> => {
  return new Promise((res, rej) => {
    cp.exec(command, (err, stdout) => (err ? rej(err) : res(stdout)))
  })
}

export const execJSON = async <T>(command: string): Promise<T> => {
  const output = await exec(command)
  return JSON.parse(output)
}

export const bubbleError = (f: () => void) => {
  try {
    f()
  } catch (e) {
    vscode.window.showErrorMessage(JSON.stringify(e))
  }
}
