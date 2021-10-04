import * as assert from "assert"
import * as vscode from "vscode"
import * as utils from "./utils"

suite("Utils", () => {
  vscode.window.showInformationMessage("Start util tests.")

  test("exec", async () => {
    assert.strictEqual(await utils.exec("printf test"), "test")
  })
})
