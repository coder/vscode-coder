import { SSHConfigResponse } from "coder/site/src/api/typesGenerated"
import { writeFile, readFile } from "fs/promises"
import { ensureDir } from "fs-extra"
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

// Interface for the file system to make it easier to test
export interface FileSystem {
  readFile: typeof readFile
  ensureDir: typeof ensureDir
  writeFile: typeof writeFile
}

const defaultFileSystem: FileSystem = {
  readFile,
  ensureDir,
  writeFile,
}

const defaultSSHConfigResponse: SSHConfigResponse = {
  ssh_config_options: {},
  hostname_prefix: "coder.",
}

export class SSHConfig {
  private filePath: string
  private fileSystem: FileSystem
  private deploymentConfig: SSHConfigResponse
  private raw: string | undefined
  private startBlockComment = "# --- START CODER VSCODE ---"
  private endBlockComment = "# --- END CODER VSCODE ---"

  constructor(
    filePath: string,
    fileSystem: FileSystem = defaultFileSystem,
    sshConfig: SSHConfigResponse = defaultSSHConfigResponse,
  ) {
    this.filePath = filePath
    this.fileSystem = fileSystem
    this.deploymentConfig = sshConfig
  }

  async load() {
    try {
      this.raw = await this.fileSystem.readFile(this.filePath, "utf-8")
    } catch (ex) {
      // Probably just doesn't exist!
      this.raw = ""
    }
  }

  async update(values: SSHValues) {
    // We should remove this in March 2023 because there is not going to have
    // old configs
    this.cleanUpOldConfig()
    const block = this.getBlock()
    if (block) {
      this.eraseBlock(block)
    }
    this.appendBlock(values, this.deploymentConfig.ssh_config_options)
    await this.save()
  }

  private async cleanUpOldConfig() {
    const raw = this.getRaw()
    const oldConfig = raw.split("\n\n").find((config) => config.startsWith("Host coder-vscode--*"))
    if (oldConfig) {
      this.raw = raw.replace(oldConfig, "")
    }
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
      throw new SSHConfigBadFormat("Malformed config, end block is before start block")
    }

    return {
      raw: raw.substring(startBlockIndex, endBlockIndex + this.endBlockComment.length),
    }
  }

  private eraseBlock(block: Block) {
    this.raw = this.getRaw().replace(block.raw, "")
  }

  /**
   *
   * appendBlock builds the ssh config block. The order of the keys is determinstic based on the input.
   * Expected values are always in a consistent order followed by any additional overrides in sorted order.
   *
   * @param param0 - SSHValues are the expected SSH values for using ssh with coder.
   * @param overrides - Overrides typically come from the deployment api and are used to override the default values.
   *                    The overrides are given as key:value pairs where the key is the ssh config file key.
   *                    If the key matches an expected value, the expected value is overridden. If it does not
   *                    match an expected value, it is appended to the end of the block.
   */
  private appendBlock({ Host, ...otherValues }: SSHValues, overrides: Record<string, string>) {
    const lines = [this.startBlockComment, `Host ${Host}`]
    // We need to do a case insensitive match for the overrides as ssh config keys are case insensitive.
    // To get the correct key:value, use:
    //   key = caseInsensitiveOverrides[key.toLowerCase()]
    //   value = overrides[key]
    const caseInsensitiveOverrides: Record<string, string> = {}
    Object.keys(overrides).forEach((key) => {
      caseInsensitiveOverrides[key.toLowerCase()] = key
    })

    const keys = Object.keys(otherValues) as Array<keyof typeof otherValues>
    keys.forEach((key) => {
      const lower = key.toLowerCase()
      if (caseInsensitiveOverrides[lower]) {
        const correctCaseKey = caseInsensitiveOverrides[lower]
        // If the key is in overrides, use the override value.
        // Doing it this way maintains the default order of the keys.
        lines.push(this.withIndentation(`${key} ${overrides[correctCaseKey]}`))
        // Remove the key from the overrides so we don't write it again.
        delete caseInsensitiveOverrides[lower]
        return
      }
      lines.push(this.withIndentation(`${key} ${otherValues[key]}`))
    })
    // Write remaining overrides that have not been written yet. Sort to maintain deterministic order.
    const remainingKeys = (Object.keys(caseInsensitiveOverrides) as Array<keyof typeof caseInsensitiveOverrides>).sort()
    remainingKeys.forEach((key) => {
      const correctKey = caseInsensitiveOverrides[key]
      lines.push(this.withIndentation(`${key} ${overrides[correctKey]}`))
    })

    lines.push(this.endBlockComment)
    const raw = this.getRaw()

    if (this.raw === "") {
      this.raw = lines.join("\n")
    } else {
      this.raw = `${raw.trimEnd()}\n\n${lines.join("\n")}`
    }
  }

  private withIndentation(text: string) {
    return `  ${text}`
  }

  private async save() {
    await this.fileSystem.ensureDir(path.dirname(this.filePath), {
      mode: 0o700, // only owner has rwx permission, not group or everyone.
    })
    return this.fileSystem.writeFile(this.filePath, this.getRaw(), {
      mode: 0o600, // owner rw
      encoding: "utf-8",
    })
  }

  public getRaw() {
    if (this.raw === undefined) {
      throw new Error("SSHConfig is not loaded. Try sshConfig.load()")
    }

    return this.raw
  }
}
