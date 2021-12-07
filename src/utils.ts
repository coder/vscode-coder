import * as unzip from "extract-zip"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as stream from "stream"
import * as tar from "tar-fs"
import * as vscode from "vscode"
import * as zlib from "zlib"

export const mediaDir = path.join(__filename, "..", "..", "media")

let _context: vscode.ExtensionContext | undefined

export const outputChannel = vscode.window.createOutputChannel("Coder")

export const debug = (line: string): void => {
  if (process.env.CODER_DEBUG) {
    outputChannel.appendLine(line)
  }
}

/**
 * Get or set the extension context.
 */
export const context = (ctx?: vscode.ExtensionContext): vscode.ExtensionContext => {
  if (ctx) {
    _context = ctx
  } else if (!_context) {
    throw new Error("Context has not been set; has the extension been activated?")
  }
  return _context
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

/**
 * Clean up a temporary directory.
 */
export const clean = async (name: string): Promise<void> => {
  const dir = path.join(os.tmpdir(), `coder/${name}`)
  await fs.promises.rmdir(dir, { recursive: true })
}

/**
 * Create a uniquely named temporary directory.
 */
export const tmpdir = async (name: string): Promise<string> => {
  const dir = path.join(os.tmpdir(), `coder/${name}`)
  await fs.promises.mkdir(dir, { recursive: true })
  return fs.promises.mkdtemp(path.join(dir, "tmp-"), { encoding: "utf8" })
}

/**
 * Extract the provided tar.gz stream into the provided directory.
 */
export const extractTar = async (response: stream.Readable, downloadPath: string): Promise<string> => {
  response.pause()

  await fs.promises.mkdir(downloadPath, { recursive: true })

  const decompress = zlib.createGunzip()
  response.pipe(decompress)
  response.on("error", (error) => decompress.destroy(error))

  const destination = tar.extract(downloadPath)
  decompress.pipe(destination)
  decompress.on("error", (error) => destination.destroy(error))

  await new Promise((resolve, reject) => {
    destination.on("error", reject)
    destination.on("finish", resolve)
    response.resume()
  })

  return downloadPath
}

/**
 * Extract the provided zip stream into the provided directory.
 */
export const extractZip = async (response: stream.Readable, downloadPath: string): Promise<string> => {
  // Zips cannot be extracted as a stream so we must download it temporarily.
  response.pause()

  await fs.promises.mkdir(downloadPath, { recursive: true })

  const temp = await tmpdir("zip-staging")
  const zipPath = path.join(temp, "archive.zip")
  const write = fs.createWriteStream(zipPath)
  response.pipe(write)
  response.on("error", (error) => write.destroy(error))

  await new Promise((resolve, reject) => {
    write.on("error", reject)
    write.on("finish", resolve)
    response.resume()
  })

  await unzip(zipPath, { dir: downloadPath })

  await clean("zip-staging")

  return downloadPath
}

/**
 * Get the target (platform and arch) for the current system.
 */
export const getTarget = (): string => {
  // Example binary names:
  //   coder-cli-darwin-amd64.zip
  //   coder-cli-linux-amd64.tar
  //   coder-cli-windows.zip

  // Windows releases do not include the arch.
  if (process.platform === "win32") {
    return "windows"
  }

  // Node uses x64/32 instead of amd64/32.
  let arch = process.arch
  switch (process.arch) {
    case "x64":
      arch = "amd64"
      break
    case "x32":
      arch = "amd32"
      break
  }

  return process.platform + "-" + arch
}

/**
 * Return the URL to fetch the Coder CLI archive.
 */
export const getAssetUrl = (version: string): string => {
  const assetFilename = "coder-cli-" + getTarget() + (process.platform === "linux" ? ".tar.gz" : ".zip")
  return version === "latest"
    ? `https://github.com/cdr/coder-cli/releases/${version}/download/${assetFilename}`
    : `https://github.com/cdr/coder-cli/releases/download/${version}/${assetFilename}`
}

/**
 * Get the first or only value from a query parameter.
 */
export const getQueryValue = (val: string[] | string | undefined): string | undefined => {
  return Array.isArray(val) ? val[0] : val
}
