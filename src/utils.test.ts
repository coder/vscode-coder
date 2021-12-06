import * as assert from "assert"
import * as cp from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import * as utils from "./utils"

suite("Utils", () => {
  vscode.window.showInformationMessage("Start util tests.")

  test("exec", async () => {
    assert.deepStrictEqual(await utils.exec("printf stdout"), {
      stdout: "stdout",
      stderr: "",
    })
    assert.deepStrictEqual(await utils.exec(">&2 printf stderr"), {
      stdout: "",
      stderr: "stderr",
    })
    await assert.rejects(utils.exec("false"), {
      name: "Error",
      message: "Command failed: false\n",
    })
  })

  suiteSetup(() => {
    // Cleanup anything left over from the last run.
    utils.clean("tests/utils")
  })

  test("split", () => {
    assert.deepStrictEqual(utils.split("foo/bar/baz", "/"), ["foo", "bar/baz"])
    assert.deepStrictEqual(utils.split("foo/", "/"), ["foo", ""])
    assert.deepStrictEqual(utils.split("foo", "/"), ["foo", ""])
  })

  test("onLine", async () => {
    // Try from zero to multiple lines.
    const lines = ["a", "b", "d", "e"]
    for (let i = 0; i < lines.length; ++i) {
      // Try both ending and not ending with a newline.
      for (const ending of ["\n", ""]) {
        const expected = lines.slice(0, i)
        if (ending === "\n" || i === 0) {
          expected.push("")
        }

        // Windows requires wrapping single quotes or the `\n` becomes just `n`.
        const arg = expected.join("\n")
        const proc = cp.spawn("printf", [process.platform === "win32" ? `'${arg}'` : arg])

        await new Promise<void>((resolve) => {
          utils.onLine(proc.stdout, (d) => {
            assert.strictEqual(d, expected.shift())
            if (expected.length === 0) {
              resolve()
            }
          })
        })
      }
    }
  })

  test("wrapExit", async () => {
    assert.deepStrictEqual(await utils.wrapExit(cp.spawn("printf", ["stdout"])), undefined)
    assert.deepStrictEqual(await utils.wrapExit(cp.spawn("bash", ["-c", ">&2 printf stderr"])), undefined)
    await assert.rejects(utils.wrapExit(cp.spawn("false")), {
      name: "Error",
      message: `Command "false" failed with code 1`,
    })
    await assert.rejects(utils.wrapExit(cp.spawn("surely-no-executable-named-like-this-exists")), {
      name: "Error",
      message: `spawn surely-no-executable-named-like-this-exists ENOENT`,
    })
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
})
