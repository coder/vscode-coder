import { promises as fs } from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { debug } from "./logs"
import { requestResponse } from "./request"
import { extractTar, extractZip, getAssetUrl } from "./utils"

/**
 * Inner function for `download` so it can wrap with a singleton promise.
 */
const doDownload = async (version: string, downloadPath: string): Promise<string> => {
  // See if we already downloaded it.
  try {
    await fs.access(downloadPath)
    debug(`  - Using previously downloaded: ${downloadPath}`)
    return downloadPath
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      throw error
    }
  }

  debug(`  - Downloading ${version} to ${downloadPath}`)
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Downloading Coder CLI ${version}`,
    },
    async () => {
      const assetUrl = getAssetUrl(version)
      const response = await requestResponse(assetUrl)

      await (assetUrl.endsWith(".tar.gz")
        ? extractTar(response, path.dirname(downloadPath))
        : extractZip(response, path.dirname(downloadPath)))

      return downloadPath
    },
  )
}

/** Only one request at a time. */
let promise: Promise<string> | undefined

/**
 * Download the Coder CLI if necessary to the provided location while showing a
 * progress bar then return that location.  If it has already been downloaded it
 * will be reused without regard to its version (it can be updated to match
 * later).  This function is safe to call multiple times concurrently.
 */
export const download = async (version: string, downloadPath: string): Promise<string> => {
  if (!promise) {
    promise = (async (): Promise<string> => {
      try {
        return await doDownload(version, downloadPath)
      } finally {
        promise = undefined
      }
    })()
  }

  return promise
}
