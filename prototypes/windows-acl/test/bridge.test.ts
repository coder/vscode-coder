import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

import bridgeModule from "../bridge.cjs";

const { createBridge } = bridgeModule;
const artifactRoot = "C:\\prototype\\artifacts";
const target = "C:\\scratch\\target; & injected.txt";

describe("createBridge", () => {
	it.each([
		["darwin", "x64"],
		["darwin", "arm64"],
		["linux", "x64"],
		["linux", "arm64"],
	] as const)(
		"skips native work on %s/%s without resolving missing artifacts",
		async (platform, arch) => {
			const loadAddon = vi.fn();
			const runHelper = vi.fn();
			const bridge = createBridge({
				variant: "addon",
				artifactRoot: "/missing/artifacts",
				platform,
				arch,
				loadAddon,
				runHelper,
			});

			await expect(bridge.inspect("not a Windows path")).resolves.toEqual({
				skipped: true,
			});
			expect(loadAddon).not.toHaveBeenCalled();
			expect(runHelper).not.toHaveBeenCalled();
		},
	);

	it.each(["ia32", "arm", "riscv64"])(
		"rejects unsupported Windows architecture %s before native work",
		async (arch) => {
			const loadAddon = vi.fn();
			const runHelper = vi.fn();
			const bridge = createBridge({
				variant: "helper",
				artifactRoot,
				platform: "win32",
				arch,
				loadAddon,
				runHelper,
			});

			await expect(bridge.secure("C:\\scratch\\target")).rejects.toThrow(
				`Unsupported Windows architecture: ${arch}`,
			);
			expect(loadAddon).not.toHaveBeenCalled();
			expect(runHelper).not.toHaveBeenCalled();
		},
	);

	it.each(["x64", "arm64"] as const)(
		"selects the Windows %s addon artifact and loads it lazily once",
		async (arch) => {
			const inspect = vi.fn().mockResolvedValue("D:(A;;FA;;;SY)");
			const loadAddon = vi.fn().mockReturnValue({ inspect, secure: vi.fn() });
			const bridge = createBridge({
				variant: "addon",
				artifactRoot,
				platform: "win32",
				arch,
				loadAddon,
			});

			expect(loadAddon).not.toHaveBeenCalled();
			await expect(bridge.inspect("C:\\scratch\\first")).resolves.toBe(
				"D:(A;;FA;;;SY)",
			);
			await bridge.inspect("C:\\scratch\\second");

			expect(loadAddon).toHaveBeenCalledTimes(1);
			expect(loadAddon).toHaveBeenCalledWith(
				path.join(artifactRoot, `win32-${arch}`, "acl.node"),
			);
			expect(inspect).toHaveBeenNthCalledWith(1, "C:\\scratch\\first");
			expect(inspect).toHaveBeenNthCalledWith(2, "C:\\scratch\\second");
		},
	);

	it("propagates a missing addon binary error when it is first invoked", async () => {
		const missing = new Error("Cannot find module acl.node");
		const loadAddon = vi.fn(() => {
			throw missing;
		});
		const bridge = createBridge({
			variant: "addon",
			artifactRoot,
			platform: "win32",
			arch: "x64",
			loadAddon,
		});

		await expect(bridge.secure("C:\\scratch\\target")).rejects.toBe(missing);
		await expect(bridge.secure("C:\\scratch\\target")).rejects.toBe(missing);
		// A failed lazy require is retried by Node on the next invocation.
		expect(loadAddon).toHaveBeenCalledTimes(2);
	});

	it("passes helper operation and injection-shaped target as separate arguments", async () => {
		const runHelper = vi.fn().mockResolvedValue({
			stdout: JSON.stringify({ version: 1, ok: true, sddl: null }),
		});
		const bridge = createBridge({
			variant: "helper",
			artifactRoot,
			platform: "win32",
			arch: "arm64",
			runHelper,
		});

		await expect(bridge.secure(target)).resolves.toBeUndefined();

		expect(runHelper).toHaveBeenCalledWith(
			path.join(artifactRoot, "win32-arm64", "acl-helper.exe"),
			["secure", target],
			{ windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 },
		);
	});

	it("returns the helper inspection result", async () => {
		const runHelper = vi.fn().mockResolvedValue({
			stdout: JSON.stringify({ version: 1, ok: true, sddl: "D:P(A;;FA;;;SY)" }),
		});
		const bridge = createBridge({
			variant: "helper",
			artifactRoot,
			platform: "win32",
			arch: "x64",
			runHelper,
		});

		await expect(bridge.inspect("C:\\scratch\\target")).resolves.toBe(
			"D:P(A;;FA;;;SY)",
		);
	});

	it.each([
		JSON.stringify({ version: 2, ok: true }),
		JSON.stringify({ version: 1, ok: false }),
	] as const)("rejects invalid helper responses", async (stdout) => {
		const bridge = createBridge({
			variant: "helper",
			artifactRoot,
			platform: "win32",
			arch: "x64",
			runHelper: vi.fn().mockResolvedValue({ stdout }),
		});

		await expect(bridge.secure("C:\\scratch\\target")).rejects.toThrow(
			"Invalid ACL helper response",
		);
	});

	it("propagates helper failures", async () => {
		const failure = Object.assign(new Error("helper exited"), { code: 1 });
		const bridge = createBridge({
			variant: "helper",
			artifactRoot,
			platform: "win32",
			arch: "x64",
			runHelper: vi.fn().mockRejectedValue(failure),
		});

		await expect(bridge.inspect("C:\\scratch\\target")).rejects.toBe(failure);
	});

	it.each(["relative\\path", "C:\\scratch\\nul\0path"])(
		"rejects invalid Windows target paths before native work",
		async (invalidTarget) => {
			const loadAddon = vi.fn();
			const runHelper = vi.fn();
			const bridge = createBridge({
				variant: "helper",
				artifactRoot,
				platform: "win32",
				arch: "x64",
				loadAddon,
				runHelper,
			});

			await expect(bridge.secure(invalidTarget)).rejects.toThrow(
				"An absolute Windows path without NUL is required",
			);
			expect(loadAddon).not.toHaveBeenCalled();
			expect(runHelper).not.toHaveBeenCalled();
		},
	);
});
