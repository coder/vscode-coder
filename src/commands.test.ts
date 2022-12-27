import { createFirstUser, login } from "coder/site/src/api/api"
import * as vscode from "vscode"
import { runServer } from "./test/setup"

suite("commands", () => {
  test("login", async () => {
    const url = await runServer()
    await createFirstUser({
      email: "user@coder.com",
      username: "user",
      password: "password",
      trial: false,
    })
    const resp = await login("user@coder.com", "password")
    await vscode.commands.executeCommand("coder.login", url, resp.session_token)
  })
})
