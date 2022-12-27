import axios from "axios"
import { spawn } from "child_process"
import { mkdtemp, readFile } from "fs"
import os from "os"
import path from "path"

export const runServer = async (): Promise<string> => {
  const tempDir = await new Promise<string>((resolve, reject) => {
    mkdtemp(path.join(os.tmpdir(), "vscode-coder"), (err, folder) => {
      if (err) {
        return reject(err)
      }
      resolve(folder)
    })
  })

  const proc = spawn("coder", [
    "--global-config",
    tempDir,
    "server",
    "--in-memory",
    "--address",
    ":0",
    "--telemetry",
    "false",
  ])
  proc.stderr = process.stderr
  proc.stdout = process.stdout
  const url = await new Promise<string>((resolve, reject) => {
    proc.on("error", (err) => {
      reject(err)
    })
    proc.on("exit", (code) => {
      reject(new Error("exited with " + code))
    })
    const loop = () => {
      const urlPath = path.join(tempDir, "url")
      readFile(urlPath, (err, data) => {
        if (err) {
          setTimeout(loop, 100)
          return
        }
        resolve(data.toString())
      })
    }
    loop()
  })
  axios.defaults.baseURL = url
  return url
}
