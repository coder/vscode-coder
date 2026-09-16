import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { WindowsAcl } from "@/remote/windows/acl";

import { EXTENSION_PATH, protectedAcl, SID, whoamiCsv } from "./fixtures";

const { execute } = vi.hoisted(() => ({
	execute: vi.fn<(command: string, args: string[]) => Promise<Result>>(),
}));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }),
	};
});

// Only the target's stat is faked; the ACL backup round trip stays real.
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, lstat: vi.fn(actual.lstat) };
});

interface Result {
	stdout: string;
	stderr: string;
}

const TARGET = "C:\\Users\\coder\\.ssh\\coder\\file.conf";
const SCRIPT_PATH = path.join(EXTENSION_PATH, "assets/wsh/acl.js");
const EMPTY: Result = { stdout: "", stderr: "" };

describe("WindowsAcl", () => {
	it("wraps a validation failure without running a command", async () => {
		setup();

		await expect(
			new WindowsAcl(EXTENSION_PATH).secure("not a Windows path"),
		).rejects.toThrow("Failed to repair SSH config permissions");
		expect(execute).not.toHaveBeenCalled();
	});

	it.each<string | undefined>([undefined, "Windows"])(
		"rejects SystemRoot %s before running a command",
		async (systemRoot) => {
			setup();
			vi.stubEnv("SystemRoot", systemRoot);

			await expect(
				new WindowsAcl(EXTENSION_PATH).secure(TARGET),
			).rejects.toThrow("SystemRoot must be a fully qualified Windows path");
			expect(execute).not.toHaveBeenCalled();
		},
	);

	it("reads the ACL first and leaves an already-protected file alone", async () => {
		const { backups } = setup(protectedAcl());

		await new WindowsAcl(EXTENSION_PATH).secure(TARGET);

		expect(commands()).toEqual([
			["/user", "/fo", "csv", "/nh"],
			[TARGET, "/save", backups[0]],
		]);
		await expectRemoved(backups[0]);
	});

	it("repairs, reverifies, and removes its ACL backup", async () => {
		// A foreign trustee first, so the repair runs, then the fixed DACL.
		const { backups } = setup(protectedAcl("WD"), protectedAcl());

		await new WindowsAcl(EXTENSION_PATH).secure(TARGET.replaceAll("\\", "/"));

		expect(commands()).toEqual([
			["/user", "/fo", "csv", "/nh"],
			[TARGET, "/save", backups[0]],
			[TARGET, "/inheritancelevel:d"],
			["//nologo", "//B", "//E:JScript", SCRIPT_PATH, TARGET, SID],
			[TARGET, "/save", backups[1]],
		]);
		await expectRemoved(backups[1]);
	});

	it("rejects an ACL that still grants extra access, removing its backup", async () => {
		const { backups } = setup(protectedAcl("WD"), protectedAcl("WD"));

		await expect(new WindowsAcl(EXTENSION_PATH).secure(TARGET)).rejects.toThrow(
			"does not contain only the expected protected",
		);
		await expectRemoved(backups[1]);
	});

	it("wraps a command failure with the target and the cause", async () => {
		setup();
		const cause = new Error("whoami failed");
		execute.mockRejectedValueOnce(cause);

		await expect(
			new WindowsAcl(EXTENSION_PATH).secure(TARGET),
		).rejects.toMatchObject({
			message: `Failed to repair SSH config permissions for ${TARGET}: ${cause.message}`,
			cause,
		});
	});

	it("resolves the SID once across calls", async () => {
		setup(protectedAcl(), protectedAcl());
		const acl = new WindowsAcl(EXTENSION_PATH);

		await acl.secure(TARGET);
		await acl.secure(TARGET);

		expect(whoamiCalls()).toHaveLength(1);
	});

	it("retries the SID lookup after it fails", async () => {
		setup(protectedAcl(), protectedAcl());
		const acl = new WindowsAcl(EXTENSION_PATH);
		execute.mockRejectedValueOnce(new Error("whoami failed"));

		await expect(acl.secure(TARGET)).rejects.toThrow("whoami failed");
		await acl.secure(TARGET);

		expect(whoamiCalls()).toHaveLength(2);
	});
});

/** Each descriptor answers one `icacls /save` with the backup it would write. */
function setup(...descriptors: string[]) {
	execute.mockReset();
	vi.mocked(fs.lstat).mockResolvedValue({
		isFile: () => true,
		nlink: 1,
	} as Awaited<ReturnType<typeof fs.lstat>>);
	vi.stubEnv("SystemRoot", "C:\\Windows");
	onTestFinished(() => {
		vi.unstubAllEnvs();
		vi.mocked(fs.lstat).mockReset();
	});

	const backups: string[] = [];
	execute.mockImplementation(async (name, args) => {
		if (name.endsWith("whoami.exe")) {
			return { stdout: whoamiCsv(), stderr: "" };
		}
		if (args[1] !== "/save") {
			return EMPTY;
		}
		backups.push(args[2]);
		const descriptor = descriptors[backups.length - 1] ?? "";
		await fs.writeFile(
			args[2],
			`\uFEFFfile.conf\r\n${descriptor}\r\n`,
			"utf16le",
		);
		return EMPTY;
	});
	return { backups };
}

const commands = () => execute.mock.calls.map(([, args]) => args);
const whoamiCalls = () =>
	execute.mock.calls.filter(([name]) => name.endsWith("whoami.exe"));

async function expectRemoved(backup: string): Promise<void> {
	await expect(fs.access(backup)).rejects.toMatchObject({ code: "ENOENT" });
}
