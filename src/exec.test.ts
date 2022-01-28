import * as assert from "assert"
import * as cp from "child_process"
import * as vscode from "vscode"
import * as exec from "./exec"
import * as utils from "./utils"

suite("Exec", () => {
  vscode.window.showInformationMessage("Start exec tests.")

  teardown(() => utils.resetEnv())

  test("execCoder", async () => {
    assert.strictEqual(await exec.execCoder("--help"), "help\n")

    // This will attempt to authenticate first, which will fail.
    utils.setEnv("CODER_MOCK_STATE", "fail")
    await assert.rejects(exec.execCoder("--help"), {
      name: "Error",
      message: /Command failed: .+ --help\nstderr message from fail state\n/,
    })

    // TODO: Test what happens when you are already logged in once we figure out
    // how to test notifications and user input.
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
          exec.onLine(proc.stdout, (d) => {
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
    assert.deepStrictEqual(await exec.wrapExit(cp.spawn("printf", ["stdout"])), undefined)
    assert.deepStrictEqual(await exec.wrapExit(cp.spawn("bash", ["-c", ">&2 printf stderr"])), undefined)
    await assert.rejects(exec.wrapExit(cp.spawn("false")), {
      name: "Error",
      message: `Command "false" failed with code 1`,
    })
    await assert.rejects(exec.wrapExit(cp.spawn("bash", ["-c", ">&2 printf stderr && exit 42"])), {
      name: "Error",
      message: `Command "bash" failed with code 42: stderr`,
    })
    await assert.rejects(exec.wrapExit(cp.spawn("surely-no-executable-named-like-this-exists")), {
      name: "Error",
      message: `spawn surely-no-executable-named-like-this-exists ENOENT`,
    })
  })

  test("binaryExists", async () => {
    assert.strictEqual(await exec.binaryExists("sh"), true)
    assert.strictEqual(await exec.binaryExists("surely-no-binary-named-like-this-exists"), false)
  })
})
