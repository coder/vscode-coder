import * as assert from "assert"
import * as vscode from "vscode"
import * as download from "./download"

suite("Download", () => {
  vscode.window.showInformationMessage("Start download tests.")

  teardown(() => {
    delete process.env.CODER_MOCK_STATE
  })

  test("binaryExists", async () => {
    assert.strictEqual(await download.binaryExists("sh"), true)
    assert.strictEqual(await download.binaryExists("surely-no-binary-named-like-this-exists"), false)
  })

  test("execCoder", async () => {
    assert.strictEqual(await download.execCoder("--help"), "help\n")

    // This will attempt to authenticate first, which will fail.
    process.env.CODER_MOCK_STATE = "fail"
    await assert.rejects(download.execCoder("--help"), {
      name: "Error",
      message: /Command failed: .+ --help\nstderr message from fail state\n/,
    })
  })

  test("install", async () => {
    await assert.rejects(download.install("false", []), {
      name: "Error",
      message: `Command "false" failed with code 1`,
    })
    // TODO: Test successful download.
  })

  // TODO: Implement.
  test("maybeInstall")
  test("download")
  test("maybeDownload")
})
