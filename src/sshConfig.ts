import { mkdir, readFile, writeFile } from "fs/promises"
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
  mkdir: typeof mkdir
  writeFile: typeof writeFile
}

const defaultFileSystem: FileSystem = {
  readFile,
  mkdir,
  writeFile,
}

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

  private startBlockComment(label: string): string {
    return label ? `# --- START CODER VSCODE ${label} ---` : `# --- START CODER VSCODE ---`
  }
  private endBlockComment(label: string): string {
    return label ? `# --- END CODER VSCODE ${label} ---` : `# --- END CODER VSCODE ---`
  }

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

  /**
   * Update the block for the deployment with the provided label.
   */
  async update(label: string, values: SSHValues, overrides?: Record<string, string>) {
    const block = this.getBlock(label)
    const newBlock = this.buildBlock(label, values, overrides)
    if (block) {
      this.replaceBlock(block, newBlock)
    } else {
      this.appendBlock(newBlock)
    }
    await this.save()
  }

  /**
   * Get the block for the deployment with the provided label.
   */
  private getBlock(label: string): Block | undefined {
    const raw = this.getRaw()
    const startBlockIndex = raw.indexOf(this.startBlockComment(label))
    const endBlockIndex = raw.indexOf(this.endBlockComment(label))
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
      raw: raw.substring(startBlockIndex, endBlockIndex + this.endBlockComment(label).length),
    }
  }

  /**
   * buildBlock builds the ssh config block for the provided URL. The order of
   * the keys is determinstic based on the input.  Expected values are always in
   * a consistent order followed by any additional overrides in sorted order.
   *
   * @param label     - The label for the deployment (like the encoded URL).
   * @param values    - The expected SSH values for using ssh with Coder.
   * @param overrides - Overrides typically come from the deployment api and are
   *                    used to override the default values.  The overrides are
   *                    given as key:value pairs where the key is the ssh config
   *                    file key.  If the key matches an expected value, the
   *                    expected value is overridden. If it does not match an
   *                    expected value, it is appended to the end of the block.
   */
  private buildBlock(label: string, values: SSHValues, overrides?: Record<string, string>) {
    const { Host, ...otherValues } = values
    const lines = [this.startBlockComment(label), `Host ${Host}`]

    // configValues is the merged values of the defaults and the overrides.
    const configValues = mergeSSHConfigValues(otherValues, overrides || {})

    // keys is the sorted keys of the merged values.
    const keys = (Object.keys(configValues) as Array<keyof typeof configValues>).sort()
    keys.forEach((key) => {
      const value = configValues[key]
      if (value !== "") {
        lines.push(this.withIndentation(`${key} ${value}`))
      }
    })

    lines.push(this.endBlockComment(label))
    return {
      raw: lines.join("\n"),
    }
  }

  private replaceBlock(oldBlock: Block, newBlock: Block) {
    this.raw = this.getRaw().replace(oldBlock.raw, newBlock.raw)
  }

  private appendBlock(block: Block) {
    const raw = this.getRaw()

    if (this.raw === "") {
      this.raw = block.raw
    } else {
      this.raw = `${raw.trimEnd()}\n\n${block.raw}`
    }
  }

  private withIndentation(text: string) {
    return `  ${text}`
  }

  private async save() {
    await this.fileSystem.mkdir(path.dirname(this.filePath), {
      mode: 0o700, // only owner has rwx permission, not group or everyone.
      recursive: true,
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
