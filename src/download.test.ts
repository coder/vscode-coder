import * as assert from "assert"
import * as vscode from "vscode"
import * as download from "./download"

suite("Download", () => {
  vscode.window.showInformationMessage("Start download tests.")

  test("binaryExists", async () => {
    assert.strictEqual(await download.binaryExists("sh"), true)
    assert.strictEqual(await download.binaryExists("surely-no-binary-named-like-this-exists"), false)
  })

  test("execCoder", async () => {
    assert.strictEqual(await download.execCoder("test success"), "success\n")
    await assert.rejects(download.execCoder("test fail"), {
      name: "Error",
      message: /Command failed: .+ test fail/,
    })
  })

  test("install", async () => {
    await assert.rejects(download.install("false", []), {
      name: "Error",
      message: `Command "false" failed with code 1`,
    })
  })

  // TODO: Implement.
  test("maybeInstall")
  test("download")
  test("maybeDownload")
})
