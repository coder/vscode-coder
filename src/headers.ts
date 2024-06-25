import * as cp from "child_process"
import * as util from "util"

import { WorkspaceConfiguration } from "vscode"

export interface Logger {
  writeToCoderOutputChannel(message: string): void
}

interface ExecException {
  code?: number
  stderr?: string
  stdout?: string
}

function isExecException(err: unknown): err is ExecException {
  return typeof (err as ExecException).code !== "undefined"
}

export function getHeaderCommand(config: WorkspaceConfiguration): string | undefined {
  const cmd = config.get("coder.headerCommand") || process.env.CODER_HEADER_COMMAND
  if (!cmd || typeof cmd !== "string") {
    return undefined
  }
  return cmd
}

// TODO: getHeaders might make more sense to directly implement on Storage
// but it is difficult to test Storage right now since we use vitest instead of
// the standard extension testing framework which would give us access to vscode
// APIs.  We should revert the testing framework then consider moving this.

// getHeaders executes the header command and parses the headers from stdout.
// Both stdout and stderr are logged on error but stderr is otherwise ignored.
// Throws an error if the process exits with non-zero or the JSON is invalid.
// Returns undefined if there is no header command set.  No effort is made to
// validate the JSON other than making sure it can be parsed.
export async function getHeaders(
  url: string | undefined,
  command: string | undefined,
  logger: Logger,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {}
  if (typeof url === "string" && url.trim().length > 0 && typeof command === "string" && command.trim().length > 0) {
    let result: { stdout: string; stderr: string }
    try {
      result = await util.promisify(cp.exec)(command, {
        env: {
          ...process.env,
          CODER_URL: url,
        },
      })
    } catch (error) {
      if (isExecException(error)) {
        logger.writeToCoderOutputChannel(`Header command exited unexpectedly with code ${error.code}`)
        logger.writeToCoderOutputChannel(`stdout: ${error.stdout}`)
        logger.writeToCoderOutputChannel(`stderr: ${error.stderr}`)
        throw new Error(`Header command exited unexpectedly with code ${error.code}`)
      }
      throw new Error(`Header command exited unexpectedly: ${error}`)
    }
    if (!result.stdout) {
      // Allow no output for parity with the Coder CLI.
      return headers
    }
    const lines = result.stdout.replace(/\r?\n$/, "").split(/\r?\n/)
    for (let i = 0; i < lines.length; ++i) {
      const [key, value] = lines[i].split(/=(.*)/)
      // Header names cannot be blank or contain whitespace and the Coder CLI
      // requires that there be an equals sign (the value can be blank though).
      if (key.length === 0 || key.indexOf(" ") !== -1 || typeof value === "undefined") {
        throw new Error(`Malformed line from header command: [${lines[i]}] (out: ${result.stdout})`)
      }
      headers[key] = value
    }
  }
  return headers
}
