import * as fs from "fs/promises"
import * as jsonc from "jsonc-parser"
import * as vscode from "vscode"
import { Storage } from "./storage"

export class SelfSignedCertificateError extends Error {
  public static Notification =
    "Your Coder deployment is using a self-signed certificate. VS Code uses a version of Electron that does not support registering self-signed intermediate certificates with extensions."
  public static ActionAllowInsecure = "Allow Insecure"
  public static ActionViewMoreDetails = "View More Details"

  constructor(message: string) {
    super(`Your Coder deployment is using a self-signed certificate: ${message}`)
  }

  public viewMoreDetails(): Thenable<boolean> {
    return vscode.env.openExternal(vscode.Uri.parse("https://github.com/coder/vscode-coder/issues/105"))
  }

  // allowInsecure manually reads the settings file and updates the value of the
  // "coder.insecure" property.
  public async allowInsecure(storage: Storage): Promise<void> {
    let settingsContent = "{}"
    try {
      settingsContent = await fs.readFile(storage.getUserSettingsPath(), "utf8")
    } catch (ex) {
      // Ignore! It's probably because the file doesn't exist.
    }
    const edits = jsonc.modify(settingsContent, ["coder.insecure"], true, {})
    await fs.writeFile(storage.getUserSettingsPath(), jsonc.applyEdits(settingsContent, edits))

    vscode.window.showInformationMessage(
      'The Coder extension will no longer verify TLS on HTTPS requests. You can change this at any time with the "coder.insecure" property in your VS Code settings.',
    )
  }

  public async showInsecureNotification(storage: Storage): Promise<void> {
    const value = await vscode.window.showErrorMessage(
      SelfSignedCertificateError.Notification,
      SelfSignedCertificateError.ActionAllowInsecure,
      SelfSignedCertificateError.ActionViewMoreDetails,
    )
    if (value === SelfSignedCertificateError.ActionViewMoreDetails) {
      await this.viewMoreDetails()
      return
    }
    if (value === SelfSignedCertificateError.ActionAllowInsecure) {
      return this.allowInsecure(storage)
    }
  }
}
