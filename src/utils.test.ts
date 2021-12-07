import * as assert from "assert"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import * as utils from "./utils"

suite("Utils", () => {
  vscode.window.showInformationMessage("Start util tests.")

  suiteSetup(() => {
    // Cleanup anything left over from the last run.
    utils.clean("tests/utils")
  })

  test("split", () => {
    assert.deepStrictEqual(utils.split("foo/bar/baz", "/"), ["foo", "bar/baz"])
    assert.deepStrictEqual(utils.split("foo/", "/"), ["foo", ""])
    assert.deepStrictEqual(utils.split("foo", "/"), ["foo", ""])
  })

  test("extract", async () => {
    for (const ext of [".tar.gz", ".zip"]) {
      const temp = await utils.tmpdir("tests/utils")
      const stream = fs.createReadStream(path.resolve(__dirname, `../fixtures/archive${ext}`))

      await (ext === ".tar.gz" ? utils.extractTar(stream, temp) : utils.extractZip(stream, temp))

      const dest = path.join(temp, "archive-content")
      const content = await fs.promises.readFile(dest, "utf8")
      assert.strictEqual(content, "archive content\n")

      // Should be executable.
      assert.strictEqual(await fs.promises.access(dest, fs.constants.X_OK), undefined)

      // Test overwrite behavior.
      const stream2 = fs.createReadStream(path.resolve(__dirname, `../fixtures/archive${ext}`))
      await fs.promises.writeFile(dest, "not archive-content")

      await (ext === ".tar.gz" ? utils.extractTar(stream2, temp) : utils.extractZip(stream2, temp))
      const content2 = await fs.promises.readFile(dest, "utf8")
      assert.strictEqual(content2, "archive content\n")
    }
  })

  test("getQueryValue", () => {
    assert.strictEqual(utils.getQueryValue(undefined), undefined)
    assert.strictEqual(utils.getQueryValue("foo"), "foo")
    assert.strictEqual(utils.getQueryValue(["bar"]), "bar")
    assert.strictEqual(utils.getQueryValue(["bazzle", "qux"]), "bazzle")
  })
})