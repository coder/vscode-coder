import { promisify } from "node:util";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { WINDOWS_ACL } from "@/remote/windowsAcl";

import type { Stats } from "node:fs";

type FileStat = Pick<Stats, "isDirectory" | "isFile" | "nlink">;

const { execute, lstat, readdir } = vi.hoisted(() => ({
	execute:
		vi.fn<(command: string, args: string[]) => Promise<{ stdout: string }>>(),
	lstat: vi.fn<(target: string) => Promise<FileStat>>(),
	readdir: vi.fn<() => Promise<string[]>>(),
}));

vi.mock("node:child_process", () => ({
	execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }),
}));
vi.mock("node:fs/promises", () => ({ lstat, readdir }));

const DIRECTORY = "C:\\Users\\coder\\AppData\\Roaming\\coder.coder-remote\\ssh";
const FILE = `${DIRECTORY}\\file.conf`;
const ICACLS = "C:\\Windows\\System32\\icacls.exe";
const WHOAMI = "C:\\Windows\\System32\\whoami.exe";
const SID = "S-1-5-21-1-2-3-1001";
const WHOAMI_CSV = `"account","${SID}"\r\n`;

const DIR: FileStat = {
	isDirectory: () => true,
	isFile: () => false,
	nlink: 1,
};
const FILE_STAT: FileStat = {
	isDirectory: () => false,
	isFile: () => true,
	nlink: 1,
};
const LINKED: FileStat = { ...FILE_STAT, nlink: 2 };

/** Each run as one line, so a test can assert the whole transcript at once. */
const commandLines = () =>
	execute.mock.calls.map(([command, args]) => `${command} ${args.join(" ")}`);

const ranIcacls = () => commandLines().some((line) => line.startsWith(ICACLS));

beforeEach(() => {
	execute.mockReset().mockResolvedValue({ stdout: WHOAMI_CSV });
	lstat
		.mockReset()
		.mockImplementation((target) =>
			Promise.resolve(target === DIRECTORY ? DIR : FILE_STAT),
		);
	readdir.mockReset().mockResolvedValue(["file.conf"]);
	vi.stubEnv("SystemRoot", "C:\\Windows");
	onTestFinished(() => {
		vi.unstubAllEnvs();
	});
});

describe("WINDOWS_ACL", () => {
	it("restricts the directory, then resets files to inherit from it", async () => {
		await WINDOWS_ACL.prepareDirectory(DIRECTORY.replaceAll("\\", "/"));
		await WINDOWS_ACL.secure(FILE);

		expect(commandLines()).toEqual([
			`${WHOAMI} /user /fo csv /nh`,
			`${ICACLS} ${DIRECTORY} /reset`,
			`${ICACLS} ${DIRECTORY} /inheritance:r /grant:r *${SID}:(OI)(CI)F ` +
				"*S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F",
			`${ICACLS} ${FILE} /reset`,
		]);
	});

	it("ignores an entry that disappears between readdir and lstat", async () => {
		readdir.mockResolvedValue(["file.conf", "file.conf.tmp"]);
		lstat.mockImplementation((target) => {
			if (target === DIRECTORY) {
				return Promise.resolve(DIR);
			}
			if (target.endsWith(".tmp")) {
				return Promise.reject(
					Object.assign(new Error("no such file"), { code: "ENOENT" }),
				);
			}
			return Promise.resolve(FILE_STAT);
		});

		await expect(
			WINDOWS_ACL.prepareDirectory(DIRECTORY),
		).resolves.toBeUndefined();
		expect(ranIcacls()).toBe(true);
	});

	interface RejectCase {
		name: string;
		error: string;
		arrange?: () => void;
		call: () => Promise<void>;
		/** Extra assertion for rows that must stop before a specific step. */
		assert?: () => void;
	}
	it.each<RejectCase>([
		{
			name: "a relative directory",
			error: "fully qualified",
			call: () => WINDOWS_ACL.prepareDirectory("relative"),
		},
		{
			name: "a wildcard file path",
			error: "fully qualified",
			call: () => WINDOWS_ACL.secure(`${DIRECTORY}\\*.conf`),
		},
		{
			name: "a relative SystemRoot",
			error: "SystemRoot must be",
			arrange: () => vi.stubEnv("SystemRoot", "Windows"),
			call: () => WINDOWS_ACL.prepareDirectory(DIRECTORY),
		},
		{
			name: "a missing SystemRoot",
			error: "SystemRoot must be",
			arrange: () => vi.stubEnv("SystemRoot", undefined),
			call: () => WINDOWS_ACL.prepareDirectory(DIRECTORY),
		},
		{
			name: "a linked directory, before enumerating it",
			error: "directory without links",
			arrange: () => lstat.mockResolvedValue(FILE_STAT),
			call: () => WINDOWS_ACL.prepareDirectory(DIRECTORY),
			assert: () => expect(readdir).not.toHaveBeenCalled(),
		},
		{
			name: "a linked child, before permissions can propagate",
			error: "regular file with no links",
			arrange: () =>
				lstat.mockResolvedValueOnce(DIR).mockResolvedValueOnce(LINKED),
			call: () => WINDOWS_ACL.prepareDirectory(DIRECTORY),
		},
		{
			name: "a linked file",
			error: "regular file with no links",
			arrange: () => lstat.mockResolvedValue(LINKED),
			call: () => WINDOWS_ACL.secure(FILE),
		},
		{
			name: "whoami output with no SID",
			error: "Could not read the current Windows user SID",
			arrange: () => execute.mockResolvedValue({ stdout: '"account","nope"' }),
			call: () => WINDOWS_ACL.prepareDirectory(DIRECTORY),
		},
		{
			name: "whoami output with an extra column",
			error: "Could not read the current Windows user SID",
			arrange: () =>
				execute.mockResolvedValue({ stdout: `${WHOAMI_CSV},"extra"` }),
			call: () => WINDOWS_ACL.prepareDirectory(DIRECTORY),
		},
	])("rejects $name without changing permissions", async (testCase) => {
		testCase.arrange?.();
		await expect(testCase.call()).rejects.toThrow(testCase.error);
		expect(ranIcacls()).toBe(false);
		testCase.assert?.();
	});

	it("propagates an icacls failure without running the next command", async () => {
		execute.mockImplementation((command) =>
			command === ICACLS
				? Promise.reject(new Error("access denied"))
				: Promise.resolve({ stdout: WHOAMI_CSV }),
		);

		await expect(WINDOWS_ACL.prepareDirectory(DIRECTORY)).rejects.toThrow(
			"access denied",
		);
		await expect(WINDOWS_ACL.secure(FILE)).rejects.toThrow("access denied");

		// The failing /reset must not be followed by a grant on a still-open directory.
		expect(commandLines().some((line) => line.includes("/grant:r"))).toBe(
			false,
		);
	});

	it.each([
		"C:\\Users\\coder\\config",
		"C:/Users/coder/config",
		"\\\\server\\share\\config",
	])("accepts the fully qualified path %s", async (target) => {
		await expect(WINDOWS_ACL.secure(target)).resolves.toBeUndefined();
	});

	it.each([
		"\\\\server",
		"\\config",
		"C:config",
		"config",
		"C:\\*.conf",
		"C:\\file?.conf",
		"C:\\file\r.conf",
		"C:\\file\0.conf",
		"C:\\file\n.conf",
	])("rejects the path %j", async (target) => {
		await expect(WINDOWS_ACL.secure(target)).rejects.toThrow("fully qualified");
		expect(ranIcacls()).toBe(false);
	});
});
