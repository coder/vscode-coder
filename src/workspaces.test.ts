import * as assert from "assert"
import { promises as fs } from "fs"
import * as path from "path"
import * as vscode from "vscode"
import * as workspaces from "./workspaces"

suite("Workspaces", () => {
  vscode.window.showInformationMessage("Start workspace tests.")

  const ws: workspaces.CoderWorkspace[] = []

  suiteSetup(async () => {
    // The mock binary will read workspaces from this file so pull it in here to
    // test against the output.
    const contents = await fs.readFile(path.resolve(__dirname, "../fixtures/workspaces.json"), "utf8")
    const result = JSON.parse(contents)
    assert.strictEqual(Array.isArray(result), true)
    ws.push(...result)
  })

  test("workspaceIcon", async () => {
    assert.strictEqual(workspaces.workspaceIcon(ws[0]), "on.svg")
    const badWorkspace = {
      ...ws[0],
      latest_stat: {
        container_status: "foobar",
      },
    }
    assert.throws(() => workspaces.workspaceIcon(badWorkspace), {
      name: "Error",
      message: "Unknown status foobar",
    })
  })

  test("getWorkspaces", async () => {
    assert.deepStrictEqual(await workspaces.getWorkspaces(), ws)
  })
})
