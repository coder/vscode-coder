import { readFile, writeFile } from "fs/promises"
import { ensureDir } from "fs-extra"
import path from "path"

class SSHConfigBadFormat extends Error {}

interface Block {
  raw: string
}

export interface SSHValues {
  Host: string
  ProxyCommand: string
  ConnectTimeout: string
  StrictHostKeyChecking: string
  UserKnownHostsFile: string
  LogLevel: string
  SetEnv?: string
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

export const defaultSSHConfigResponse: Record<string, string> = {}

// mergeSSHConfigValues will take a given ssh config and merge it with the overrides
// provided. The merge handles key case insensitivity, so casing in the "key" does
// not matter.
export function mergeSSHConfigValues(
  config: Record<string, string>,
  overrides: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {}

  // We need to do a case insensitive match for the overrides as ssh config keys are case insensitive.
  // To get the correct key:value, use:
  //   key = caseInsensitiveOverrides[key.toLowerCase()]
  //   value = overrides[key]
  const caseInsensitiveOverrides: Record<string, string> = {}
  Object.keys(overrides).forEach((key) => {
    caseInsensitiveOverrides[key.toLowerCase()] = key
  })

  Object.keys(config).forEach((key) => {
    const lower = key.toLowerCase()
    // If the key is in overrides, use the override value.
    if (caseInsensitiveOverrides[lower]) {
      const correctCaseKey = caseInsensitiveOverrides[lower]
      const value = overrides[correctCaseKey]
      delete caseInsensitiveOverrides[lower]

      // If the value is empty, do not add the key. It is being removed.
      if (value === "") {
        return
      }
      merged[correctCaseKey] = value
      return
    }
    // If no override, take the original value.
    if (config[key] !== "") {
      merged[key] = config[key]
    }
  })

  // Add remaining overrides.
  Object.keys(caseInsensitiveOverrides).forEach((lower) => {
    const correctCaseKey = caseInsensitiveOverrides[lower]
    merged[correctCaseKey] = overrides[correctCaseKey]
  })

  return merged
}

export class SSHConfig {
  private filePath: string
  private fileSystem: FileSystem
  private raw: string | undefined
  private startBlockComment = "# --- START CODER VSCODE ---"
  private endBlockComment = "# --- END CODER VSCODE ---"

  constructor(filePath: string, fileSystem: FileSystem = defaultFileSystem) {
    this.filePath = filePath
    this.fileSystem = fileSystem
  }

  async load() {
    try {
      this.raw = await this.fileSystem.readFile(this.filePath, "utf-8")
    } catch (ex) {
      // Probably just doesn't exist!
      this.raw = ""
    }
  }

  async update(values: SSHValues, overrides: Record<string, string> = defaultSSHConfigResponse) {
    // We should remove this in March 2023 because there is not going to have
    // old configs
    this.cleanUpOldConfig()
    const block = this.getBlock()
    if (block) {
      this.eraseBlock(block)
    }
    this.appendBlock(values, overrides)
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

    // configValues is the merged values of the defaults and the overrides.
    const configValues = mergeSSHConfigValues(otherValues, overrides)

    // keys is the sorted keys of the merged values.
    const keys = (Object.keys(configValues) as Array<keyof typeof configValues>).sort()
    keys.forEach((key) => {
      const value = configValues[key]
      if (value !== "") {
        lines.push(this.withIndentation(`${key} ${value}`))
      }
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
