import * as assert from "assert"
import { promises as fs } from "fs"
import * as path from "path"
import * as vscode from "vscode"
import * as auth from "./auth"
import * as utils from "./utils"

suite("Authenticate", () => {
  vscode.window.showInformationMessage("Start authenticate tests.")

  const tmpPath = "tests/auth"
  suiteSetup(async () => {
    // Cleanup anything left over from the last run.
    await utils.clean(tmpPath)
  })

  teardown(() => utils.resetEnv())

  const assertDirs = (dir: string) => {
    assert.match(auth.getConfigDir("linux"), new RegExp(path.join(dir, ".config$")))
    assert.match(auth.getConfigDir("freebsd"), new RegExp(path.join(dir, ".config$")))
    assert.match(auth.getConfigDir("win32"), new RegExp(path.join(dir, "AppData/Roaming$")))
    assert.match(auth.getConfigDir("darwin"), new RegExp(path.join(dir, "Library/Application Support$")))
  }

  test("getConfigDir", async () => {
    // Make sure local config mocks work.
    const tmpDir = await utils.tmpdir(tmpPath)
    utils.setEnv("HOME", tmpDir)
    assertDirs(tmpDir)

    // Make sure the global mock also works.  For example the Linux temp config
    // directory looks like: /tmp/coder/tests/config/tmp-Dzfqwl/home/.config
    // This runs after the local mock to make sure environment variables are
    // being restored correctly.
    utils.resetEnv()
    assertDirs("tests/config/.+/home")
  })

  test("currentUri", async () => {
    const tmpDir = await utils.tmpdir(tmpPath)
    utils.setEnv("HOME", tmpDir)

    const accessUri = "https://coder-workspaces-test"
    assert.strictEqual(await auth.currentUri(), undefined)
    const dir = path.join(auth.getConfigDir(), "coder")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "url"), accessUri)
    assert.strictEqual(await auth.currentUri(), accessUri)
  })
})
