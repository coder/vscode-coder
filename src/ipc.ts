import { ChildProcess, execFile } from "child_process"
import * as http from "http"
import * as net from "net"
import * as vscode from "vscode"
import { Storage } from "./storage"

export interface NetworkStats {
  p2p: boolean
  latency: number
  preferred_derp: string
  derp_latency: { [key: string]: number }
  upload_bytes_sec: number
  download_bytes_sec: number
}

export class IPC {
  public static async start(binaryPath: string, storage: Storage, agentID: string): Promise<IPC> {
    const token = storage.getSessionToken() || ""
    const cp = execFile(binaryPath, ["vscodeipc", agentID], {
      env: {
        CODER_URL: storage.getURL(),
        CODER_TOKEN: token,
      },
      killSignal: "SIGINT",
    })
    const ipc = new IPC(token, cp)
    ipc.onKill(() => (ipc.killed = true))
    const addr = await new Promise<[string, number]>((resolve, reject) => {
      cp.on("exit", (code) => {
        reject(new Error("exited with " + code))
        ipc.onKillEmitter.fire()
      })
      cp.on("error", (err) => {
        reject(err)
        ipc.onKillEmitter.fire()
      })
      cp.stdout?.on("data", (addr: Buffer) => {
        // A message with the listening port is printed when ready!
        const parts = addr.toString().trim().split(":")

        resolve([parts[0], Number.parseInt(parts[1])])
      })
      cp.stderr?.on("data", (err: Buffer) => {
        reject(new Error(err.toString()))
      })
    })
    ipc.host = addr[0]
    ipc.port = addr[1]
    return ipc
  }

  private readonly onKillEmitter = new vscode.EventEmitter<void>()
  public readonly onKill = this.onKillEmitter.event

  public killed = false
  private host?: string
  private port?: number

  private constructor(private readonly sessionToken: string, private readonly cp: ChildProcess) {}

  public kill(): void {
    this.cp.kill()
  }

  private headers(): { [key: string]: string } {
    return {
      "Coder-IPC-Token": this.sessionToken,
    }
  }

  // network returns network information about the connected agent.
  public network(): Promise<NetworkStats> {
    return new Promise<NetworkStats>((resolve, reject) => {
      const req = http.request({
        host: this.host,
        port: this.port,
        method: "GET",
        path: "/v1/network",
        timeout: 5000,
        headers: this.headers(),
      })
      req.end()
      req.on("error", (err) => reject(err))
      req.on("response", (resp) => {
        resp.on("data", (data) => {
          resolve(JSON.parse(data.toString()))
        })
      })
    })
  }

  public async portForward(remotePort: number): Promise<
    {
      localPort: number
    } & vscode.Disposable
  > {
    const server = net.createServer((localSocket) => {
      const req = http.request({
        host: this.host,
        port: this.port,
        method: "GET",
        path: "/v1/port/" + remotePort,
        headers: {
          ...this.headers(),
          Connection: "Upgrade",
          Upgrade: "tcp",
        },
      })
      req.end()
      req.on("error", (err) => {
        throw err
      })
      req.on("upgrade", (_, socket) => {
        localSocket.pipe(socket)
        socket.pipe(localSocket)
      })
      req.on("response", (resp) => {
        throw new Error("unexpected response: " + resp.statusCode)
      })
    })
    const addr = await new Promise<string | net.AddressInfo | null>((r) =>
      server.listen(0, () => {
        r(server.address())
      }),
    )
    if (addr && typeof addr === "object") {
      return {
        localPort: addr.port,
        dispose: () => {
          server.close()
        },
      }
    } else {
      throw new Error("noooo")
    }
  }

  public execute(command: string, stdin: string, callback: (data: string, exitCode?: number) => void): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const req = http.request({
        host: this.host,
        port: this.port,
        method: "POST",
        path: "/v1/execute",
        headers: this.headers(),
      })
      req.write(JSON.stringify({ command, stdin }))
      req.end()
      req.on("error", (err) => {
        reject(err)
      })
      req.on("response", (resp) => {
        if (resp.statusCode !== 200) {
          reject(new Error("unexpected response: " + resp.statusCode))
          return
        }
        resp.on("data", (data) => {
          const message = JSON.parse(data.toString()) as {
            data: string
            exit_code: number | null
          }
          if (message.exit_code !== null) {
            callback(message.data, message.exit_code)
            resolve(message.exit_code)
          } else {
            callback(message.data)
          }
        })
      })
    })
  }
}
