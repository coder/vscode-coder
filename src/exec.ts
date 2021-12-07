import * as cp from "child_process"
import * as path from "path"
import * as stream from "stream"
import { promisify } from "util"
import * as nodeWhich from "which"
import { download } from "./download"
import { context, debug } from "./utils"

/**
 * How to invoke the Coder CLI.
 *
 * The CODER_BINARY environment variable is meant for tests.
 */
export const coderInvocation = (): { cmd: string; args: string[] } => {
  if (process.env.CODER_BINARY) {
    return JSON.parse(process.env.CODER_BINARY)
  }
  return { cmd: process.platform === "win32" ? "coder.exe" : "coder", args: [] }
}

/**
 * Options for installing and authenticating the Coder CLI.
 */
export interface CoderOptions {
  accessUri?: string
  token?: string
  version?: string
}

/**
 * Run a command with the Coder CLI after making sure it is installed and
 * authenticated.  On success stdout is returned.  On failure the error will
 * include stderr in the message.
 */
export const execCoder = async (command: string, opts?: CoderOptions): Promise<string> => {
  debug(`Run command: ${command}`)

  const invocation = coderInvocation()
  const cmd = (await binaryExists(invocation.cmd))
    ? [invocation.cmd, ...invocation.args].join(" ")
    : await download(opts?.version || "latest", path.join(await context().globalStoragePath, invocation.cmd))

  const output = await promisify(cp.exec)(cmd + " " + command)
  return output.stdout
}

/**
 * Return "true" if the binary is found in $PATH.
 */
export const binaryExists = async (bin: string): Promise<boolean> => {
  return new Promise((res) => {
    nodeWhich(bin, (err) => res(!err))
  })
}

/**
 * Split a stream on newlines.
 *
 * Use in conjunction with `child_process.spawn()` for long-running process that
 * you want to log as they output.
 *
 * The callback will always fire at least once (even with just a blank string)
 * even if the process has no output.
 *
 * This will set the encoding on the stream to utf8.
 */
export const onLine = (stream: stream.Readable, callback: (line: string) => void): void => {
  let buffer = ""
  stream.setEncoding("utf8")
  stream.on("data", (d) => {
    const data = buffer + d
    const split = data.split("\n")
    const last = split.length - 1

    for (let i = 0; i < last; ++i) {
      callback(split[i])
    }

    // The last item will either be an empty string (the data ended with a
    // newline) or a partial line (did not end with a newline) and we must wait
    // to parse it until we get a full line.
    buffer = split[last]
  })
  // If the stream ends send whatever we have left.
  stream.on("end", () => callback(buffer))
}

/**
 * Wrap a promise around a spawned process's exit.  Rejects if the code is
 * non-zero.  The error will include the code and the stderr if any in the
 * message.
 *
 * Use in conjunction with `child_process.spawn()`.
 */
export function wrapExit(proc: cp.ChildProcess): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stderr: string[] = []
    proc.stderr?.on("data", (d) => stderr.push(d.toString()))
    proc.on("error", reject) // Catches ENOENT for example.
    proc.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        const details = stderr.length > 0 ? `: ${stderr.join()}` : ""
        reject(new Error(`Command "${proc.spawnfile}" failed with code ${code}${details}`))
      }
    })
  })
}
