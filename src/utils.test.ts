import * as assert from "assert"
import * as vscode from "vscode"
import * as utils from "./utils"

suite("Utils", () => {
  vscode.window.showInformationMessage("Start util tests.")

  test("exec", async () => {
    assert.strictEqual(await utils.exec("printf test"), "test")
    await assert.rejects(utils.exec("false"), {
      name: "Error",
      message: "Command failed: false\n",
    })
  })

  test("execCombined", async () => {
    assert.deepStrictEqual(await utils.execCombined("printf stdout"), {
      stdout: "stdout",
      stderr: "",
    })
    assert.deepStrictEqual(await utils.execCombined(`>&2 printf stderr`), {
      stdout: "",
      stderr: "stderr",
    })
    await assert.rejects(utils.execCombined("false"), {
      name: "Error",
      message: "Command failed: false\n",
    })
  })

  test("execJSON", async () => {
    const obj = {
      foo: "bar",
      baz: "qux",
    }
    assert.deepStrictEqual(await utils.execJSON(`printf '${JSON.stringify(obj)}'`), obj)
    await assert.rejects(utils.execJSON(`printf 'invalid json'`), {
      name: "SyntaxError",
      message: "Unexpected token i in JSON at position 0",
    })
  })

  test("binaryExists", async () => {
    assert.strictEqual(await utils.binaryExists("sh"), true)
    assert.strictEqual(await utils.binaryExists("surely-no-binary-named-like-this-exists"), false)
  })

  test("split", () => {
    assert.deepStrictEqual(utils.split("foo/bar/baz", "/"), ["foo", "bar/baz"])
    assert.deepStrictEqual(utils.split("foo/", "/"), ["foo", ""])
    assert.deepStrictEqual(utils.split("foo", "/"), ["foo", ""])
  })
})
