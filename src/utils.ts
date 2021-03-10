import * as path from "path"
import * as cp from "child_process"
import * as vscode from "vscode"
import * as nodeWhich from "which"

export const mediaDir = path.join(__filename, "..", "..", "media")

export const exec = async (command: string): Promise<string> => {
  return new Promise((res, rej) => {
    cp.exec(command, (err, stdout) => (err ? rej(err) : res(stdout)))
  })
}

export const execCombined = async (command: string): Promise<{ stderr: string; stdout: string }> => {
  return new Promise((res, rej) => {
    cp.exec(command, (err, stdout, stderr) => (err ? rej(err) : res({ stderr, stdout })))
  })
}

export const execJSON = async <T>(command: string): Promise<T> => {
  const output = await exec(command)
  return JSON.parse(output)
}

// binaryExists returns "true" if the binary is found in $PATH
export const binaryExists = async (bin: string): Promise<boolean> => {
  return new Promise((res) => {
    nodeWhich(bin, (err) => res(!err))
  })
}

export const bubbleError = (f: () => void) => {
  try {
    f()
  } catch (e) {
    vscode.window.showErrorMessage(JSON.stringify(e))
  }
}
