import * as vscode from "vscode"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

/**
 * A class for tracking memory usage and logging resource lifecycles
 * to help identify memory leaks in the extension.
 */
export class MemoryLogger {
  private outputChannel: vscode.OutputChannel
  private logFile: string | undefined
  private resourceCounts = new Map<string, number>()
  private startTime: number = Date.now()
  private logInterval: NodeJS.Timeout | undefined
  private disposed: boolean = false

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Coder Memory Logging")
    this.outputChannel.show()

    // Setup periodic logging of memory usage
    this.startPeriodicLogging()
  }

  /**
   * Start logging memory usage periodically
   */
  private startPeriodicLogging(intervalMs = 60000) {
    if (this.logInterval) {
      clearInterval(this.logInterval)
    }

    this.logInterval = setInterval(() => {
      if (this.disposed) return
      this.logMemoryUsage("PERIODIC")
      this.logResourceCounts()
    }, intervalMs)
  }

  /**
   * Initialize the log file for persistent logging
   */
  public async initLogFile(globalStoragePath: string): Promise<void> {
    try {
      const logDir = path.join(globalStoragePath, "logs")
      await fs.mkdir(logDir, { recursive: true })

      this.logFile = path.join(logDir, `memory-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`)

      await this.writeToLogFile("Memory logging initialized")
      this.info("Memory logging initialized to file: " + this.logFile)

      // Log initial memory state
      this.logMemoryUsage("INIT")
    } catch (err) {
      this.error(`Failed to initialize log file: ${err}`)
    }
  }

  /**
   * Log a new resource creation
   */
  public trackResourceCreated(resourceType: string, id: string = ""): void {
    const count = (this.resourceCounts.get(resourceType) || 0) + 1
    this.resourceCounts.set(resourceType, count)
    this.info(`RESOURCE_CREATED: ${resourceType}${id ? ":" + id : ""} (Total: ${count})`)
  }

  /**
   * Log a resource disposal
   */
  public trackResourceDisposed(resourceType: string, id: string = ""): void {
    const count = Math.max(0, (this.resourceCounts.get(resourceType) || 1) - 1)
    if (count === 0) {
      this.resourceCounts.delete(resourceType)
    } else {
      this.resourceCounts.set(resourceType, count)
    }

    this.info(`RESOURCE_DISPOSED: ${resourceType}${id ? ":" + id : ""} (Remaining: ${count})`)
  }

  /**
   * Log error with memory usage
   */
  public error(message: string, error?: unknown): void {
    const errorMsg = error ? `: ${error instanceof Error ? error.stack || error.message : String(error)}` : ""
    const fullMessage = `[ERROR] ${message}${errorMsg}`

    this.outputChannel.appendLine(fullMessage)
    this.writeToLogFile(fullMessage)
    this.logMemoryUsage("ERROR")
  }

  /**
   * Log info with timestamp
   */
  public info(message: string): void {
    const fullMessage = `[INFO] ${message}`
    this.outputChannel.appendLine(fullMessage)
    this.writeToLogFile(fullMessage)
  }

  /**
   * Log debug info (only to file)
   */
  public debug(message: string): void {
    const fullMessage = `[DEBUG] ${message}`
    this.writeToLogFile(fullMessage)
  }

  /**
   * Log current memory usage
   */
  public logMemoryUsage(context: string): void {
    try {
      const memoryUsage = process.memoryUsage()
      const nodeMemoryInfo = {
        rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)}MB`,
        heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
        heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        external: `${(memoryUsage.external / 1024 / 1024).toFixed(2)}MB`,
        uptime: formatDuration(process.uptime() * 1000),
        totalUptime: formatDuration(Date.now() - this.startTime)
      }

      const systemMemoryInfo = {
        totalMem: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)}GB`,
        freeMem: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)}GB`,
        loadAvg: os.loadavg().map(load => load.toFixed(2)).join(", ")
      }

      const memoryLog = `[MEMORY:${context}] Node: ${JSON.stringify(nodeMemoryInfo)} | System: ${JSON.stringify(systemMemoryInfo)}`
      this.outputChannel.appendLine(memoryLog)
      this.writeToLogFile(memoryLog)
    } catch (err) {
      this.outputChannel.appendLine(`[ERROR] Failed to log memory usage: ${err}`)
    }
  }

  /**
   * Log the current counts of active resources
   */
  private logResourceCounts(): void {
    const counts = Array.from(this.resourceCounts.entries())
      .map(([type, count]) => `${type}=${count}`)
      .join(", ")

    const message = `[RESOURCES] Active resources: ${counts || "none"}`
    this.outputChannel.appendLine(message)
    this.writeToLogFile(message)
  }

  /**
   * Write to log file
   */
  private async writeToLogFile(message: string): Promise<void> {
    if (!this.logFile) return

    try {
      const timestamp = new Date().toISOString()
      await fs.appendFile(this.logFile, `${timestamp} ${message}\n`)
    } catch (err) {
      // Don't recursively call this.error to avoid potential loops
      this.outputChannel.appendLine(`[ERROR] Failed to write to log file: ${err}`)
    }
  }

  /**
   * Show the log in the output channel
   */
  public show(): void {
    this.outputChannel.show()
  }

  /**
   * Dispose of the logger
   */
  public dispose(): void {
    this.disposed = true
    if (this.logInterval) {
      clearInterval(this.logInterval)
      this.logInterval = undefined
    }
    this.logMemoryUsage("DISPOSE")
    this.outputChannel.dispose()
  }
}

/**
 * Format duration in milliseconds to a human-readable string
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor((ms / 1000) % 60)
  const minutes = Math.floor((ms / (1000 * 60)) % 60)
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24)
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))

  return `${days}d ${hours}h ${minutes}m ${seconds}s`
}

// Singleton instance
let instance: MemoryLogger | undefined

/**
 * Get or initialize the memory logger instance
 */
export function getMemoryLogger(): MemoryLogger {
  if (!instance) {
    instance = new MemoryLogger()
  }
  return instance
}