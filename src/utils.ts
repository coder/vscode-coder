import * as cp from "child_process"
import * as path from "path"
import * as nodeWhich from "which"

export const mediaDir = path.join(__filename, "..", "..", "media")

export const coderBinary = process.env.CODER_BINARY || "coder"

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

/**
 * Return "true" if the binary is found in $PATH.
 */
export const binaryExists = async (bin: string): Promise<boolean> => {
  return new Promise((res) => {
    nodeWhich(bin, (err) => res(!err))
  })
}

/**
 * Split a string up to the delimiter.  If the delimiter does not exist the
 * first item will have all the text and the second item will be an empty
 * string.
 */
export const split = (str: string, delimiter: string): [string, string] => {
  const index = str.indexOf(delimiter)
  return index !== -1 ? [str.substring(0, index).trim(), str.substring(index + 1)] : [str, ""]
}
