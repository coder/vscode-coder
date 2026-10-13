import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	InputValidationError,
	isShellSafeHostname,
	isValidDeploymentUrl,
	isValidIdentifier,
	validateAgentName,
	validateFilenameHostname,
	validateIdentifier,
	validateDeploymentUrl,
	validateShellSafeHostname,
} from "@/common/validation";

import { INVALID_DEPLOYMENT_URLS } from "../../mocks/testHelpers";

describe("isValidIdentifier", () => {
	it.each(["ws", "my-workspace", "agent_1", "9lives", "a".repeat(100)])(
		"accepts %j",
		(input) => {
			expect(isValidIdentifier(input)).toBe(true);
		},
	);

	it.each([
		"",
		"--flag",
		"trailing-",
		"dev.main", // `.` separates workspace and agent in the authority
		"a--b", // `--` separates the authority parts
		"a b",
		"a/b",
		"..",
		"x$(touch /tmp/pwned)",
		"x`id`",
		"a;b",
		"a%h",
		"a\nb",
	])("rejects %j", (input) => {
		expect(isValidIdentifier(input)).toBe(false);
	});
});

describe("validateIdentifier", () => {
	it("returns valid identifiers and names the kind when rejecting", () => {
		expect(validateIdentifier("ws", "workspace name")).toBe("ws");
		expect(() => validateIdentifier("x$(id)", "workspace name")).toThrow(
			"Cannot use this workspace name in an SSH connection: it contains unsupported characters or separators.",
		);
	});
});

describe("validateAgentName", () => {
	it.each(["dev", "-dev", "dev-", "dev_1", "_dev_", "Dev-1"])(
		"accepts legacy agent name %j",
		(input) => {
			expect(validateAgentName(input)).toBe(input);
		},
	);

	it.each(["", "dev.main", "dev--1", "a/b", "a b", "$(id)", "a%h", "a\nb"])(
		"rejects %j",
		(input) => {
			expect(() => validateAgentName(input)).toThrow(InputValidationError);
		},
	);
});

describe("validateFilenameHostname", () => {
	afterEach(() => vi.restoreAllMocks());

	it.each([
		"",
		".",
		"..",
		"...",
		"a/b",
		"a\\b",
		"a\nb",
		"a\u0000b",
		"a\u007fb", // DEL
		"a\u0085b", // C1 next line
	])("rejects unsafe path component %j on every platform", (input) => {
		for (const platform of ["linux", "darwin", "win32"] as const) {
			vi.spyOn(os, "platform").mockReturnValue(platform);
			expect(() => validateFilenameHostname(input)).toThrow(
				InputValidationError,
			);
		}
	});

	const reservedOnWindows = ["CON", "con.example", "LPT1", "COM1", "a.", "a "];
	const invalidOnWindows = ["[::1]", "a<", "a>", "a:", 'a"', "a|", "a?", "a*"];

	it.each([...reservedOnWindows, ...invalidOnWindows])(
		"rejects %j only on Windows",
		(input) => {
			for (const platform of ["linux", "darwin"] as const) {
				vi.spyOn(os, "platform").mockReturnValue(platform);
				expect(validateFilenameHostname(input)).toBe(input);
			}
			vi.spyOn(os, "platform").mockReturnValue("win32");
			expect(() => validateFilenameHostname(input)).toThrow(
				InputValidationError,
			);
		},
	);

	it.each([
		"coder.example",
		"xn--bcher-kva.example",
		"127.0.0.1",
		"com10",
		"console",
	])("preserves ordinary hostname %j on Windows", (input) => {
		vi.spyOn(os, "platform").mockReturnValue("win32");
		expect(validateFilenameHostname(input)).toBe(input);
	});
});

describe("InputValidationError", () => {
	it("logs a bounded, escaped value and keeps it out of the message", () => {
		const value =
			"[Retry](command:workbench.action.terminal.sendSequence)\n" +
			"x".repeat(1000);
		expect(() => validateAgentName(value)).toThrow(
			expect.objectContaining({
				message: expect.not.stringContaining("command:"),
				diagnosticValue: JSON.stringify(value.slice(0, 512)),
			}),
		);
	});

	it.each([
		"https://alice:hunter2@[bad?token=s3cr3t", // unparsable
		"https://alice:hunter2@host/?token=s3cr3t", // credentials and query
		"https://host/s3cr3t/$bad", // shell metacharacters
	])("omits URL secrets from the error for %j", (url) => {
		expect(() => validateDeploymentUrl(url)).toThrow(
			expect.objectContaining({
				name: "InputValidationError",
				message: expect.not.stringMatching(/alice|hunter2|s3cr3t/),
				diagnosticValue: expect.not.stringMatching(/alice|hunter2|s3cr3t/),
			}),
		);
	});
});

describe("isShellSafeHostname", () => {
	it.each(["dev.coder.com", "my--host.example.com", "127.0.0.1", "[::1]"])(
		"accepts %j",
		(input) => {
			expect(isShellSafeHostname(input)).toBe(true);
		},
	);

	it.each(["", "a/b", "a\\b", "host name", "x$(id)", "host%h", "::1"])(
		"rejects %j",
		(input) => {
			expect(isShellSafeHostname(input)).toBe(false);
		},
	);

	it.each(["[::1%h]", "[fe80::1%eth0]", "[::not-ip]"])(
		"rejects scoped or invalid bracketed IPv6 %j",
		(input) => {
			expect(isShellSafeHostname(input)).toBe(false);
		},
	);
});

describe("validateShellSafeHostname", () => {
	it("returns valid hostnames and names the kind when rejecting", () => {
		expect(validateShellSafeHostname("dev.coder.com")).toBe("dev.coder.com");
		expect(() => validateShellSafeHostname("a$(id).com")).toThrow(
			/deployment hostname/,
		);
	});
});

describe("validateDeploymentUrl", () => {
	it.each([
		"https://dev.coder.com",
		"https://dev.coder.com:8443/base/path",
		"http://127.0.0.1:3000",
		"https://[2001:db8::1]:8443",
	])("accepts %j", (input) => {
		expect(validateDeploymentUrl(input)).toBe(input);
		expect(isValidDeploymentUrl(input)).toBe(true);
	});

	it.each([
		...INVALID_DEPLOYMENT_URLS,
		// Sign-in normalizes these away, but storage reads see them raw.
		"https://host/a\\b",
		"https://host/a\nb",
	])("rejects %j", (input) => {
		expect(() => validateDeploymentUrl(input)).toThrow(/Invalid URL/);
		expect(isValidDeploymentUrl(input)).toBe(false);
	});
});
