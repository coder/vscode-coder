import { ensureDir } from "fs-extra"
import * as fs from "fs/promises"
import path from "path"

class SSHConfigBadFormat extends Error {}

interface Block {
  raw: string
}

interface SSHValues {
  Host: string
  ProxyCommand: string
  ConnectTimeout: string
  StrictHostKeyChecking: string
  UserKnownHostsFile: string
  LogLevel: string
}

export class SSHConfig {
  private filePath: string
  private raw: string | undefined
  private startBlockComment = "# --- START CODER VSCODE ---"
  private endBlockComment = "# --- END CODER VSCODE ---"

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load() {
    try {
      this.raw = await fs.readFile(this.filePath, "utf-8")
    } catch (ex) {
      // Probably just doesn't exist!
      this.raw = ""
    }
  }

  async update(values: SSHValues) {
    const block = this.getBlock()
    if (block) {
      this.eraseBlock(block)
    }
    this.appendBlock(values)
    await this.save()
  }

  private getBlock(): Block | undefined {
    const raw = this.getRaw()
    const startBlockIndex = raw.indexOf(this.startBlockComment)
    const endBlockIndex = raw.indexOf(this.endBlockComment)
    const hasBlock = startBlockIndex > -1 && endBlockIndex > -1

    if (!hasBlock) {
      return
    }

    if (startBlockIndex === -1) {
      throw new SSHConfigBadFormat("Start block not found")
    }

    if (startBlockIndex === -1) {
      throw new SSHConfigBadFormat("End block not found")
    }

    if (endBlockIndex < startBlockIndex) {
      throw new SSHConfigBadFormat("End block is starting before the start block")
    }

    return {
      raw: raw.substring(startBlockIndex, endBlockIndex + this.endBlockComment.length),
    }
  }

  private eraseBlock(block: Block) {
    this.raw = this.getRaw().replace(block.raw, "")
  }

  private appendBlock({ Host, ...otherValues }: SSHValues) {
    const lines = [this.startBlockComment, `Host ${Host}`]
    const keys = Object.keys(otherValues) as Array<keyof typeof otherValues>
    keys.forEach((key) => {
      lines.push(this.withIndentation(`${key} ${otherValues[key]}`))
    })
    lines.push(this.endBlockComment)
    this.raw = `${this.raw}\n${lines.join("\n")}`
  }

  private withIndentation(text: string) {
    return `  ${text}`
  }

  private async save() {
    await ensureDir(path.dirname(this.filePath))
    return fs.writeFile(this.filePath, this.getRaw(), "utf-8")
  }

  private getRaw() {
    if (!this.raw) {
      throw new Error("SSHConfig is not loaded. Try sshConfig.load()")
    }

    return this.raw
  }
}
