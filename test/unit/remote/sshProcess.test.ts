import find from "find-process";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	SshProcessMonitor,
	type SshProcessMonitorOptions,
} from "@/remote/sshProcess";

import { createMockLogger, MockStatusBar } from "../../mocks/testHelpers";

import type * as fs from "node:fs";

vi.mock("find-process", () => ({ default: vi.fn() }));

vi.mock("node:fs/promises", async () => {
	const memfs: { fs: typeof fs } = await vi.importActual("memfs");
	return memfs.fs.promises;
});

describe("SshProcessMonitor", () => {
	let activeMonitors: SshProcessMonitor[] = [];
	let statusBar: MockStatusBar;

	beforeEach(() => {
		vi.clearAllMocks();
		vol.reset();
		activeMonitors = [];
		statusBar = new MockStatusBar();

		// Default: process found immediately
		vi.mocked(find).mockResolvedValue([
			{ pid: 999, ppid: 1, name: "ssh", cmd: "ssh host" },
		]);
	});

	afterEach(() => {
		for (const m of activeMonitors) {
			m.dispose();
		}
		activeMonitors = [];
		vol.reset();
	});

	describe("process discovery", () => {
		it("finds SSH process by port from Remote SSH logs", async () => {
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
			});

			const monitor = createMonitor({ codeLogDir: "/logs/window1" });
			const pid = await waitForEvent(monitor.onPidChange);

			expect(find).toHaveBeenCalledWith("port", 12345);
			expect(pid).toBe(999);
		});

		it("retries until process is found", async () => {
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
			});

			// First 2 calls return nothing, third call finds the process
			vi.mocked(find)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([
					{ pid: 888, ppid: 1, name: "ssh", cmd: "ssh host" },
				]);

			const monitor = createMonitor({ codeLogDir: "/logs/window1" });
			const pid = await waitForEvent(monitor.onPidChange);

			expect(vi.mocked(find).mock.calls.length).toBeGreaterThanOrEqual(3);
			expect(pid).toBe(888);
		});

		it("retries when Remote SSH log appears later", async () => {
			// Start with no log file
			vol.fromJSON({});

			vi.mocked(find).mockResolvedValue([
				{ pid: 777, ppid: 1, name: "ssh", cmd: "ssh host" },
			]);

			const monitor = createMonitor({ codeLogDir: "/logs/window1" });

			// Add the log file after a delay
			setTimeout(() => {
				vol.fromJSON({
					"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
						"-> socksPort 55555 ->",
				});
			}, 50);

			const pid = await waitForEvent(monitor.onPidChange);

			expect(find).toHaveBeenCalledWith("port", 55555);
			expect(pid).toBe(777);
		});

		it("reconnects when network info becomes stale", async () => {
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
				"/network/999.json": JSON.stringify({
					p2p: true,
					latency: 10,
					preferred_derp: "",
					derp_latency: {},
					upload_bytes_sec: 0,
					download_bytes_sec: 0,
					using_coder_connect: false,
				}),
			});

			// First search finds PID 999, after reconnect finds PID 888
			vi.mocked(find)
				.mockResolvedValueOnce([{ pid: 999, ppid: 1, name: "ssh", cmd: "ssh" }])
				.mockResolvedValue([{ pid: 888, ppid: 1, name: "ssh", cmd: "ssh" }]);

			const monitor = createMonitor({
				codeLogDir: "/logs/window1",
				networkInfoPath: "/network",
				networkPollInterval: 10,
			});

			// Initial PID
			const firstPid = await waitForEvent(monitor.onPidChange);
			expect(firstPid).toBe(999);

			// Network info will become stale after 50ms (5 * networkPollInterval)
			// Monitor keeps showing last status, only fires when PID actually changes
			const pids: (number | undefined)[] = [];
			monitor.onPidChange((pid) => pids.push(pid));

			// Wait for reconnection to find new PID
			await waitFor(() => pids.includes(888), 200);

			// Should NOT fire undefined - we keep showing last status while searching
			expect(pids).toContain(888);
		});

		it("does not fire event when same process is found after stale check", async () => {
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
				"/network/999.json": JSON.stringify({
					p2p: true,
					latency: 10,
					preferred_derp: "",
					derp_latency: {},
					upload_bytes_sec: 0,
					download_bytes_sec: 0,
					using_coder_connect: false,
				}),
			});

			// Always returns the same PID
			vi.mocked(find).mockResolvedValue([
				{ pid: 999, ppid: 1, name: "ssh", cmd: "ssh" },
			]);

			const monitor = createMonitor({
				codeLogDir: "/logs/window1",
				networkInfoPath: "/network",
				networkPollInterval: 10,
			});

			// Wait for initial PID
			await waitForEvent(monitor.onPidChange);

			// Track subsequent events
			const pids: (number | undefined)[] = [];
			monitor.onPidChange((pid) => pids.push(pid));

			// Wait long enough for stale check to trigger and re-find same process
			await new Promise((r) => setTimeout(r, 100));

			// No events should fire - same process found, no change
			expect(pids).toEqual([]);
		});
	});

	describe("log file discovery", () => {
		it("finds log file matching PID pattern", async () => {
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
				"/proxy-logs/999.log": "",
				"/proxy-logs/other.log": "",
			});

			const monitor = createMonitor({
				codeLogDir: "/logs/window1",
				proxyLogDir: "/proxy-logs",
			});
			const logPath = await waitForEvent(monitor.onLogFilePathChange);

			expect(logPath).toBe("/proxy-logs/999.log");
			expect(monitor.getLogFilePath()).toBe("/proxy-logs/999.log");
		});

		it("finds log file with prefix pattern", async () => {
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
				"/proxy-logs/coder-ssh-999.log": "",
			});

			const monitor = createMonitor({
				codeLogDir: "/logs/window1",
				proxyLogDir: "/proxy-logs",
			});
			const logPath = await waitForEvent(monitor.onLogFilePathChange);

			expect(logPath).toBe("/proxy-logs/coder-ssh-999.log");
		});

		it("returns undefined when no proxyLogDir set", async () => {
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
				"/proxy-logs/coder-ssh-999.log": "", // ignored
			});

			const monitor = createMonitor({
				codeLogDir: "/logs/window1",
				proxyLogDir: undefined,
			});

			// Wait for process to be found
			await waitForEvent(monitor.onPidChange);

			expect(monitor.getLogFilePath()).toBeUndefined();
		});
	});

	describe("network status", () => {
		it("shows P2P connection in status bar", async () => {
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
				"/network/999.json": JSON.stringify({
					p2p: true,
					latency: 25.5,
					preferred_derp: "NYC",
					derp_latency: { NYC: 10 },
					upload_bytes_sec: 1024,
					download_bytes_sec: 2048,
					using_coder_connect: false,
				}),
			});

			createMonitor({
				codeLogDir: "/logs/window1",
				networkInfoPath: "/network",
			});
			await waitFor(() => statusBar.text.includes("Direct"));

			expect(statusBar.text).toContain("Direct");
			expect(statusBar.text).toContain("25.50ms");
			expect(statusBar.tooltip).toContain("peer-to-peer");
		});

		it("shows relay connection with DERP region", async () => {
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
				"/network/999.json": JSON.stringify({
					p2p: false,
					latency: 50,
					preferred_derp: "SFO",
					derp_latency: { SFO: 20, NYC: 40 },
					upload_bytes_sec: 512,
					download_bytes_sec: 1024,
					using_coder_connect: false,
				}),
			});

			createMonitor({
				codeLogDir: "/logs/window1",
				networkInfoPath: "/network",
			});
			await waitFor(() => statusBar.text.includes("SFO"));

			expect(statusBar.text).toContain("SFO");
			expect(statusBar.tooltip).toContain("relay");
		});

		it("shows Coder Connect status", async () => {
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
				"/network/999.json": JSON.stringify({
					p2p: false,
					latency: 0,
					preferred_derp: "",
					derp_latency: {},
					upload_bytes_sec: 0,
					download_bytes_sec: 0,
					using_coder_connect: true,
				}),
			});

			createMonitor({
				codeLogDir: "/logs/window1",
				networkInfoPath: "/network",
			});
			await waitFor(() => statusBar.text.includes("Coder Connect"));

			expect(statusBar.text).toContain("Coder Connect");
		});
	});

	describe("dispose", () => {
		it("disposes status bar", () => {
			const monitor = createMonitor();
			monitor.dispose();

			expect(statusBar.dispose).toHaveBeenCalled();
		});

		it("stops searching for process after dispose", async () => {
			// Log file exists so port can be found and find() is called
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
			});

			// find() always returns empty - monitor will keep retrying
			vi.mocked(find).mockResolvedValue([]);

			const monitor = createMonitor({ codeLogDir: "/logs/window1" });

			// Let a few poll cycles run
			await new Promise((r) => setTimeout(r, 30));
			const callsBeforeDispose = vi.mocked(find).mock.calls.length;
			expect(callsBeforeDispose).toBeGreaterThan(0);

			monitor.dispose();

			// Wait and verify no new calls
			await new Promise((r) => setTimeout(r, 50));
			expect(vi.mocked(find).mock.calls.length).toBe(callsBeforeDispose);
		});

		it("does not fire log file event after dispose", async () => {
			// Start with SSH log but no proxy log file
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
			});

			const monitor = createMonitor({
				codeLogDir: "/logs/window1",
				proxyLogDir: "/proxy-logs",
			});

			// Wait for PID - this starts the log file search loop
			await waitForEvent(monitor.onPidChange);

			const events: string[] = [];
			monitor.onLogFilePathChange(() => events.push("logPath"));

			monitor.dispose();

			// Now add the log file that WOULD have been found
			vol.fromJSON({
				"/logs/ms-vscode-remote.remote-ssh/1-Remote - SSH.log":
					"-> socksPort 12345 ->",
				"/proxy-logs/999.log": "",
			});

			await new Promise((r) => setTimeout(r, 50));
			expect(events).toEqual([]);
		});

		it("is idempotent - can be called multiple times", () => {
			const monitor = createMonitor();

			monitor.dispose();
			monitor.dispose();
			monitor.dispose();

			// Should not throw, and dispose should only be called once on status bar
			expect(statusBar.dispose).toHaveBeenCalledTimes(1);
		});
	});

	function createMonitor(overrides: Partial<SshProcessMonitorOptions> = {}) {
		const monitor = SshProcessMonitor.start({
			sshHost: "coder-vscode--user--workspace",
			networkInfoPath: "/network",
			codeLogDir: "/logs/window1",
			remoteSshExtensionId: "ms-vscode-remote.remote-ssh",
			logger: createMockLogger(),
			discoveryPollIntervalMs: 10,
			maxDiscoveryBackoffMs: 100,
			networkPollInterval: 10,
			...overrides,
		});
		activeMonitors.push(monitor);
		return monitor;
	}
});

/** Wait for a VS Code event to fire once */
function waitForEvent<T>(
	event: (listener: (e: T) => void) => { dispose(): void },
	timeout = 1000,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			disposable.dispose();
			reject(new Error(`waitForEvent timed out after ${timeout}ms`));
		}, timeout);

		const disposable = event((value) => {
			clearTimeout(timer);
			disposable.dispose();
			resolve(value);
		});
	});
}

/** Poll for a condition to become true */
async function waitFor(
	condition: () => boolean,
	timeout = 1000,
	interval = 5,
): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeout) {
			throw new Error(`waitFor timed out after ${timeout}ms`);
		}
		await new Promise((r) => setTimeout(r, interval));
	}
}
