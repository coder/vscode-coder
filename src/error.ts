import * as vscode from "vscode"

export class CertificateError extends Error {
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

  // allowInsecure updates the value of the "coder.insecure" property.
  async allowInsecure(): Promise<void> {
    vscode.workspace.getConfiguration().update("coder.insecure", true, vscode.ConfigurationTarget.Global)
    vscode.window.showInformationMessage(CertificateError.InsecureMessage)
  }

  public async showNotification(): Promise<void> {
    const value = await vscode.window.showErrorMessage(
      CertificateError.Notification,
      CertificateError.ActionAllowInsecure,
      CertificateError.ActionViewMoreDetails,
    )
    if (value === CertificateError.ActionViewMoreDetails) {
      await this.viewMoreDetails()
      return
    }
    if (value === CertificateError.ActionAllowInsecure) {
      return this.allowInsecure()
    }
  }
}
