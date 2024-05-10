import { isAxiosError } from "axios"
import { isApiError, isApiErrorResponse } from "coder/site/src/api/errors"
import * as forge from "node-forge"
import * as tls from "tls"
import * as vscode from "vscode"

// X509_ERR_CODE represents error codes as returned from BoringSSL/OpenSSL.
export enum X509_ERR_CODE {
  UNABLE_TO_VERIFY_LEAF_SIGNATURE = "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  DEPTH_ZERO_SELF_SIGNED_CERT = "DEPTH_ZERO_SELF_SIGNED_CERT",
  SELF_SIGNED_CERT_IN_CHAIN = "SELF_SIGNED_CERT_IN_CHAIN",
}

// X509_ERR contains human-friendly versions of TLS errors.
export enum X509_ERR {
  PARTIAL_CHAIN = "Your Coder deployment's certificate cannot be verified because a certificate is missing from its chain. To fix this your deployment's administrator must bundle the missing certificates.",
  // NON_SIGNING can be removed if BoringSSL is patched and the patch makes it
  // into the version of Electron used by VS Code.
  NON_SIGNING = "Your Coder deployment's certificate is not marked as being capable of signing. VS Code uses a version of Electron that does not support certificates like this even if they are self-issued. The certificate must be regenerated with the certificate signing capability.",
  UNTRUSTED_LEAF = "Your Coder deployment's certificate does not appear to be trusted by this system. The certificate must be added to this system's trust store.",
  UNTRUSTED_CHAIN = "Your Coder deployment's certificate chain does not appear to be trusted by this system. The root of the certificate chain must be added to this system's trust store. ",
}

export interface Logger {
  writeToCoderOutputChannel(message: string): void
}

interface KeyUsage {
  keyCertSign: boolean
}

export class CertificateError extends Error {
  public static ActionAllowInsecure = "Allow Insecure"
  public static ActionOK = "OK"
  public static InsecureMessage =
    'The Coder extension will no longer verify TLS on HTTPS requests. You can change this at any time with the "coder.insecure" property in your VS Code settings.'

  private constructor(
    message: string,
    public readonly x509Err?: X509_ERR,
  ) {
    super("Secure connection to your Coder deployment failed: " + message)
  }

  // maybeWrap returns a CertificateError if the code is a certificate error
  // otherwise it returns the original error.
  static async maybeWrap<T>(err: T, address: string, logger: Logger): Promise<CertificateError | T> {
    if (isAxiosError(err)) {
      switch (err.code) {
        case X509_ERR_CODE.UNABLE_TO_VERIFY_LEAF_SIGNATURE:
          // "Unable to verify" can mean different things so we will attempt to
          // parse the certificate and determine which it is.
          try {
            const cause = await CertificateError.determineVerifyErrorCause(address)
            return new CertificateError(err.message, cause)
          } catch (error) {
            logger.writeToCoderOutputChannel(`Failed to parse certificate from ${address}: ${error}`)
            break
          }
        case X509_ERR_CODE.DEPTH_ZERO_SELF_SIGNED_CERT:
          return new CertificateError(err.message, X509_ERR.UNTRUSTED_LEAF)
        case X509_ERR_CODE.SELF_SIGNED_CERT_IN_CHAIN:
          return new CertificateError(err.message, X509_ERR.UNTRUSTED_CHAIN)
      }
    }
    return err
  }

  // determineVerifyErrorCause fetches the certificate(s) from the specified
  // address, parses the leaf, and returns the reason the certificate is giving
  // an "unable to verify" error or throws if unable to figure it out.
  static async determineVerifyErrorCause(address: string): Promise<X509_ERR> {
    return new Promise((resolve, reject) => {
      try {
        const url = new URL(address)
        const socket = tls.connect(
          {
            port: parseInt(url.port, 10) || 443,
            host: url.hostname,
            rejectUnauthorized: false,
          },
          () => {
            const x509 = socket.getPeerX509Certificate()
            socket.destroy()
            if (!x509) {
              throw new Error("no peer certificate")
            }

            // We use node-forge for two reasons:
            // 1. Node/Electron only provide extended key usage.
            // 2. Electron's checkIssued() will fail because it suffers from same
            //    the key usage bug that we are trying to work around here in the
            //    first place.
            const cert = forge.pki.certificateFromPem(x509.toString())
            if (!cert.issued(cert)) {
              return resolve(X509_ERR.PARTIAL_CHAIN)
            }

            // The key usage needs to exist but not have cert signing to fail.
            const keyUsage = cert.getExtension({ name: "keyUsage" }) as KeyUsage | undefined
            if (keyUsage && !keyUsage.keyCertSign) {
              return resolve(X509_ERR.NON_SIGNING)
            } else {
              // This branch is currently untested; it does not appear possible to
              // get the error "unable to verify" with a self-signed certificate
              // unless the key usage was the issue since it would have errored
              // with "self-signed certificate" instead.
              return resolve(X509_ERR.UNTRUSTED_LEAF)
            }
          },
        )
        socket.on("error", reject)
      } catch (error) {
        reject(error)
      }
    })
  }

  // allowInsecure updates the value of the "coder.insecure" property.
  async allowInsecure(): Promise<void> {
    vscode.workspace.getConfiguration().update("coder.insecure", true, vscode.ConfigurationTarget.Global)
    vscode.window.showInformationMessage(CertificateError.InsecureMessage)
  }

  async showModal(title: string): Promise<void> {
    return this.showNotification(title, {
      detail: this.x509Err || this.message,
      modal: true,
      useCustom: true,
    })
  }

  async showNotification(title?: string, options: vscode.MessageOptions = {}): Promise<void> {
    const val = await vscode.window.showErrorMessage(
      title || this.x509Err || this.message,
      options,
      // TODO: The insecure setting does not seem to work, even though it
      // should, as proven by the tests.  Even hardcoding rejectUnauthorized to
      // false does not work; something seems to just be different when ran
      // inside VS Code.  Disabling the "Strict SSL" setting does not help
      // either.  For now avoid showing the button until this is sorted.
      // CertificateError.ActionAllowInsecure,
      CertificateError.ActionOK,
    )
    switch (val) {
      case CertificateError.ActionOK:
        return
      case CertificateError.ActionAllowInsecure:
        await this.allowInsecure()
        return
    }
  }
}

// getErrorDetail is copied from coder/site, but changes the default return.
export const getErrorDetail = (error: unknown): string | undefined | null => {
  if (isApiError(error)) {
    return error.response.data.detail
  }
  if (isApiErrorResponse(error)) {
    return error.detail
  }
  return null
}
