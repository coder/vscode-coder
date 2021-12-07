import * as cp from "child_process"
import * as path from "path"
import * as stream from "stream"
import { promisify } from "util"
import * as nodeWhich from "which"
import { authenticate } from "./auth"
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
  let coderBinary = [invocation.cmd, ...invocation.args].join(" ")

  try {
    if (!(await binaryExists(invocation.cmd))) {
      coderBinary = await download(
        opts?.version || "latest",
        path.join(await context().globalStoragePath, invocation.cmd),
      )
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    // Re-throw with some guidance on how to manually install.
    throw new Error(`${error.message.trim()}. Please [install manually](https://coder.com/docs/cli/installation).`)
  }

  try {
    const output = await promisify(cp.exec)(coderBinary + " " + command)
    return output.stdout
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    // See if the error appears to be related to the token or login.  If it does
    // we will try authenticating then run the command again.
    // TODO: Since this relies on stderr output being a certain way it might be
    // better if the CLI had a command for checking the login status.
    if (/Session-Token|credentials|API key|401/.test(error.stderr)) {
      await authenticate(opts?.accessUri, opts?.token)
      const output = await promisify(cp.exec)(coderBinary + " " + command)
      return output.stdout
    } else {
      // Otherwise it is some other kind of error, like the command does not
      // exist or the binary is gone, etc.
      throw error
    }
  }
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
