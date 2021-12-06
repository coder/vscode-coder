import * as assert from "assert"
import * as fs from "fs"
import * as http from "http"
import * as path from "path"
import * as vscode from "vscode"
import * as request from "./request"

suite("Request", () => {
  vscode.window.showInformationMessage("Start request tests.")

  let spy: Array<string | undefined> = []
  const testJson = { foo: "bar" }
  let target = ""

  /**
   * Mock server with various endpoints for testing:
   *   - /json: Return `testJson` with a 200
   *   - /tar: Return a tar file.
   *   - /zip: Return a zip file.
   *   - /*: Respond with the code set to the route.  Will fail if not a number.
   */
  const server = http.createServer((request: http.IncomingMessage, response: http.ServerResponse) => {
    spy.push(request.url)
    switch (request.url) {
      case "/json":
        response.writeHead(200)
        return response.end(JSON.stringify(testJson))
      case "/zip":
      case "/tar": {
        const tarPath = path.resolve(__dirname, "../fixtures/archive" + (request.url === "/tar" ? ".tar.gz" : ".zip"))
        const stream = fs.createReadStream(tarPath)
        stream.on("error", (error) => {
          response.writeHead(500)
          response.end(error.message)
        })
        response.writeHead(200)
        return stream.pipe(response)
      }
      default: {
        const code = request.url?.replace(/^\//, "")
        response.writeHead(parseInt(code || "0", 10))
        return response.end(code)
      }
    }
  })

  suiteSetup(async () => {
    await new Promise((resolve, reject) => {
      server.on("error", reject)
      server.on("listening", resolve)
      server.listen({
        port: 0,
        host: "localhost",
      })
    })
    const address = server.address()
    if (!address || typeof address === "string" || !address.port) {
      throw new Error("unexpected address")
    }
    target = `http://${address.address}:${address.port}`
  })

  suiteTeardown(() => {
    server.close()
  })

  setup(() => {
    spy = []
  })

  test("request", async () => {
    const buffer = await request.request(target + "/json")
    assert.deepStrictEqual(JSON.parse(buffer.toString()), testJson)
    for (const code of [404, 500]) {
      await assert.rejects(request.request(target + "/" + code), {
        name: "Error",
        message: `${target}/${code}: ${code}`,
      })
    }
    assert.deepStrictEqual(spy, ["/json", "/404", "/500"])
  })

  test("tar", async () => {
    assert.deepStrictEqual(
      await request.request(target + "/tar"),
      await fs.promises.readFile(path.resolve(__dirname, "../fixtures/archive.tar.gz")),
    )
  })

  test("zip", async () => {
    assert.deepStrictEqual(
      await request.request(target + "/zip"),
      await fs.promises.readFile(path.resolve(__dirname, "../fixtures/archive.zip")),
    )
  })
})
